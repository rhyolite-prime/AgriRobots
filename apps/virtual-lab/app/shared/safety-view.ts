import type { JournalLine, TwinFrameData } from './lab-types';

/**
 * Derives "what does the machine hold right now" from the journal.
 *
 * The browser is not allowed to decide a safety question, and it does not: this
 * only replays what the server-side gate already journaled — which permits were
 * granted and not yet released, which resources are claimed, which functions
 * tripped. Pure function of the journal prefix, so the panel and the tests read
 * the same thing.
 */
export interface PermitView {
  permitId: string;
  kind: string;
  holder: string;
  resources: string[];
  sinceT: number;
  expiresAtMs: number | null;
}

export interface ClaimView {
  key: string;
  holder: string;
  exclusive: boolean;
  sinceT: number;
}

export interface SafetyView {
  state: string;
  tripped: string[];
  inhibited: boolean;
  reasons: string[];
  permits: PermitView[];
  claims: ClaimView[];
  denials: Array<{ t: number; kind: string; holder: string; reason: string }>;
  guardBreaches: Array<{ t: number; id: string }>;
  safeStop: { t: number; reason: string } | null;
  degraded: string | null;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).join('; ');
  return String(value);
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

/** Replays journal lines up to (and including) the given time. */
export function deriveSafetyView(lines: readonly JournalLine[], untilT: number, frame?: TwinFrameData | null): SafetyView {
  const permits = new Map<string, PermitView>();
  const claims = new Map<string, ClaimView>();
  const tripped = new Set<string>();
  const reasons: string[] = [];
  const denials: SafetyView['denials'] = [];
  const guardBreaches: SafetyView['guardBreaches'] = [];
  let state = frame?.safety.state ?? 'UNKNOWN';
  let inhibited = false;
  let safeStop: SafetyView['safeStop'] = null;
  let degraded: string | null = null;

  for (const line of lines) {
    if (line.t > untilT) break;
    const payload = line.payload;
    switch (line.kind) {
      case 'permit.granted': {
        const permitId = text(payload['permitId']) || `${text(payload['holder'])}:${text(payload['kind'])}`;
        permits.set(permitId, {
          permitId,
          kind: text(payload['kind']),
          holder: text(payload['holder']),
          resources: list(payload['resources']),
          sinceT: line.t,
          expiresAtMs: typeof payload['expiresAtMs'] === 'number' ? payload['expiresAtMs'] : null,
        });
        break;
      }
      case 'permit.released':
      case 'permit.expired': {
        const permitId = text(payload['permitId']);
        if (permitId) permits.delete(permitId);
        break;
      }
      case 'permit.denied':
        denials.push({
          t: line.t,
          kind: text(payload['kind']),
          holder: text(payload['holder']),
          reason: text(payload['reason'] ?? payload['reasons']),
        });
        break;
      case 'resource.claimed':
        claims.set(text(payload['key']), {
          key: text(payload['key']),
          holder: text(payload['holder']),
          exclusive: payload['exclusive'] !== false,
          sinceT: line.t,
        });
        break;
      case 'resource.released':
        claims.delete(text(payload['key']));
        break;
      case 'resource.denied':
        denials.push({
          t: line.t,
          kind: `resource ${text(payload['key'])}`,
          holder: text(payload['holder']),
          reason: text(payload['reason']),
        });
        break;
      case 'safety.state_changed':
        state = text(payload['to']) || state;
        if (state === 'SAFE_STOP' && !safeStop) {
          safeStop = { t: line.t, reason: text(payload['reason']) };
        }
        break;
      case 'safety.function_tripped':
        tripped.add(text(payload['id']));
        break;
      case 'safety.inhibited':
        inhibited = true;
        for (const id of list(payload['functions'])) tripped.add(id);
        for (const reason of list(payload['reasons'])) if (!reasons.includes(reason)) reasons.push(reason);
        break;
      case 'guard.breached':
        guardBreaches.push({ t: line.t, id: text(payload['id']) });
        break;
      case 'fault.entered':
        if (payload['inhibited'] === true) inhibited = true;
        break;
      case 'mode.degraded':
        degraded = text(payload['to']) || degraded;
        break;
      default:
        break;
    }
  }

  if (frame) {
    state = frame.safety.state;
    for (const id of frame.safety.tripped) tripped.add(id);
  }

  return {
    state,
    tripped: [...tripped].sort(),
    inhibited,
    reasons,
    permits: [...permits.values()].sort((left, right) => left.sinceT - right.sinceT),
    claims: [...claims.values()].sort((left, right) => left.sinceT - right.sinceT),
    denials,
    guardBreaches,
    safeStop,
    degraded,
  };
}

/** The twin frame to draw at a mission time, plus the blend into the next one. */
export function frameAt(frames: readonly TwinFrameData[], t: number): { frame: TwinFrameData | null; next: TwinFrameData | null; alpha: number } {
  if (frames.length === 0) return { frame: null, next: null, alpha: 1 };
  if (t <= (frames[0]?.t ?? 0)) return { frame: frames[0] ?? null, next: frames[1] ?? null, alpha: 0 };
  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index]!;
    const following = frames[index + 1]!;
    if (t >= current.t && t <= following.t) {
      const span = following.t - current.t;
      return { frame: current, next: following, alpha: span > 0 ? (t - current.t) / span : 1 };
    }
  }
  const last = frames[frames.length - 1]!;
  return { frame: last, next: null, alpha: 1 };
}

/** Statements the run touched, in order, for the trace strip. */
export function visitedStatements(lines: readonly JournalLine[], untilT: number): string[] {
  const seen: string[] = [];
  for (const line of lines) {
    if (line.t > untilT) break;
    if (line.kind !== 'statement.entered') continue;
    const id = line.statementId;
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}
