import { type SCHEMA_VERSIONS } from './schema-versions.ts';

/**
 * Authoritative operating modes. The independent safety controller owns these
 * states; software may request a transition but never assert one.
 * `UNKNOWN` exists so that a telemetry gap is representable and must be treated
 * as inhibiting, not as permission.
 */
export const SAFETY_STATES = [
  'UNKNOWN',
  'SAFE_STOP',
  'READY',
  'MANUAL_SLOW',
  'AUTO_TRAVEL',
  'AUTO_TASK',
  'SERVICE',
] as const;

export type SafetyState = (typeof SAFETY_STATES)[number];

/** Modes in which a mission may be armed. Everything else is inhibiting. */
export const MISSION_PERMITTING_STATES: readonly SafetyState[] = Object.freeze([
  'AUTO_TRAVEL',
  'AUTO_TASK',
]);

/** Signal quality of the state that an event reports. */
export const SIGNAL_QUALITIES = ['GOOD', 'UNCERTAIN', 'BAD', 'STALE'] as const;

export type SignalQuality = (typeof SIGNAL_QUALITIES)[number];

/** Producers of journal events. `safety-controller` records are authoritative. */
export const EVENT_SOURCES = [
  'virtual-lab',
  'compiler',
  'policy-service',
  'simulator',
  'replay',
  'hil-bench',
  'edge-executor',
  'module-controller',
  'safety-controller',
  'operator-hmi',
  'fleet-service',
] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

/** Configuration identifiers required to reproduce or audit an event. */
export interface ConfigurationIds {
  carrierId: string;
  cassetteSerial?: string;
  firmwareVersion?: string;
  rosBundleHash?: string;
  mapRevision?: string;
  calibrationBundleHash?: string;
  modelVersion?: string;
  recipeHash?: string;
}

/**
 * One append-only journal record. Events are never rewritten; a correction is a
 * new event that references the original `eventId`.
 */
export interface JournalEvent<Payload extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: typeof SCHEMA_VERSIONS.event;
  eventId: string;
  /** ISO 8601 UTC timestamp of observation. */
  timestamp: string;
  /** Monotonic source clock in nanoseconds, when the source provides one. */
  monotonicNs?: number;
  source: EventSource;
  /** Strictly increasing per `runId`; gaps are treated as data loss. */
  sequence: number;
  runId: string;
  safetyState: SafetyState;
  quality: SignalQuality;
  configuration: ConfigurationIds;
  /** Event kind, e.g. `task.started`, `dose.dispensed`, `fault.safe_stop`. */
  kind: string;
  payload: Payload;
}

export function isMissionPermitting(state: SafetyState): boolean {
  return MISSION_PERMITTING_STATES.includes(state);
}
