import type { SafetyState } from '@agrirobots/contracts';

import { convert, isQuantity, type Quantity, type StateSnapshot } from './state.ts';

/** Safety functions of the ARACNID design basis (docs/10 §7). */
export const ARACNID_SAFETY_FUNCTIONS = [
  'SF-AR-01',
  'SF-AR-02',
  'SF-AR-03',
  'SF-AR-04',
  'SF-AR-05',
  'SF-AR-06',
  'SF-AR-07',
  'SF-AR-08',
  'SF-AR-09',
  'SF-AR-10',
] as const;

export type AracnidSafetyFunction = (typeof ARACNID_SAFETY_FUNCTIONS)[number];

export interface SafetyFunctionResult {
  id: string;
  tripped: boolean;
  /** What the function did to the machine, in plain words. */
  effect?: string;
  detail?: string;
}

export interface SafetyAssessment {
  state: SafetyState;
  /** True when the machine must not be given energy for the requested action. */
  inhibited: boolean;
  reasons: string[];
  functions: SafetyFunctionResult[];
}

export interface SafetyRequest {
  /** Statement kind being authorised. */
  kind: string;
  /** Capability id for `actuate` / `observe`. */
  capability?: string;
  /** Resolved resource keys the action claims. */
  resources: string[];
  /** Permit kinds granted by the task at this point. */
  permits: string[];
  /** Cassette manifest approval for motion while a tool is in use. */
  motionDuringToolUse: boolean;
}

export interface SafetyModelOptions {
  carrierId: string;
  cassetteId: string;
  /** Static tilt at which SF-AR-08 removes all energy (design placeholder). */
  tiltTripDeg?: number;
  /** Hand force at which SF-AR-03 cuts suction. */
  forceLimitN?: number;
  /** Age of `safety.*` beyond which SF-AR-09 declares heartbeat loss. */
  heartbeatMs?: number;
  /** Number of picking hands on the carrier. */
  handCount?: number;
}

const DEFAULTS = {
  tiltTripDeg: 6,
  forceLimitN: 12,
  heartbeatMs: 500,
  handCount: 8,
};

function read(snapshot: StateSnapshot, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = snapshot.tree[parts[0]!];
  for (const part of parts.slice(1)) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else {
      return null;
    }
  }
  return current ?? null;
}

function readQuantity(snapshot: StateSnapshot, path: string, unit: string): number | null {
  const value = read(snapshot, path);
  if (typeof value === 'number') return value;
  if (isQuantity(value)) return convert(value as Quantity, unit).value;
  return null;
}

function readBoolean(snapshot: StateSnapshot, path: string): boolean {
  return read(snapshot, path) === true;
}

function readString(snapshot: StateSnapshot, path: string): string {
  const value = read(snapshot, path);
  return typeof value === 'string' ? value : '';
}

/**
 * The simulated independent safety model.
 *
 * It is deliberately *not* part of the interpreter: it reads the same state the
 * task reads, but it is consulted before every dispatch and its answer is final.
 * A task cannot argue with it, cannot clear it and cannot widen it, which is the
 * software-side expression of "the safety controller is independent"
 * (docs/04 §4, docs/10 §7). On real hardware this role belongs to the safety PLC
 * and this model is only its shadow for rehearsal.
 */
export class IndependentSafetyModel {
  private readonly options: Required<SafetyModelOptions>;

