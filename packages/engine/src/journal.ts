import { createHash } from 'node:crypto';

import type {
  ConfigurationIds,
  EventSource,
  JournalEvent,
  SafetyState,
  SignalQuality,
} from '@agrirobots/contracts';
import { SCHEMA_VERSIONS } from '@agrirobots/contracts';

import type { Clock } from './clock.ts';

/** Every kind of record the engine writes. Closed, so a trace can be replayed. */
export const JOURNAL_KINDS = [
  'mission.started',
  'mission.completed',
  'mission.failed',
  'mission.aborted',
  'mission.inhibited',
  'mission.suspended',
  'preflight.checked',
  'preflight.failed',
  'statement.entered',
  'statement.completed',
  'statement.interrupted',
  'statement.skipped',
  'action.dispatched',
  'action.verified',
  'action.mismatch',
  'action.retry',
  'action.idempotent_replay',
  'observation.stored',
  'observation.abstained',
  'deadline.exceeded',
  'permit.requested',
  'permit.granted',
  'permit.denied',
  'permit.expired',
  'permit.released',
  'resource.claimed',
  'resource.released',
  'resource.denied',
  'guard.armed',
  'guard.checked',
  'guard.breached',
  'guard.disarmed',
  'branch.started',
  'branch.completed',
  'branch.cancelled',
  'join.completed',
  'loop.iteration',
  'loop.exhausted',
  'await.armed',
  'await.suspended',
  'await.resumed',
  'await.timeout',
  'fault.entered',
  'safety.state_changed',
  'safety.inhibited',
  'safety.function_tripped',
  'record.emitted',
  'notify.sent',
  'twin.frame',
  'checkpoint.saved',
] as const;

export type JournalKind = (typeof JOURNAL_KINDS)[number];

export interface JournalOptions {
  runId: string;
  source: EventSource;
  clock: Clock;
  configuration: ConfigurationIds;
  /** The independent safety model owns the mode; the journal reports it. */
  safetyState: () => SafetyState;
  quality?: () => SignalQuality;
}

/**
 * Append-only mission journal. Events are never rewritten and the sequence is
 * strictly increasing, so a gap is data loss and the sha256 of a journal is the
 * identity of an execution (docs/09 §7 equivalence testing).
 */
export class Journal {
  readonly events: JournalEvent[] = [];
  private sequence = 0;

  private readonly options: JournalOptions;

  constructor(options: JournalOptions) {
    this.options = options;
  }

  emit(
    kind: JournalKind,
    payload: Record<string, unknown>,
    overrides: { quality?: SignalQuality; safetyState?: SafetyState } = {},
  ): JournalEvent {
    this.sequence += 1;
    const event: JournalEvent = {
      schemaVersion: SCHEMA_VERSIONS.event,
      eventId: `${this.options.runId}:${String(this.sequence).padStart(6, '0')}`,
      timestamp: this.options.clock.timestamp(),
      monotonicNs: this.options.clock.now() * 1_000_000,
      source: this.options.source,
      sequence: this.sequence,
      runId: this.options.runId,
      safetyState: overrides.safetyState ?? this.options.safetyState(),
      quality: overrides.quality ?? this.options.quality?.() ?? 'GOOD',
      configuration: this.options.configuration,
      kind,
      payload,
    };
    this.events.push(event);
    return event;
  }

  /** sha256 over the canonical event stream: the trace identity. */
  hash(): string {
    const canonical = JSON.stringify(
      this.events.map((event) => ({
        configuration: event.configuration,
        eventId: event.eventId,
        kind: event.kind,
        payload: sortDeep(event.payload),
        quality: event.quality,
        safetyState: event.safetyState,
        sequence: event.sequence,
        source: event.source,
        timestamp: event.timestamp,
      })),
    );
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /** Events of one kind, in order. */
  of(kind: string): JournalEvent[] {
    return this.events.filter((event) => event.kind === kind);
  }
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}
