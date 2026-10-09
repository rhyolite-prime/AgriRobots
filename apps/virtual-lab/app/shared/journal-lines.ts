import type { JournalLine } from './lab-types';

/**
 * Journal rendering shared by the server (which builds the wire format) and the
 * browser (which filters and scrolls it). Pure: it reads the event shape from
 * `@agrirobots/contracts` structurally, so the browser never imports the engine.
 */
export interface RawJournalEvent {
  sequence: number;
  kind: string;
  timestamp: string;
  monotonicNs?: number;
  source: string;
  safetyState: string;
  quality: string;
  payload: Record<string, unknown>;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function shortHash(value: unknown): string {
  const hash = text(value);
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function reasons(value: unknown): string {
  return Array.isArray(value) ? value.map(text).join('; ') : text(value);
}

/** One line a stockperson or an engineer can read without opening the payload. */
export function summariseEvent(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'mission.started':
      return `mission started · ${text(payload['task'])} · ir ${shortHash(payload['irHash'])}`;
    case 'mission.completed':
      return `mission completed in ${text(payload['elapsedMs'])} ms`;
    case 'mission.failed':
      return `mission failed · ${text(payload['errorCode'])} · ${text(payload['message'])}`;
    case 'mission.aborted':
      return `mission aborted by the task · ${text(payload['errorCode'])}`;
    case 'mission.inhibited':
      return `machine refused · ${text(payload['errorCode'])} · ${text(payload['message'])}`;
    case 'mission.suspended':
      return `suspended · ${text(payload['message'])}`;
    case 'preflight.checked':
      return `preflight ${payload['holds'] === true ? 'holds' : 'FAILED'} · ${text(payload['condition'])}`;
    case 'preflight.failed':
      return `preflight refused arming · ${text(payload['reason'])}`;
    case 'statement.entered':
      return payload['clause']
        ? `enter ${text(payload['clause'])} clause (cause ${text(payload['cause'])})`
        : `enter ${text(payload['id'])} · ${text(payload['kind'])}${payload['path'] ? ` · ${text(payload['path'])}` : ''}`;
    case 'statement.completed':
      return `${text(payload['id'])} completed at ${text(payload['t'])} ms`;
    case 'statement.interrupted':
      return `${text(payload['id'])} interrupted (fault, suspension or finish)`;
    case 'statement.skipped':
      return `${text(payload['id'])} skipped · ${text(payload['text'])}`;
    case 'action.dispatched':
      return `${text(payload['capability'])} dispatched · ${text(payload['durationMs'])} ms`;
    case 'action.verified':
      return `${text(payload['capability'])} verified · ${Array.isArray(payload['checks']) ? payload['checks'].length : 0} post-conditions${payload['replayed'] === true ? ' (replayed)' : ''}`;
    case 'action.mismatch':
      return `${text(payload['capability'])} mismatch · ${text(payload['reason'])}`;
    case 'action.retry':
      return `${text(payload['capability'])} retry ${text(payload['attempt'])} after ${text(payload['backoffMs'])} ms`;
    case 'action.idempotent_replay':
      return `${text(payload['capability'])} replayed from key ${text(payload['idempotencyKey'])}`;
    case 'observation.stored':
      return `observation stored into $${text(payload['into'])}`;
    case 'observation.abstained':
      return `abstained · ${text(payload['message'] ?? payload['capability'] ?? payload['condition'])}`;
    case 'permit.requested':
      return `${text(payload['kind'])} requested on ${reasons(payload['resources']) || 'no resource'}`;
    case 'permit.granted':
      return `${text(payload['kind'])} granted to ${text(payload['holder'])} for ${text(payload['leaseMs'])} ms`;
    case 'permit.denied':
      return `${text(payload['kind'])} refused · ${reasons(payload['reasons'])}`;
    case 'permit.expired':
      return `${text(payload['kind'])} lease expired`;
    case 'permit.released':
      return `${text(payload['kind'])} released by ${text(payload['holder'])}`;
    case 'resource.claimed':
      return `claimed ${text(payload['key'])}`;
    case 'resource.released':
      return `released ${text(payload['key'])}`;
    case 'resource.denied':
      return `${text(payload['key'])} denied · held by ${text(payload['holder'])}`;
    case 'guard.armed':
      return `guard ${text(payload['id'])} armed · every ${text(payload['everyMs'])} ms · ${text(payload['condition'])}`;
    case 'guard.checked':
      return `guard ${text(payload['id'])} checked (${text(payload['when'])}) · ${payload['holds'] === true ? 'holds' : 'BREACH'}`;
    case 'guard.breached':
      return `guard ${text(payload['id'])} breached · ${text(payload['condition'])}`;
    case 'guard.disarmed':
      return `guard ${text(payload['id'])} disarmed`;
    case 'branch.started':
      return `branch ${text(payload['branch'])} started on ${text(payload['resource'])}`;
    case 'branch.completed':
      return `branch ${text(payload['branch'])} ${text(payload['status'])} · ${text(payload['laneMs'])} ms${payload['code'] ? ` · ${text(payload['code'])}` : ''}`;
    case 'branch.cancelled':
      return `branch ${text(payload['branch'])} cancelled · ${text(payload['reason'])}`;
    case 'join.completed':
      return `${text(payload['policy'])} join ${text(payload['id'])} · ${text(payload['succeeded'])}/${text(payload['required'])} succeeded · ${text(payload['abstained'])} abstained · ${text(payload['failed'])} failed`;
    case 'loop.iteration':
      return `loop ${text(payload['id'])} iteration ${text(payload['iteration'])} of ${text(payload['of'])} (bound ${text(payload['bound'])})`;
    case 'loop.exhausted':
      return `loop ${text(payload['id'])} exhausted its bound`;
    case 'await.armed':
      return `await ${text(payload['id'])} armed · ${text(payload['kind'])} · within ${text(payload['withinMs'])} ms`;
    case 'await.suspended':
      return `await ${text(payload['id'])} suspended · ${text(payload['prompt'])}`;
    case 'await.resumed':
      return `await ${text(payload['id'])} answered`;
    case 'await.timeout':
      return `await ${text(payload['id'])} timed out`;
    case 'fault.entered':
      return `fault ${text(payload['code'])} at ${text(payload['statementId'])}${payload['inhibited'] === true ? ' (inhibiting)' : ''}`;
    case 'mode.degraded':
      return `degraded ${text(payload['from'])} → ${text(payload['to'])} · ${text(payload['reason'])}`;
    case 'mode.speed_capped':
      return `speed capped to ${JSON.stringify(payload['applied'])} (commanded ${JSON.stringify(payload['commanded'])})`;
    case 'safety.state_changed':
      return `safety ${text(payload['from'])} → ${text(payload['to'])}`;
    case 'safety.inhibited':
      return `safety inhibited ${text(payload['kind'])} · ${reasons(payload['reasons'])}`;
    case 'safety.function_tripped':
      return `${text(payload['id'])} tripped · ${text(payload['detail'])}`;
    case 'record.emitted':
      return `record ${text(payload['event'])} emitted`;
    case 'notify.sent':
      return `notify ${text(payload['audience'])} · severity ${text(payload['severity'])}`;
    case 'deadline.exceeded':
      return `${text(payload['id'])} took ${text(payload['tookMs'])} ms of a ${text(payload['budgetMs'])} ms budget`;
    case 'twin.frame':
      return `twin frame at ${text(payload['t'])} ms`;
    case 'checkpoint.saved':
      return `checkpoint at ${text(payload['cursor'])} · ${text(payload['clockMs'])} ms`;
    default:
      return kind;
  }
}

/** Kinds the timeline hides by default: they are rendered, not read. */
export const NOISY_KINDS: readonly string[] = ['twin.frame', 'statement.completed', 'permit.requested', 'resource.claimed', 'resource.released', 'permit.released'];

export function elapsedMsOf(event: RawJournalEvent, epochMs: number): number {
  if (typeof event.monotonicNs === 'number') return Math.round(event.monotonicNs / 1_000_000 - epochMs);
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed - epochMs : 0;
}

export function toJournalLine(event: RawJournalEvent, epochMs: number): JournalLine {
  const payload = event.payload;
  const statementId =
    (typeof payload['id'] === 'string' && payload['id']) ||
    (typeof payload['statementId'] === 'string' && payload['statementId']) ||
    null;
  return {
    sequence: event.sequence,
    kind: event.kind,
    t: elapsedMsOf(event, epochMs),
    timestamp: event.timestamp,
    source: event.source,
    safetyState: event.safetyState,
    quality: event.quality,
    statementId,
    summary: summariseEvent(event.kind, payload),
    payload,
  };
}