  constructor(options: SafetyModelOptions) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Evaluates every safety function against one state snapshot. */
  assess(snapshot: StateSnapshot, request: SafetyRequest): SafetyAssessment {
    const functions: SafetyFunctionResult[] = [];
    const reasons: string[] = [];
    const wantsToolEnergy = request.resources.some((key) => key.startsWith('tool.'));
    const wantsTraction =
      request.resources.includes('traction') ||
      request.kind === 'move' ||
      request.kind === 'dock' ||
      request.kind === 'return_to';

    // SF-AR-01 E-stop
    const eStop = readBoolean(snapshot, 'safety.e_stop');
    functions.push({
      id: 'SF-AR-01',
      tripped: eStop,
      effect: 'traction torque removed, brakes applied, vacuum vented, arms held',
      detail: eStop ? 'e-stop circuit open' : undefined,
    });
    if (eStop) reasons.push('SF-AR-01: e-stop is engaged');

    // SF-AR-02 arm-envelope breach
    const envelopeClear = read(snapshot, 'safety.arm_envelope_clear') !== false;
    functions.push({
      id: 'SF-AR-02',
      tripped: !envelopeClear,
      effect: 'affected arms stop and hold; traction inhibited',
      detail: envelopeClear
        ? undefined
        : `scanner reports ${readString(snapshot, 'safety.envelope_zone') || 'an intrusion'}`,
    });
    if (!envelopeClear && (wantsToolEnergy || wantsTraction)) {
      reasons.push('SF-AR-02: arm envelope is not clear');
    }

    // SF-AR-03 hand force over limit
    const overloaded: string[] = [];
    for (let hand = 1; hand <= this.options.handCount; hand += 1) {
      const key = `tool.hand_${String(hand)}`;
      const force = readQuantity(snapshot, key + '.force_peak', 'N');
      if (force !== null && force > this.options.forceLimitN && request.resources.includes(key)) {
        overloaded.push(key);
      }
    }
    functions.push({
      id: 'SF-AR-03',
      tripped: overloaded.length > 0,
      effect: 'hand MCU cuts suction and retracts',
      detail:
        overloaded.length > 0
          ? `force above ${String(this.options.forceLimitN)} N on ${overloaded.join(', ')}`
          : undefined,
    });
    if (overloaded.length > 0)
      reasons.push(`SF-AR-03: force limit exceeded on ${overloaded.join(', ')}`);

    // SF-AR-04 seal loss on a loaded hand
    const slipping: string[] = [];
    for (let hand = 1; hand <= this.options.handCount; hand += 1) {
      const key = `tool.hand_${String(hand)}`;
      const holding = read(snapshot, `${key}.holding`) !== null;
      const seal = readString(snapshot, `${key}.seal_quality`);
      if (holding && seal !== '' && seal !== 'good') slipping.push(key);
    }
    functions.push({
      id: 'SF-AR-04',
      tripped: slipping.length > 0,
      effect: 'cup vents, hand opens, egg flagged and never re-squeezed',
      detail: slipping.length > 0 ? `seal loss on ${slipping.join(', ')}` : undefined,
    });
    if (slipping.some((key) => request.resources.includes(key))) {
      reasons.push(`SF-AR-04: seal loss on ${slipping.join(', ')}`);
    }

    // SF-AR-05 cassette latch / identity mismatch
    const latched = readString(snapshot, 'cassette.latch') === 'LOCKED';
    const identityOk =
      readString(snapshot, 'cassette.id') === '' ||
      readString(snapshot, 'cassette.id') === this.options.cassetteId;
    functions.push({
      id: 'SF-AR-05',
      tripped: !latched || !identityOk,
      effect: 'tool energy and travel inhibited; manifest unload requested',
      detail: !latched
        ? 'cassette latch is not LOCKED'
        : !identityOk
          ? `cassette id is ${readString(snapshot, 'cassette.id')}, expected ${this.options.cassetteId}`
          : undefined,
    });
    if ((!latched || !identityOk) && (wantsToolEnergy || wantsTraction)) {
      reasons.push('SF-AR-05: cassette latch or identity mismatch');
    }

    // SF-AR-06 deployed-arm motion interlock
    const deployed = readBoolean(snapshot, 'carrier.arms_deployed');
    const parked = readBoolean(snapshot, 'carrier.parked');
    const motionBlocked = deployed && !request.motionDuringToolUse && !parked;
    functions.push({
      id: 'SF-AR-06',
      tripped: motionBlocked,
      effect: 'arms cannot deploy unless parked and permitted; motion denied',
      detail: motionBlocked ? 'arms deployed while traction was requested' : undefined,
    });
    if (motionBlocked && wantsTraction) {
      reasons.push('SF-AR-06: motion with deployed arms is interlocked');
    }

    // SF-AR-07 bird / worker presence
    const presence = readBoolean(snapshot, 'safety.presence_detected');
    functions.push({
      id: 'SF-AR-07',
      tripped: presence,
      effect: 'arms hold, traction inhibited',
      detail: presence
        ? `presence in ${readString(snapshot, 'safety.presence_zone') || 'the working cell'}`
        : undefined,
    });
    if (presence && (wantsToolEnergy || wantsTraction)) {
      reasons.push('SF-AR-07: a bird or worker is inside the working cell');
    }

    // SF-AR-08 tilt / tip-over
    const tilt = readQuantity(snapshot, 'carrier.tilt', 'deg') ?? 0;
    const tilted = tilt >= this.options.tiltTripDeg;
    functions.push({
      id: 'SF-AR-08',
      tripped: tilted,
      effect: 'all energy removed, arms held',
      detail: tilted
        ? `tilt ${tilt.toFixed(2)} deg >= ${String(this.options.tiltTripDeg)} deg`
        : undefined,
    });
    if (tilted) reasons.push(`SF-AR-08: tilt ${tilt.toFixed(2)} deg is beyond the trip limit`);

    // SF-AR-09 heartbeat loss
    const safetyAge = ageOfPath(snapshot, 'safety');
    const heartbeatLost = safetyAge > this.options.heartbeatMs;
    functions.push({
      id: 'SF-AR-09',
      tripped: heartbeatLost,
      effect: 'controlled stop, vacuum vented, arms held',
      detail: heartbeatLost ? `safety telemetry is ${String(safetyAge)} ms old` : undefined,
    });
    if (heartbeatLost) reasons.push('SF-AR-09: safety heartbeat lost (telemetry stale)');

    // SF-AR-10 magazine interlock
    const indexing = readBoolean(snapshot, 'cassette.magazine.indexing');
    const handInBay = readBoolean(snapshot, 'cassette.magazine.hand_in_bay');
    const magazineBlocked = indexing && handInBay;
    functions.push({
      id: 'SF-AR-10',
      tripped: magazineBlocked,
      effect: 'tray bay cannot index while a hand is inside it',
      detail: magazineBlocked ? 'index requested with a hand in the bay' : undefined,
    });
    if (magazineBlocked && request.resources.includes('tool.magazine')) {
      reasons.push('SF-AR-10: magazine interlock is closed');
    }

    // The mode is the machine's own report; an e-stop overrides it. Inhibition
    // is reported separately, because a machine can be in AUTO_TASK and still be
    // refused energy for one action.
    const state: SafetyState = eStop ? 'SAFE_STOP' : modeFromSnapshot(snapshot);

    return { state, inhibited: reasons.length > 0, reasons, functions };
  }
}

function ageOfPath(snapshot: StateSnapshot, path: string): number {
  let current = path;
  for (;;) {
    const at = snapshot.sampledAtMs[current];
    if (at !== undefined) return Math.max(0, snapshot.nowMs - at);
    const cut = current.lastIndexOf('.');
    if (cut <= 0) return 0;
    current = current.slice(0, cut);
  }
}

function modeFromSnapshot(snapshot: StateSnapshot): SafetyState {
  const mode = readString(snapshot, 'safety.mode');
  switch (mode) {
    case 'READY':
    case 'AUTO_TASK':
    case 'AUTO_TRAVEL':
    case 'MANUAL_SLOW':
    case 'SERVICE':
    case 'SAFE_STOP':
      return mode;
    default:
      // An unreadable mode is UNKNOWN, and UNKNOWN is inhibiting.
      return 'UNKNOWN';
  }
}
