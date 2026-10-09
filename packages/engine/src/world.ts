import type { SafetyState } from '@agrirobots/contracts';

import type { RuntimeValue } from './expr.ts';
import type { ResourcePolicy } from './resources.ts';
import type { Quantity, StateSnapshot } from './state.ts';

/** One capability call, already authorised by the gate. */
export interface CapabilityCall {
  capability: string;
  args: Record<string, RuntimeValue>;
  resources: string[];
  statementId: string;
  deadlineMs: number;
  idempotencyKey?: string;
  attempt: number;
  nowMs: number;
}

/** One motion command (move / dock / return_to). */
export interface TravelCall {
  kind: 'move' | 'dock' | 'return_to';
  target: string;
  speedLimit?: Quantity;
  tolerance?: Quantity;
  statementId: string;
  deadlineMs: number;
  nowMs: number;
}

export type DispatchOutcome = 'ok' | 'failed' | 'abstained';

export interface DispatchResult {
  outcome: DispatchOutcome;
  /** Simulated wall-clock duration; the engine advances the clock by this much. */
  durationMs: number;
  /** Values bound by `observe … into $x`. */
  observations?: Record<string, RuntimeValue>;
  errorCode?: string;
  message?: string;
  /** Post-condition overrides the world applied (e.g. a rejected egg). */
  notes?: string[];
}

/** Arm pose in the twin frame: angles in degrees, extension in metres. */
export interface TwinArm {
  id: string;
  shoulderYaw: number;
  elbowPitch: number;
  wristPitch: number;
  /** 0 = stowed, 1 = fully extended towards its target. */
  extension: number;
  suctionKpa: number;
  forceN: number;
  holding: string | null;
  state: 'stowed' | 'reaching' | 'sealing' | 'holding' | 'placing' | 'fault';
}

export interface TwinEgg {
  id: string;
  massG: number;
  grade: string;
  cracked: boolean;
}

export interface TwinNestSlot {
  id: string;
  /** Metres, carrier-relative: x forward, y left, z up (ROS REP-103). */
  x: number;
  y: number;
  z: number;
  egg: TwinEgg | null;
  scanned: boolean;
  confidence: number;
}

/** Geometry and telemetry the 3D twin draws. Compact enough to journal per step. */
export interface TwinFrame {
  t: number;
  carrier: {
    x: number;
    y: number;
    heading: number;
    speed: number;
    parked: boolean;
    tilt: number;
    armsDeployed: boolean;
    battery: number;
  };
  arms: TwinArm[];
  magazine: {
    trayIndex: number;
    trays: Array<{ index: number; filled: number; capacity: number }>;
    eggs: number;
    capacity: number;
  };
  nestBank: { id: string; x: number; y: number; slots: TwinNestSlot[] };
  tally: {
    offered: number;
    picked: number;
    placed: number;
    cracked: number;
    abstained: number;
    rejected: number;
  };
  safety: { state: SafetyState; tripped: string[] };
}

/**
 * The identity the engine binds into a world's `task` state root before
 * preflight. Idempotency keys are built from `task.run_id`, so a world that
 * hardcodes it would make two runs of one task indistinguishable.
 */
export interface MissionIdentity {
  runId: string;
  taskName: string;
  taskVersion: string;
}

/**
 * The world the engine executes against.
 *
 * The interpreter never touches geometry or physics directly: everything
 * physical is a `dispatch` or `travel` call, and everything readable is a
 * `snapshot`. That is what makes the same compiled task run against a scripted
 * test world, the ARACNID kinematic twin in the Virtual Lab, a Gazebo
 * simulation later, or the real machine through a ROS 2 bridge.
 */
export interface WorldModel {
  readonly carrierId: string;
  readonly cassetteId: string;
  /** Capabilities this world can actually execute. */
  readonly capabilities: readonly string[];
  /** Manifest approval for motion while a tool is in use (S11). */
  readonly motionDuringToolUse: boolean;

  snapshot(nowMs: number): StateSnapshot;
  dispatch(call: CapabilityCall): DispatchResult;
  travel(call: TravelCall): DispatchResult;
  twinFrame(nowMs: number, safety: { state: SafetyState; tripped: string[] }): TwinFrame;
  /** Lets time pass without an action (backoff, await, guard periods). */
  idle(durationMs: number): void;
  /** Stows tools and removes tool energy (`park_tool`). */
  parkTool?(): DispatchResult;
  /** Which resources exist and how they are shared; defaults to the ARACNID model. */
  resourcePolicy?: ResourcePolicy;
  /** Called once before preflight so `task.*` reads truthfully. */
  bindMission?(mission: MissionIdentity): void;
}

/** A scripted outcome, for deterministic engine tests and fault rehearsal. */
export interface ScriptedOutcome {
  /** Matches when the capability and (optionally) an argument agree. */
  capability: string;
  when?: (args: Record<string, RuntimeValue>) => boolean;
  result: Partial<DispatchResult> & { durationMs: number };
  /** Remove after use, so the next call falls back to the default. */
  once?: boolean;
}

export interface ScriptedWorldOptions {
  carrierId?: string;
  cassetteId?: string;
  capabilities?: string[];
  motionDuringToolUse?: boolean;
  tree?: Record<string, RuntimeValue>;
  outcomes?: ScriptedOutcome[];
  defaultDurationMs?: number;
}

