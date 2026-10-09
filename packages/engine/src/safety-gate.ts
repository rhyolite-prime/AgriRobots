import type { SafetyState } from '@agrirobots/contracts';

import type { Clock } from './clock.ts';
import type { Journal } from './journal.ts';
import type { AcquisitionResult, ResourceArbitrator, ResourceLease } from './resources.ts';
import type { IndependentSafetyModel, SafetyAssessment, SafetyRequest } from './safety-model.ts';

export interface PermitGrant {
  permitId: string;
  kind: string;
  holder: string;
  leases: ResourceLease[];
  grantedAtMs: number;
  expiresAtMs?: number;
}

export type PermitDecision =
  { granted: true; permit: PermitGrant } | { granted: false; reason: string; reasons: string[] };

export type Authorization =
  | { allowed: true; assessment: SafetyAssessment }
  | { allowed: false; reasons: string[]; assessment: SafetyAssessment };

export interface SafetyGateOptions {
  clock: Clock;
  journal: Journal;
  model: IndependentSafetyModel;
  resources: ResourceArbitrator;
  motionDuringToolUse: boolean;
}

/**
 * The gate every physical action passes through.
 *
 * Ordering is the point: permits and resource claims are taken *first*, then the
 * independent safety model is asked, and only an affirmative answer to both
 * releases energy. A denial is inhibiting and final — the interpreter may fault,
 * retry later or stop, but it cannot proceed, and it cannot clear the denial.
 */
export class SafetyGate {
  private readonly permits: PermitGrant[] = [];
  private nextPermit = 0;
  private stopped = false;
  private stopReason = '';
  private lastAssessment: SafetyAssessment | undefined;

  private readonly options: SafetyGateOptions;

  constructor(options: SafetyGateOptions) {
    this.options = options;
  }

  get clock(): Clock {
    return this.options.clock;
  }

  state(snapshotFor: (request: SafetyRequest) => SafetyAssessment): SafetyState {
    if (this.stopped) return 'SAFE_STOP';
    return (
      this.lastAssessment?.state ?? snapshotFor(idleRequest(this.options.motionDuringToolUse)).state
    );
  }