/**
 * A world driven by a table of scripted outcomes. It exists so engine semantics
 * (deadlines, retries, quorum, guard breach, permit denial) can be tested
 * without any geometry, and so a fault can be rehearsed on demand.
 */
export class ScriptedWorld implements WorldModel {
  readonly carrierId: string;
  readonly cassetteId: string;
  readonly capabilities: readonly string[];
  readonly motionDuringToolUse: boolean;

  private tree: Record<string, RuntimeValue>;
  private readonly outcomes: ScriptedOutcome[];
  private readonly defaultDurationMs: number;
  private frames = 0;

  constructor(options: ScriptedWorldOptions = {}) {
    this.carrierId = options.carrierId ?? 'AR-01';
    this.cassetteId = options.cassetteId ?? 'EG-08';
    this.capabilities = options.capabilities ?? ['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1'];
    this.motionDuringToolUse = options.motionDuringToolUse ?? false;
    this.tree = {
      safety: {
        mode: 'AUTO_TASK',
        e_stop: false,
        arm_envelope_clear: true,
        presence_detected: false,
      },
      carrier: { parked: true, tilt: { value: 0.4, unit: 'deg' }, arms_deployed: false },
      cassette: { id: this.cassetteId, latch: 'LOCKED' },
      battery: { charge: { value: 92, unit: '%' } },
      tool: {},
      zone: { current_id: 'lay-house-3' },
      task: {
        name: 'scripted',
        version: '0.0.0',
        run_id: 'run-scripted',
        fault_reason: '',
        fault_node: '',
      },
      ...options.tree,
    };
    this.outcomes = [...(options.outcomes ?? [])];
    this.defaultDurationMs = options.defaultDurationMs ?? 250;
  }

  bindMission(mission: MissionIdentity): void {
    this.set('task.run_id', mission.runId);
    this.set('task.name', mission.taskName);
    this.set('task.version', mission.taskVersion);
  }

  /** Writes a value into the readable state tree (dotted path). */
  set(path: string, value: RuntimeValue): void {
    const parts = path.split('.');
    let cursor = this.tree as Record<string, RuntimeValue>;
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part];
      if (next && typeof next === 'object' && !Array.isArray(next)) {
        cursor = next as Record<string, RuntimeValue>;
      } else {
        cursor[part] = {};
        cursor = cursor[part] as Record<string, RuntimeValue>;
      }
    }
    cursor[parts[parts.length - 1]!] = value;
  }

  get(path: string): RuntimeValue {
    const parts = path.split('.');
    let current: RuntimeValue = this.tree[parts[0]!] ?? null;
    for (const part of parts.slice(1)) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = (current as Record<string, RuntimeValue>)[part] ?? null;
      } else {
        return null;
      }
    }
    return current;
  }

  snapshot(nowMs: number): StateSnapshot {
    return {
      tree: this.tree,
      sampledAtMs: { safety: nowMs, carrier: nowMs, cassette: nowMs, tool: nowMs, battery: nowMs },
      nowMs,
    };
  }

  dispatch(call: CapabilityCall): DispatchResult {
    this.frames += 1;
    const index = this.outcomes.findIndex(
      (outcome) => outcome.capability === call.capability && (outcome.when?.(call.args) ?? true),
    );
    if (index >= 0) {
      const outcome = this.outcomes[index]!;
      if (outcome.once) this.outcomes.splice(index, 1);
      return {
        outcome: outcome.result.outcome ?? 'ok',
        durationMs: outcome.result.durationMs,
        ...(outcome.result.observations ? { observations: outcome.result.observations } : {}),
        ...(outcome.result.errorCode ? { errorCode: outcome.result.errorCode } : {}),
        ...(outcome.result.message ? { message: outcome.result.message } : {}),
        ...(outcome.result.notes ? { notes: outcome.result.notes } : {}),
      };
    }
    return { outcome: 'ok', durationMs: this.defaultDurationMs };
  }

  travel(call: TravelCall): DispatchResult {
    this.set('carrier.parked', call.kind !== 'move');
    this.set('zone.current_id', call.target);
    return { outcome: 'ok', durationMs: this.defaultDurationMs * 4 };
  }

  twinFrame(nowMs: number, safety: { state: SafetyState; tripped: string[] }): TwinFrame {
    return {
      t: nowMs,
      carrier: {
        x: 0,
        y: 0,
        heading: 0,
        speed: 0,
        parked: this.get('carrier.parked') === true,
        tilt: 0,
        armsDeployed: false,
        battery: 92,
      },
      arms: [],
      magazine: { trayIndex: 0, trays: [], eggs: 0, capacity: 0 },
      nestBank: { id: 'nest-bank-3', x: 0, y: 0, slots: [] },
      tally: { offered: 0, picked: 0, placed: 0, cracked: 0, abstained: 0, rejected: 0 },
      safety,
    };
  }

  idle(_durationMs: number): void {
    this.frames += 1;
  }

  parkTool(): DispatchResult {
    this.set('carrier.arms_deployed', false);
    return { outcome: 'ok', durationMs: 600, notes: ['tools parked and de-energised'] };
  }
}