  /** Current mode as the journal reports it. */
  currentMode(assess: () => SafetyAssessment): SafetyState {
    if (this.stopped) return 'SAFE_STOP';
    const assessment = assess();
    this.lastAssessment = assessment;
    return assessment.state;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  stopReasonText(): string {
    return this.stopReason;
  }

  /**
   * Records that the task asked for a controlled stop. The gate can only move
   * towards less energy: this is irreversible for the rest of the mission.
   */
  requestSafeStop(reason: string): void {
    this.stopped = true;
    this.stopReason = reason;
    this.options.journal.emit('safety.state_changed', {
      from: this.lastAssessment?.state ?? 'UNKNOWN',
      to: 'SAFE_STOP',
      requestedBy: 'task',
      reason,
    });
  }

  requestPermit(
    holder: string,
    kind: string,
    resourceKeys: string[],
    leaseMs: number | undefined,
    assess: (request: SafetyRequest) => SafetyAssessment,
  ): PermitDecision {
    const now = this.options.clock.now();
    this.options.journal.emit('permit.requested', {
      holder,
      kind,
      resources: resourceKeys,
      leaseMs: leaseMs ?? null,
    });

    if (this.stopped) {
      const decision: PermitDecision = {
        granted: false,
        reason: 'the machine is in a task-requested safe stop',
        reasons: ['safe stop is latched'],
      };
      this.options.journal.emit('permit.denied', { holder, kind, reason: decision.reason });
      return decision;
    }

    const assessment = assess({
      kind: 'permit',
      resources: resourceKeys,
      permits: [kind],
      motionDuringToolUse: this.options.motionDuringToolUse,
    });
    this.lastAssessment = assessment;

    if (assessment.inhibited) {
      this.options.journal.emit('permit.denied', { holder, kind, reasons: assessment.reasons });
      this.options.journal.emit('safety.inhibited', {
        holder,
        kind,
        reasons: assessment.reasons,
        functions: assessment.functions.filter((fn) => fn.tripped).map((fn) => fn.id),
      });
      return {
        granted: false,
        reason: assessment.reasons[0] ?? 'inhibited',
        reasons: assessment.reasons,
      };
    }

    const acquisition: AcquisitionResult = this.options.resources.acquire(
      holder,
      resourceKeys,
      now,
      leaseMs,
    );
    if (!acquisition.granted) {
      this.options.journal.emit('resource.denied', {
        holder,
        key: acquisition.key,
        heldBy: acquisition.holder ?? null,
        reason: acquisition.reason,
      });
      this.options.journal.emit('permit.denied', { holder, kind, reason: acquisition.reason });
      return { granted: false, reason: acquisition.reason, reasons: [acquisition.reason] };
    }

    this.nextPermit += 1;
    const permit: PermitGrant = {
      permitId: `permit-${String(this.nextPermit)}`,
      kind,
      holder,
      leases: acquisition.leases,
      grantedAtMs: now,
      ...(leaseMs ? { expiresAtMs: now + leaseMs } : {}),
    };
    this.permits.push(permit);

    for (const lease of acquisition.leases) {
      this.options.journal.emit('resource.claimed', {
        key: lease.key,
        holder,
        exclusive: lease.exclusive,
        permitId: permit.permitId,
      });
    }
    this.options.journal.emit('permit.granted', {
      holder,
      kind,
      permitId: permit.permitId,
      resources: resourceKeys,
      expiresAtMs: permit.expiresAtMs ?? null,
    });
    return { granted: true, permit };
  }

  releasePermit(permitId: string): void {
    const index = this.permits.findIndex((permit) => permit.permitId === permitId);
    if (index < 0) return;
    const [permit] = this.permits.splice(index, 1);
    const released = this.options.resources.release(permit!.leases.map((lease) => lease.id));
    for (const lease of released) {
      this.options.journal.emit('resource.released', { key: lease.key, holder: lease.holder });
    }
    this.options.journal.emit('permit.released', {
      permitId,
      kind: permit!.kind,
      holder: permit!.holder,
    });
  }

  /** Permits currently held by a holder, for the interpreter's S4 enclosure check at run time. */
  permitsFor(holder: string): PermitGrant[] {
    return this.permits.filter((permit) => permit.holder === holder);
  }

  activePermits(): PermitGrant[] {
    return [...this.permits];
  }

  /**
   * Final authorisation for one dispatch. Resources are already held by the
   * enclosing permit scope; here the safety model gets the last word.
   */
  authorize(
    request: SafetyRequest,
    assess: (request: SafetyRequest) => SafetyAssessment,
  ): Authorization {
    if (this.stopped) {
      const assessment = assess(request);
      return {
        allowed: false,
        reasons: [`safe stop is latched: ${this.stopReason}`],
        assessment,
      };
    }
    const assessment = assess(request);
    this.lastAssessment = assessment;
    if (assessment.inhibited) {
      this.options.journal.emit('safety.inhibited', {
        kind: request.kind,
        capability: request.capability ?? null,
        resources: request.resources,
        reasons: assessment.reasons,
        functions: assessment.functions.filter((fn) => fn.tripped).map((fn) => fn.id),
      });
      return { allowed: false, reasons: assessment.reasons, assessment };
    }
    return { allowed: true, assessment };
  }

  /** Expires leases and permits whose time is up. Returns what expired. */
  tick(): { permits: PermitGrant[]; leases: ResourceLease[] } {
    const now = this.options.clock.now();
    const expiredLeases = this.options.resources.expire(now);
    const expiredPermits: PermitGrant[] = [];
    for (let index = this.permits.length - 1; index >= 0; index -= 1) {
      const permit = this.permits[index]!;
      if (permit.expiresAtMs !== undefined && permit.expiresAtMs <= now) {
        this.permits.splice(index, 1);
        expiredPermits.push(permit);
        this.options.journal.emit('permit.expired', {
          permitId: permit.permitId,
          kind: permit.kind,
          holder: permit.holder,
        });
      }
    }
    for (const lease of expiredLeases) {
      this.options.journal.emit('resource.released', {
        key: lease.key,
        holder: lease.holder,
        expired: true,
      });
    }
    return { permits: expiredPermits, leases: expiredLeases };
  }

  model(): IndependentSafetyModel {
    return this.options.model;
  }
}

function idleRequest(motionDuringToolUse: boolean): SafetyRequest {
  return { kind: 'idle', resources: [], permits: [], motionDuringToolUse };
}
