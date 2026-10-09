import type { CompiledTask, IrBranch, IrExpr, IrStmt } from '@agrirobots/compiler-core';

import type { VirtualClock } from './clock.ts';
import {
  evaluate,
  ExpressionEvaluator,
  formatValue,
  type EvalContext,
  type RuntimeValue,
} from './expr.ts';
import type { Journal } from './journal.ts';
import type { ResourceArbitrator, ResourceLease } from './resources.ts';
import type { SafetyGate, PermitGrant } from './safety-gate.ts';
import type { IndependentSafetyModel, SafetyAssessment, SafetyRequest } from './safety-model.ts';
import { StateResolver, isQuantity, type Quantity, type StateSnapshot } from './state.ts';
import type { CapabilityCall, DispatchResult, TravelCall, TwinFrame, WorldModel } from './world.ts';

/** One resumable unit of interpretation. */
export type Step = Generator<void, void, void>;

export const DEGRADED_MODES = [
  'sensing_only',
  'shadow',
  'reduced_speed',
  'hold_position',
  'return_to_dock',
] as const;

export type DegradedMode = (typeof DEGRADED_MODES)[number];

/** The task ended itself with `finish`. */
export class FinishSignal {
  readonly status: 'success' | 'failed' | 'aborted';
  readonly errorCode?: string;
  readonly message?: string;

  constructor(status: 'success' | 'failed' | 'aborted', errorCode?: string, message?: string) {
    this.status = status;
    this.errorCode = errorCode;
    this.message = message;
  }
}

/** A physical action failed and no in-scope handler absorbed it. */
export class FaultSignal extends Error {
  readonly statementId: string;
  readonly code: string;
  readonly inhibited: boolean;

  constructor(statementId: string, code: string, message: string, inhibited = false) {
    super(message);
    this.name = 'FaultSignal';
    this.statementId = statementId;
    this.code = code;
    this.inhibited = inhibited;
  }
}

/** `on_breach <stmt-id>` / `on_timeout <stmt-id>`: run one labelled statement. */
export class JumpSignal {
  readonly target: string;
  readonly fromId: string;

  constructor(target: string, fromId: string) {
    this.target = target;
    this.fromId = fromId;
  }
}

/** The mission needs something the engine cannot produce by itself. */
export class SuspendSignal {
  readonly reason: 'operator' | 'event' | 'timer';
  readonly statementId: string;
  readonly prompt?: string;
  readonly choices?: string[];
  readonly deadlineMs?: number;

  constructor(
    reason: 'operator' | 'event' | 'timer',
    statementId: string,
    prompt?: string,
    choices?: string[],
    deadlineMs?: number,
  ) {
    this.reason = reason;
    this.statementId = statementId;
    this.prompt = prompt;
    this.choices = choices;
    this.deadlineMs = deadlineMs;
  }
}

export interface OperatorReply {
  reply: RuntimeValue;
}

/** How the host answers the questions a task may ask. */
export interface InterpreterHost {
  operator?(
    prompt: string,
    choices: string[] | undefined,
    statementId: string,
  ): OperatorReply | 'suspend';
  events?: { take(name: string): RuntimeValue | undefined };
  tasks?: Map<string, CompiledTask>;
}

export interface InterpreterOptions {
  compiled: CompiledTask;
  world: WorldModel;
  clock: VirtualClock;
  journal: Journal;
  gate: SafetyGate;
  resources: ResourceArbitrator;
  model: IndependentSafetyModel;
  motionDuringToolUse: boolean;
  host?: InterpreterHost;
  maxVisits?: number;
  traceTwin?: boolean;
}

interface Scope {
  /** Holder name used for resource arbitration; a branch owns its own. */
  holder: string;
  permits: PermitGrant[];
  branchClaims: string[];
  depth: number;
  path: string[];
}

interface Lane {
  branch: IrBranch;
  index: number;
  gen: Step;
  done: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'abstained' | 'cancelled';
  elapsed: number;
  fault?: FaultSignal;
}

export const DEFAULT_MAX_VISITS = 5000;

/**
 * The statement interpreter.
 *
 * Every statement is a generator, so a `parallel` block can step its branches
 * round-robin and a `guard` can re-check its condition between them without
 * threads, timers or parked coroutines. Execution is therefore single-threaded,
 * deterministic and replayable, which is what a signed task has to be.
 *
 * The interpreter has no authority: resources come from the arbitrator, energy
 * comes from the gate, physical effects come from the world, and time comes from
 * the clock. It can only sequence them and record what happened.
 */
export class Interpreter {
  private readonly variables = new Map<string, RuntimeValue>();
  /**
   * Idempotency ledger. A key mapped to a result was dispatched by this
   * interpreter; a key mapped to `null` was restored from a checkpoint, so the
   * action is not repeated but its post-conditions are re-verified against the
   * world before the mission is allowed to continue.
   */
  private readonly completedKeys = new Map<string, DispatchResult | null>();
  private readonly frames: TwinFrame[] = [];
  private visits = 0;
  /** True while `on_fault` runs: budgets that caused the fault cannot block it. */
  private inFaultClause = false;
  /** Set while a parallel branch is being stepped, so an abstention is visible. */
  private activeLane: Lane | undefined;
  private degraded: DegradedMode | null = null;
  private lastAssessment: SafetyAssessment | undefined;
  private finished: FinishSignal | undefined;

  private readonly options: InterpreterOptions;

  constructor(options: InterpreterOptions) {
    this.options = options;
  }

  get twinFrames(): TwinFrame[] {
    return this.frames;
  }

  get tally(): Record<string, number> {
    const frame = this.frames.at(-1);
    return frame ? { ...frame.tally } : {};
  }

  get visitCount(): number {
    return this.visits;
  }

  /** Runs `steps`; a fault runs `on_fault` exactly once. */
  *run(): Step {
    yield* this.runFrom(this.options.compiled.ir.steps);
  }

  /**
   * Runs one block of statements. A resumed mission uses this to continue from a
   * checkpointed cursor: the block is re-entered at statement granularity, which
   * is why every physical action carries an idempotency key (S10).
   */
  *runFrom(statements: IrStmt[]): Step {
    const scope: Scope = { holder: 'mission', permits: [], branchClaims: [], depth: 0, path: [] };
    try {
      yield* this.execBlock(statements, scope);
      this.finished ??= new FinishSignal('success');
    } catch (error) {
      if (error instanceof FinishSignal) {
        this.finished = error;
      } else if (error instanceof SuspendSignal) {
        throw error;
      } else if (error instanceof JumpSignal) {
        yield* this.runJump(error, scope);
      } else if (error instanceof FaultSignal) {
        this.options.journal.emit('fault.entered', {
          statementId: error.statementId,
          code: error.code,
          message: error.message,
          inhibited: error.inhibited,
        });
        yield* this.runFaultClause(error, scope);
      } else {
        throw error;
      }
    }
  }

  /**
   * The fault clause runs with no permits held and no resources claimed, and it
   * is exempt from the visit budget and the task deadline: a recovery path that
   * the very budget it is recovering from can block is not a recovery path.
   */
  private *runFaultClause(fault: FaultSignal, scope: Scope): Step {
    this.releaseAll(scope);
    const faultScope: Scope = { ...scope, permits: [], branchClaims: [], path: ['on_fault'] };
    this.options.journal.emit('statement.entered', { clause: 'on_fault', cause: fault.code });
    this.inFaultClause = true;
    try {
      yield* this.execBlock(this.options.compiled.ir.onFault, faultScope);
      this.finished ??= new FinishSignal('failed', fault.code, fault.message);
    } catch (error) {
      if (error instanceof FinishSignal) {
        this.finished = error;
      } else if (error instanceof FaultSignal) {
        // A fault inside the fault clause cannot recurse: stop and report.
        this.options.journal.emit('mission.inhibited', {
          reason: 'the fault clause itself faulted',
          code: error.code,
        });
        this.finished = new FinishSignal('failed', error.code, error.message);
      } else {
        throw error;
      }
    } finally {
      this.inFaultClause = false;
    }
  }

  private *runJump(jump: JumpSignal, scope: Scope): Step {
    const target = this.findById(jump.target);
    if (!target) {
      this.finished = new FinishSignal(
        'failed',
        'E_UNKNOWN_JUMP_TARGET',
        `no statement "${jump.target}"`,
      );
      return;
    }
    this.options.journal.emit('statement.entered', {
      id: target.id,
      via: `goto from ${jump.fromId}`,
    });
    yield* this.execStatement(target, scope);
    this.finished ??= new FinishSignal(
      'failed',
      'E_TASK_INCOMPLETE',
      `jumped to ${jump.target} and ran out of statements`,
    );
  }

  result(): FinishSignal {
    return (
      this.finished ?? new FinishSignal('failed', 'E_NO_TERMINATION', 'the task did not terminate')
    );
  }

  // -- blocks and statements -------------------------------------------------

  private *execBlock(statements: IrStmt[], scope: Scope): Step {
    for (const statement of statements) {
      yield* this.execStatement(statement, scope);
    }
  }

  private *execStatement(statement: IrStmt, scope: Scope): Step {
    this.visits += 1;
    const maxVisits = this.options.maxVisits ?? DEFAULT_MAX_VISITS;
    if (!this.inFaultClause && this.visits > maxVisits) {
      throw new FaultSignal(
        statement.id,
        'E_VISIT_BUDGET',
        `more than ${String(maxVisits)} statement visits`,
      );
    }

    const deadline = this.options.compiled.ir.statistics.taskDeadlineMs;
    if (!this.inFaultClause && deadline !== null && this.options.clock.elapsedMs() > deadline) {
      throw new FaultSignal(
        statement.id,
        'E_TASK_DEADLINE',
        `the task deadline of ${String(deadline)} ms expired after ${String(this.options.clock.elapsedMs())} ms`,
      );
    }

    const childScope: Scope = { ...scope, path: [...scope.path, statement.id] };
    this.options.journal.emit('statement.entered', {
      id: statement.id,
      kind: statement.kind,
      ...(statement.label ? { label: statement.label } : {}),
      path: childScope.path.join('/'),
      t: this.options.clock.elapsedMs(),
    });

    let interrupted = false;
    try {
      switch (statement.kind) {
        case 'move':
        case 'dock':
        case 'return_to':
          yield* this.execMotion(statement, childScope);
          break;
        case 'actuate':
          yield* this.execActuate(statement, childScope);
          break;
        case 'observe':
          yield* this.execObserve(statement, childScope);
          break;
        case 'await':
          yield* this.execAwait(statement, childScope);
          break;
        case 'with_permit':
          yield* this.execWithPermit(statement, childScope);
          break;
        case 'request_permit':
          yield* this.execRequestPermit(statement, childScope);
          break;
        case 'guard':
          yield* this.execGuard(statement, childScope);
          break;
        case 'for_each':
          yield* this.execForEach(statement, childScope);
          break;
        case 'repeat':
          for (let iteration = 0; iteration < statement.times; iteration += 1) {
            this.options.journal.emit('loop.iteration', {
              id: statement.id,
              iteration: iteration + 1,
              of: statement.times,
            });
            yield* this.execBlock(statement.body, childScope);
          }
          break;
        case 'when':
          yield* this.execWhen(statement, childScope);
          break;
        case 'parallel':
          yield* this.execParallel(statement, childScope);
          break;
        case 'sequence':
          yield* this.execBlock(statement.body, childScope);
          break;
        case 'record': {
          const fields: Record<string, RuntimeValue> = {};
          for (const field of statement.fields) fields[field.name] = this.eval(field.value);
          this.options.journal.emit('record.emitted', {
            id: statement.id,
            event: statement.event,
            fields,
          });
          break;
        }
        case 'safe_stop': {
          const reason = statement.reason
            ? formatValue(this.eval(statement.reason))
            : 'the task requested a safe stop';
          this.options.gate.requestSafeStop(reason);
          this.degraded = 'hold_position';
          break;
        }
        case 'park_tool': {
          const result = this.options.world.parkTool?.() ?? { outcome: 'ok', durationMs: 0 };
          this.options.clock.advance(result.durationMs);
          this.options.journal.emit('action.dispatched', {
            id: statement.id,
            capability: 'park_tool',
            durationMs: result.durationMs,
          });
          break;
        }
        case 'degrade_to': {
          const from = this.degraded;
          this.degraded = statement.mode as DegradedMode;
          // A degradation is the task's operating mode, not the safety state:
          // the safety model still owns AUTO_TASK / SAFE_STOP / UNKNOWN.
          this.options.journal.emit('mode.degraded', {
            id: statement.id,
            from: from ?? 'full',
            to: statement.mode,
            reason: statement.reason ? formatValue(this.eval(statement.reason)) : '',
          });
          break;
        }
        case 'notify':
          this.options.journal.emit('notify.sent', {
            id: statement.id,
            role: statement.role,
            severity: statement.severity,
            message: statement.message ?? '',
          });
          break;
        case 'run_task':
          yield* this.execRunTask(statement, childScope);
          break;
        case 'finish':
          throw new FinishSignal(
            statement.status,
            statement.errorCode,
            statement.message ? formatValue(this.eval(statement.message)) : undefined,
          );
        case 'noop':
          this.options.journal.emit('statement.skipped', {
            id: statement.id,
            text: statement.text ?? '',
          });
          break;
        default: {
          // Every grammar production is handled above; this is the fail-closed
          // path for an IR that does not match the compiled union.
          const unknown = statement as { id?: string; kind?: string };
          throw new FaultSignal(
            unknown.id ?? 'unknown',
            'E_UNKNOWN_STATEMENT',
            `cannot execute "${unknown.kind ?? 'unknown'}"`,
          );
        }
      }
    } catch (error) {
      interrupted = true;
      throw error;
    } finally {
      // A statement that threw — a fault, a suspension, a `finish` — did not
      // complete. Journalling it as completed would move the resume cursor past
      // work that never happened.
      if (statement.kind !== 'finish' && !interrupted) {
        this.options.journal.emit('statement.completed', {
          id: statement.id,
          kind: statement.kind,
          t: this.options.clock.elapsedMs(),
        });
        this.trace(statement.id);
      } else if (interrupted) {
        this.options.journal.emit('statement.interrupted', {
          id: statement.id,
          kind: statement.kind,
          t: this.options.clock.elapsedMs(),
        });
      }
    }
  }

  // -- motion ----------------------------------------------------------------

  /**
   * The speed this motion may command. `degrade_to reduced_speed` halves the
   * task's own travel-speed limit and journals the cap, so a slower round is
   * explainable from the trace instead of looking like a machine fault.
   */
  private speedLimitFor(
    statement: Extract<IrStmt, { kind: 'move' | 'dock' | 'return_to' }>,
  ): Quantity | undefined {
    const commanded =
      'speed' in statement && statement.speed ? (statement.speed as Quantity) : undefined;
    if (this.degraded !== 'reduced_speed') return commanded;

    const limit = this.options.compiled.ir.limits.find((entry) => entry.key === 'travel_speed');
    if (!limit) return commanded;
    const cap: Quantity = { value: limit.value / 2, unit: limit.unit };
    const applied =
      commanded && commanded.unit === cap.unit && commanded.value <= cap.value ? commanded : cap;
    this.options.journal.emit('mode.speed_capped', {
      id: statement.id,
      commanded: commanded ?? null,
      applied,
      cap,
    });
    return applied;
  }

  private *execMotion(
    statement: Extract<IrStmt, { kind: 'move' | 'dock' | 'return_to' }>,
    scope: Scope,
  ): Step {
    const target = this.targetOf(
      statement.kind === 'move'
        ? statement.route
        : statement.kind === 'dock'
          ? statement.station
          : statement.place,
    );
    if (
      this.degraded === 'sensing_only' ||
      this.degraded === 'shadow' ||
      this.degraded === 'hold_position'
    ) {
      throw new FaultSignal(
        statement.id,
        'E_DEGRADED',
        `motion is refused while degraded to ${this.degraded}`,
        true,
      );
    }
    if (this.degraded === 'return_to_dock' && statement.kind === 'move') {
      // Getting home is allowed; roaming is not.
      throw new FaultSignal(
        statement.id,
        'E_DEGRADED',
        'free travel is refused while degraded to return_to_dock; only dock and return_to remain',
        true,
      );
    }

    const resources = [...new Set([...scope.branchClaims, 'traction'])];
    this.authorize(statement.id, statement.kind, resources, scope, undefined);

    const speedLimit = this.speedLimitFor(statement);
    const call: TravelCall = {
      kind: statement.kind,
      target,
      ...(speedLimit ? { speedLimit } : {}),
      ...('tolerance' in statement && statement.tolerance
        ? { tolerance: statement.tolerance as Quantity }
        : {}),
      statementId: statement.id,
      deadlineMs: statement.within.ms,
      nowMs: this.options.clock.now(),
    };
    this.options.journal.emit('action.dispatched', {
      id: statement.id,
      kind: statement.kind,
      target,
      deadlineMs: statement.within.ms,
    });
    const result = this.options.world.travel(call);
    this.options.clock.advance(result.durationMs);
    this.options.world.idle(0);
    // Yield between the physical effect and its verification so the host (the
    // Virtual Lab, a test driver) can observe the world in between.
    yield;

    if (result.durationMs > statement.within.ms) {
      this.options.journal.emit('deadline.exceeded', {
        id: statement.id,
        budgetMs: statement.within.ms,
        tookMs: result.durationMs,
      });
      throw new FaultSignal(
        statement.id,
        'E_DEADLINE_EXCEEDED',
        `${statement.kind} to ${target} took ${String(result.durationMs)} ms of a ${String(statement.within.ms)} ms budget`,
      );
    }
    if (result.outcome !== 'ok') {
      throw new FaultSignal(
        statement.id,
        result.errorCode ?? 'E_MOTION_FAILED',
        result.message ?? `${statement.kind} to ${target} failed`,
      );
    }
    this.options.journal.emit('action.verified', {
      id: statement.id,
      target,
      durationMs: result.durationMs,
      notes: result.notes ?? [],
    });
  }

  // -- actuation -------------------------------------------------------------

  private *execActuate(statement: Extract<IrStmt, { kind: 'actuate' }>, scope: Scope): Step {
    if (this.degraded === 'sensing_only' || this.degraded === 'shadow') {
      throw new FaultSignal(
        statement.id,
        'E_DEGRADED',
        `actuation is refused while degraded to ${this.degraded}`,
        true,
      );
    }

    const usingKeys = (statement.using ?? []).map((spec) =>
      this.options.resources.resolve(spec, (expr) => this.eval(expr)),
    );
    const resources = [...new Set([...scope.branchClaims, ...usingKeys])];
    if (resources.length === 0) resources.push('tool');

    const idempotencyKey = statement.idempotencyKey
      ? formatValue(this.eval(statement.idempotencyKey))
      : statement.onMismatch?.kind === 'retry'
        ? formatValue(this.eval(statement.onMismatch.idempotencyKey))
        : undefined;

    const maxAttempts =
      statement.onMismatch?.kind === 'retry' ? statement.onMismatch.atMost + 1 : 1;
    let attempt = 0;
    let result: DispatchResult | undefined;

    // An idempotency key that has already been dispatched is replayed, not
    // re-executed: a resumed mission must never dose, pick or place twice. The
    // post-conditions are still re-verified against the world (docs/09 §6).
    if (idempotencyKey && this.completedKeys.has(idempotencyKey)) {
      const stored = this.completedKeys.get(idempotencyKey) ?? null;
      const replay: DispatchResult = stored ?? {
        outcome: 'ok',
        durationMs: 0,
        notes: ['restored from a checkpoint; post-conditions re-verified against the world'],
      };
      this.options.journal.emit('action.idempotent_replay', {
        id: statement.id,
        capability: statement.capability,
        idempotencyKey,
        restored: stored === null,
      });
      const verification = this.verify(statement, replay);
      if (verification.ok) {
        this.options.journal.emit('action.verified', {
          id: statement.id,
          capability: statement.capability,
          replayed: true,
          checks: verification.checks,
        });
        return;
      }
      this.options.journal.emit('action.mismatch', {
        id: statement.id,
        capability: statement.capability,
        replayed: true,
        reason: verification.reason,
        checks: verification.checks,
      });
      throw new FaultSignal(
        statement.id,
        'E_POSTCONDITION_FAILED',
        `${statement.capability} was replayed but the world no longer verifies: ${verification.reason}`,
      );
    }

    for (;;) {
      attempt += 1;
      this.authorize(statement.id, 'actuate', resources, scope, statement.capability);

      const call: CapabilityCall = {
        capability: statement.capability,
        args: this.argsOf(statement.args),
        resources,
        statementId: statement.id,
        deadlineMs: statement.within.ms,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        attempt,
        nowMs: this.options.clock.now(),
      };
      this.options.journal.emit('action.dispatched', {
        id: statement.id,
        capability: statement.capability,
        args: call.args,
        resources,
        attempt,
        deadlineMs: statement.within.ms,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      result = this.options.world.dispatch(call);
      this.options.clock.advance(result.durationMs);
      yield;

      if (result.durationMs > statement.within.ms) {
        this.options.journal.emit('deadline.exceeded', {
          id: statement.id,
          budgetMs: statement.within.ms,
          tookMs: result.durationMs,
        });
        throw new FaultSignal(
          statement.id,
          'E_DEADLINE_EXCEEDED',
          `${statement.capability} took ${String(result.durationMs)} ms of a ${String(statement.within.ms)} ms budget`,
        );
      }
      if (idempotencyKey) this.completedKeys.set(idempotencyKey, result);

      if (result.outcome === 'abstained') {
        // An abstention is neither a failure nor a success: the branch finished
        // without delivering, so it cannot satisfy a quorum.
        if (this.activeLane && this.activeLane.status === 'pending') {
          this.activeLane.status = 'abstained';
        }
        this.options.journal.emit('observation.abstained', {
          id: statement.id,
          capability: statement.capability,
          message: result.message ?? '',
        });
        return;
      }

      const verification = this.verify(statement, result);
      if (verification.ok) {
        this.options.journal.emit('action.verified', {
          id: statement.id,
          capability: statement.capability,
          attempt,
          durationMs: result.durationMs,
          checks: verification.checks,
          notes: result.notes ?? [],
        });
        return;
      }

      this.options.journal.emit('action.mismatch', {
        id: statement.id,
        capability: statement.capability,
        attempt,
        reason:
          result.outcome === 'failed'
            ? (result.message ?? result.errorCode ?? 'the action failed')
            : verification.reason,
        checks: verification.checks,
      });

      const mismatch = statement.onMismatch;
      if (!mismatch || mismatch.kind === 'fault' || attempt >= maxAttempts) {
        throw new FaultSignal(
          statement.id,
          result.outcome === 'failed'
            ? (result.errorCode ?? 'E_ACTION_FAILED')
            : 'E_POSTCONDITION_FAILED',
          result.outcome === 'failed'
            ? (result.message ?? `${statement.capability} failed`)
            : `${statement.capability} did not verify: ${verification.reason}`,
        );
      }

      const backoff = mismatch.backoff?.ms ?? 0;
      this.options.journal.emit('action.retry', {
        id: statement.id,
        attempt: attempt + 1,
        of: maxAttempts,
        backoffMs: backoff,
        idempotencyKey: idempotencyKey ?? null,
      });
      if (backoff > 0) {
        this.options.clock.advance(backoff);
        this.options.world.idle(backoff);
      }
    }
  }

  /** Post-conditions are re-read from the world, with their freshness honoured. */
  private verify(
    statement: Extract<IrStmt, { kind: 'actuate' }>,
    result: DispatchResult,
  ): {
    ok: boolean;
    reason: string;
    checks: Array<{ condition: string; passed: boolean; stale: boolean }>;
  } {
    if (result.outcome === 'failed') {
      return {
        ok: false,
        reason: result.message ?? result.errorCode ?? 'the action reported failure',
        checks: [],
      };
    }
    const snapshot = this.snapshot();
    const resolver = new StateResolver(snapshot);
    const context = this.evalContext(snapshot);
    const checks: Array<{ condition: string; passed: boolean; stale: boolean }> = [];

    for (const assertion of statement.verify) {
      const bound = assertion.freshnessMs ?? refFreshness(assertion.condition);
      let stale = false;
      if (bound !== undefined) {
        for (const path of refPaths(assertion.condition, context)) {
          if (resolver.ageOf(path) > bound) stale = true;
        }
      }
      let passed = false;
      try {
        passed = !stale && new ExpressionEvaluator(context).evaluateBoolean(assertion.condition);
      } catch {
        passed = false;
      }
      checks.push({ condition: describe(assertion.condition), passed, stale });
      if (!passed) {
        return {
          ok: false,
          reason: stale
            ? `${describe(assertion.condition)} could not be read fresh within ${String(bound)} ms`
            : `${describe(assertion.condition)} did not hold`,
          checks,
        };
      }
    }
    return { ok: true, reason: '', checks };
  }

  // -- observation -----------------------------------------------------------

  private *execObserve(statement: Extract<IrStmt, { kind: 'observe' }>, scope: Scope): Step {
    const resources = [...new Set([...scope.branchClaims, 'sensing'])];
    this.authorize(statement.id, 'observe', resources, scope, statement.capability);

    const call: CapabilityCall = {
      capability: statement.capability,
      args: this.argsOf(statement.args),
      resources,
      statementId: statement.id,
      deadlineMs: statement.within?.ms ?? 5000,
      attempt: 1,
      nowMs: this.options.clock.now(),
    };
    this.options.journal.emit('action.dispatched', {
      id: statement.id,
      capability: statement.capability,
      observe: true,
    });
    const result = this.options.world.dispatch(call);
    this.options.clock.advance(result.durationMs);
    yield;

    if (statement.within && result.durationMs > statement.within.ms) {
      this.options.journal.emit('deadline.exceeded', {
        id: statement.id,
        budgetMs: statement.within.ms,
        tookMs: result.durationMs,
      });
      throw new FaultSignal(
        statement.id,
        'E_DEADLINE_EXCEEDED',
        `${statement.capability} took ${String(result.durationMs)} ms of a ${String(statement.within.ms)} ms budget`,
      );
    }

    const observations: Record<string, RuntimeValue> = {
      ...(result.observations ?? {}),
      abstained: result.outcome === 'abstained',
    };
    this.variables.set(statement.into, observations);

    if (statement.abstainIf && result.outcome !== 'abstained') {
      const abstain = evaluate(statement.abstainIf, this.evalContext(this.snapshot()));
      if (abstain === true || abstain === 1) {
        observations['abstained'] = true;
        this.options.journal.emit('observation.abstained', {
          id: statement.id,
          into: statement.into,
          condition: describe(statement.abstainIf),
        });
      }
    }

    this.options.journal.emit(
      result.outcome === 'abstained' ? 'observation.abstained' : 'observation.stored',
      {
        id: statement.id,
        into: statement.into,
        capability: statement.capability,
        summary: summarise(observations),
      },
    );
  }

  // -- permits ---------------------------------------------------------------

  private *execWithPermit(statement: Extract<IrStmt, { kind: 'with_permit' }>, scope: Scope): Step {
    const keys = (statement.on ?? []).map((spec) =>
      this.options.resources.resolve(spec, (expr) => this.eval(expr)),
    );
    const decision = this.options.gate.requestPermit(
      scope.holder,
      statement.permit,
      keys,
      statement.lease?.ms,
      (request) => this.assess(request),
    );
    if (!decision.granted) {
      throw new FaultSignal(
        statement.id,
        'E_PERMIT_DENIED',
        `${statement.permit} was refused: ${decision.reason}`,
        true,
      );
    }
    const inner: Scope = {
      ...scope,
      permits: [...scope.permits, decision.permit],
      branchClaims: [...new Set([...scope.branchClaims, ...keys])],
    };
    try {
      yield* this.execBlock(statement.body, inner);
    } finally {
      this.options.gate.releasePermit(decision.permit.permitId);
    }
  }

  private *execRequestPermit(
    statement: Extract<IrStmt, { kind: 'request_permit' }>,
    scope: Scope,
  ): Step {
    const keys = (statement.on ?? []).map((spec) =>
      this.options.resources.resolve(spec, (expr) => this.eval(expr)),
    );
    const decision = this.options.gate.requestPermit(
      scope.holder,
      statement.permit,
      keys,
      statement.lease?.ms,
      (request) => this.assess(request),
    );
    if (!decision.granted) {
      if (statement.onDenied?.kind === 'goto')
        throw new JumpSignal(statement.onDenied.target, statement.id);
      throw new FaultSignal(
        statement.id,
        'E_PERMIT_DENIED',
        `${statement.permit} was refused: ${decision.reason}`,
        true,
      );
    }
    scope.permits.push(decision.permit);
    yield;
  }

  // -- guards ----------------------------------------------------------------

  private *execGuard(statement: Extract<IrStmt, { kind: 'guard' }>, scope: Scope): Step {
    this.options.journal.emit('guard.armed', {
      id: statement.id,
      condition: describe(statement.condition),
      everyMs: statement.every.ms,
      ...(statement.freshnessMs ? { freshnessMs: statement.freshnessMs } : {}),
    });

    let nextCheck = this.options.clock.now() + statement.every.ms;
    const check = (when: string): boolean => {
      const snapshot = this.snapshot();
      const context = this.evalContext(snapshot);
      const resolver = new StateResolver(snapshot);
      const bound = statement.freshnessMs ?? refFreshness(statement.condition);
      let stale = false;
      if (bound !== undefined) {
        for (const path of refPaths(statement.condition, context)) {
          if (resolver.ageOf(path) > bound) stale = true;
        }
      }
      let holds = false;
      try {
        holds = !stale && new ExpressionEvaluator(context).evaluateBoolean(statement.condition);
      } catch {
        holds = false;
      }
      this.options.journal.emit('guard.checked', {
        id: statement.id,
        when,
        holds,
        stale,
        t: this.options.clock.elapsedMs(),
      });
      if (!holds) {
        this.options.journal.emit('guard.breached', {
          id: statement.id,
          condition: describe(statement.condition),
          stale,
          reason: stale
            ? `the state read was older than ${String(bound)} ms`
            : 'the condition no longer holds',
        });
      }
      return holds;
    };

    if (!check('entry')) {
      this.breach(statement, scope);
      return;
    }

    for (const child of statement.body) {
      if (this.options.clock.now() >= nextCheck) {
        if (!check('periodic')) {
          this.breach(statement, scope);
          return;
        }
        nextCheck = this.options.clock.now() + statement.every.ms;
      }
      yield* this.execStatement(child, scope);
      if (!check('after-statement')) {
        this.breach(statement, scope);
        return;
      }
      nextCheck = this.options.clock.now() + statement.every.ms;
    }

    this.options.journal.emit('guard.disarmed', { id: statement.id });
  }

  private breach(statement: Extract<IrStmt, { kind: 'guard' }>, scope: Scope): never {
    void scope;
    if (statement.onBreach?.kind === 'goto')
      throw new JumpSignal(statement.onBreach.target, statement.id);
    // A breached guard is a safety-driven refusal, so it is inhibiting: the
    // mission ends with exit code 4, not with a plain execution failure.
    throw new FaultSignal(
      statement.id,
      'E_GUARD_BREACH',
      `guard ${statement.id} was breached: ${describe(statement.condition)}`,
      true,
    );
  }

  // -- loops -----------------------------------------------------------------

  private *execForEach(statement: Extract<IrStmt, { kind: 'for_each' }>, scope: Scope): Step {
    const snapshot = this.snapshot();
    const collection = evaluate(statement.collection, this.evalContext(snapshot));
    const items: RuntimeValue[] = Array.isArray(collection)
      ? collection
      : collection && typeof collection === 'object' && !isQuantity(collection)
        ? Object.values(collection as Record<string, RuntimeValue>)
        : [];

    const previous = this.variables.get(statement.variable);
    const bound = Math.min(items.length, statement.atMost);
    try {
      for (let index = 0; index < bound; index += 1) {
        this.variables.set(statement.variable, items[index] ?? null);
        this.options.journal.emit('loop.iteration', {
          id: statement.id,
          variable: statement.variable,
          iteration: index + 1,
          of: items.length,
          bound: statement.atMost,
          item: summariseValue(items[index] ?? null),
        });
        yield* this.execBlock(statement.body, scope);
      }
    } finally {
      if (previous === undefined) this.variables.delete(statement.variable);
      else this.variables.set(statement.variable, previous);
    }

    if (items.length > statement.atMost) {
      this.options.journal.emit('loop.exhausted', {
        id: statement.id,
        items: items.length,
        bound: statement.atMost,
      });
      if (statement.onExhausted?.kind === 'goto')
        throw new JumpSignal(statement.onExhausted.target, statement.id);
      if (statement.onExhausted?.kind === 'fault') {
        throw new FaultSignal(
          statement.id,
          'E_LOOP_EXHAUSTED',
          `${String(items.length)} items did not fit in the bound of ${String(statement.atMost)}`,
        );
      }
    }
  }

  private *execWhen(statement: Extract<IrStmt, { kind: 'when' }>, scope: Scope): Step {
    const snapshot = this.snapshot();
    const context = this.evalContext(snapshot);
    const resolver = new StateResolver(snapshot);
    const bound = statement.freshnessMs ?? refFreshness(statement.condition);
    let stale = false;
    if (bound !== undefined) {
      for (const path of refPaths(statement.condition, context)) {
        if (resolver.ageOf(path) > bound) stale = true;
      }
    }
    let holds = false;
    try {
      holds = !stale && new ExpressionEvaluator(context).evaluateBoolean(statement.condition);
    } catch {
      holds = false;
    }
    if (stale) {
      // A stale read is inhibiting: the branch that acts is not taken.
      this.options.journal.emit('statement.skipped', {
        id: statement.id,
        reason: `the condition read was older than ${String(bound)} ms`,
      });
    }

    if (holds) {
      yield* this.execBlock(statement.body, scope);
      return;
    }
    if (statement.otherwise) yield* this.execBlock(statement.otherwise, scope);
  }

  // -- parallel --------------------------------------------------------------

  private *execParallel(statement: Extract<IrStmt, { kind: 'parallel' }>, scope: Scope): Step {
    const lanes: Lane[] = statement.branches.map((branch, index) => {
      const holder = `${scope.holder}/${statement.id}/${branch.id ?? `b${String(index)}`}`;
      const claims = [this.options.resources.resolve(branch.resource, (expr) => this.eval(expr))];
      const branchScope: Scope = {
        ...scope,
        holder,
        branchClaims: [...new Set([...scope.branchClaims, ...claims])],
      };
      const gen = this.execBranch(branch, branchScope, claims);
      return { branch, index, gen, done: false, status: 'pending', elapsed: 0 };
    });

    const required =
      statement.join.kind === 'quorum'
        ? statement.join.count
        : statement.join.kind === 'first_success'
          ? 1
          : lanes.length;

    this.options.clock.pushLane();
    let firstFault: FaultSignal | undefined;

    try {
      for (;;) {
        const pending = lanes.filter((lane) => !lane.done);
        if (pending.length === 0) break;

        let progressed = false;
        for (const lane of pending) {
          this.options.clock.setLaneElapsed(lane.elapsed);
          this.activeLane = lane;
          try {
            const step = lane.gen.next();
            progressed = true;
            if (step.done) {
              lane.done = true;
              if (lane.status === 'pending') lane.status = 'succeeded';
              this.options.journal.emit('branch.completed', {
                id: statement.id,
                branch: lane.branch.id ?? `b${String(lane.index)}`,
                status: lane.status,
                laneMs: this.options.clock.laneElapsed(),
              });
            }
          } catch (error) {
            lane.done = true;
            progressed = true;
            if (error instanceof FaultSignal) {
              lane.status = 'failed';
              lane.fault = error;
              firstFault ??= error;
              this.options.journal.emit('branch.completed', {
                id: statement.id,
                branch: lane.branch.id ?? `b${String(lane.index)}`,
                status: 'failed',
                code: error.code,
                message: error.message,
              });
            } else {
              // finish, jump and suspend escape the join: they end the mission.
              this.options.clock.setLaneElapsed(lane.elapsed);
              throw error;
            }
          }
          lane.elapsed = this.options.clock.laneElapsed();
          this.activeLane = undefined;
        }

        const succeeded = lanes.filter((lane) => lane.status === 'succeeded').length;
        const stillPending = lanes.filter((lane) => !lane.done).length;

        // One scheduling round per yield: the host sees lane progress as it
        // happens instead of only at the join.
        yield;

        if (
          statement.join.kind === 'first_success' &&
          lanes.some((lane) => lane.status === 'succeeded')
        )
          break;
        if (statement.join.kind === 'quorum' && succeeded >= required) break;
        if (statement.join.kind === 'all' && lanes.some((lane) => lane.status === 'failed')) break;
        if (succeeded + stillPending < required) break;
        if (!progressed) break;
      }

      for (const lane of lanes.filter((candidate) => !candidate.done)) {
        lane.status = 'cancelled';
        lane.done = true;
        this.options.journal.emit('branch.cancelled', {
          id: statement.id,
          branch: lane.branch.id ?? `b${String(lane.index)}`,
          reason: `the join policy ${statement.join.kind} was satisfied`,
        });
      }
    } finally {
      const slowest = lanes.reduce((max, lane) => Math.max(max, lane.elapsed), 0);
      this.options.clock.setLaneElapsed(slowest);
      this.options.clock.popLane();
    }

    const succeeded = lanes.filter((lane) => lane.status === 'succeeded').length;
    const abstained = lanes.filter((lane) => lane.status === 'abstained').length;
    const failed = lanes.filter((lane) => lane.status === 'failed').length;

    this.options.journal.emit('join.completed', {
      id: statement.id,
      policy: statement.join.kind,
      required,
      succeeded,
      abstained,
      failed,
      cancelled: lanes.filter((lane) => lane.status === 'cancelled').length,
      laneMs: lanes.map((lane) => lane.elapsed),
    });

    if (succeeded < required) {
      throw (
        firstFault ??
        new FaultSignal(
          statement.id,
          'E_QUORUM_UNMET',
          `the ${statement.join.kind} join needed ${String(required)} successful branches and got ${String(succeeded)} (${String(abstained)} abstained)`,
        )
      );
    }
  }

  private *execBranch(branch: IrBranch, scope: Scope, claims: string[]): Step {
    const acquisition = this.options.resources.acquire(
      scope.holder,
      claims,
      this.options.clock.now(),
    );
    if (!acquisition.granted) {
      this.options.journal.emit('resource.denied', {
        branch: branch.id ?? '',
        key: acquisition.key,
        heldBy: acquisition.holder ?? null,
        reason: acquisition.reason,
      });
      // A denial is inhibiting: the branch fails, it never shares a resource.
      throw new FaultSignal(branch.id ?? 'branch', 'E_RESOURCE_DENIED', acquisition.reason, true);
    }
    let leaseIds: string[] = acquisition.leases.map((lease: ResourceLease) => lease.id);
    this.options.journal.emit('branch.started', {
      branch: branch.id ?? '',
      resources: claims,
      leases: leaseIds,
    });
    try {
      yield* this.execBlock(branch.body, scope);
    } finally {
      if (leaseIds.length > 0) {
        this.options.resources.release(leaseIds);
        leaseIds = [];
      }
    }
  }

  // -- await -----------------------------------------------------------------

  private *execAwait(statement: Extract<IrStmt, { kind: 'await' }>, scope: Scope): Step {
    void scope;
    const target = statement.target;
    const deadlineAt = this.options.clock.now() + statement.within.ms;
    this.options.journal.emit('await.armed', {
      id: statement.id,
      kind: target.kind,
      withinMs: statement.within.ms,
    });

    if (target.kind === 'operator') {
      const host = this.options.host;
      const answer = host?.operator
        ? host.operator(target.prompt ?? '', target.choices, statement.id)
        : 'suspend';
      if (answer === 'suspend') {
        // Suspension is data, not a parked thread: the checkpoint carries the
        // cursor, the clock and the variables, and the process may exit here.
        this.options.journal.emit('await.suspended', {
          id: statement.id,
          reason: 'operator',
          prompt: target.prompt ?? '',
          withinMs: statement.within.ms,
        });
        throw new SuspendSignal(
          'operator',
          statement.id,
          target.prompt,
          target.choices,
          statement.within.ms,
        );
      }
      if (target.replyInto) this.variables.set(target.replyInto, answer.reply);
      this.options.journal.emit('await.resumed', {
        id: statement.id,
        reply: summariseValue(answer.reply),
      });
      return;
    }

    if (target.kind === 'event') {
      const value = this.options.host?.events?.take(target.name ?? '');
      if (value === undefined) {
        this.options.clock.advance(Math.max(0, deadlineAt - this.options.clock.now()));
        this.options.journal.emit('await.timeout', { id: statement.id, event: target.name ?? '' });
        this.timeout(statement);
        return;
      }
      this.options.journal.emit('await.resumed', { id: statement.id, event: target.name ?? '' });
      return;
    }

    if (target.kind === 'completion') {
      const completed = this.options.journal
        .of('statement.completed')
        .some((event) => (event.payload as Record<string, unknown>)['id'] === target.ofStatement);
      if (!completed) {
        this.options.clock.advance(Math.max(0, deadlineAt - this.options.clock.now()));
        this.options.journal.emit('await.timeout', {
          id: statement.id,
          ofStatement: target.ofStatement ?? '',
        });
        this.timeout(statement);
      }
      return;
    }

    // condition: poll at 100 ms until it holds or the deadline passes
    const step = 100;
    for (;;) {
      const holds = evaluate(target.condition!, this.evalContext(this.snapshot())) === true;
      if (holds) {
        this.options.journal.emit('await.resumed', {
          id: statement.id,
          condition: describe(target.condition!),
        });
        return;
      }
      if (this.options.clock.now() >= deadlineAt) {
        this.options.journal.emit('await.timeout', { id: statement.id });
        this.timeout(statement);
        return;
      }
      this.options.clock.advance(step);
      this.options.world.idle(step);
      yield;
    }
  }

  private timeout(statement: Extract<IrStmt, { kind: 'await' }>): void {
    if (statement.onTimeout?.kind === 'goto')
      throw new JumpSignal(statement.onTimeout.target, statement.id);
    throw new FaultSignal(
      statement.id,
      'E_AWAIT_TIMEOUT',
      `await ${statement.id} timed out after ${String(statement.within.ms)} ms`,
    );
  }

  // -- subtasks --------------------------------------------------------------

  private *execRunTask(statement: Extract<IrStmt, { kind: 'run_task' }>, scope: Scope): Step {
    const key = statement.task;
    const compiled = this.options.host?.tasks?.get(key);
    if (!compiled) {
      throw new FaultSignal(
        statement.id,
        'E_SUBTASK_NOT_INSTALLED',
        `subtask ${key} is not installed`,
      );
    }
    if (scope.depth + 1 > statement.depthAtMost) {
      throw new FaultSignal(
        statement.id,
        'E_SUBTASK_DEPTH',
        `subtask depth ${String(scope.depth + 1)} exceeds ${String(statement.depthAtMost)}`,
      );
    }
    const child = new Interpreter({
      ...this.options,
      compiled,
      host: this.options.host,
    });
    const childScope: Scope = {
      ...scope,
      depth: scope.depth + 1,
      holder: `${scope.holder}/${statement.id}`,
    };
    yield* child.runInScope(childScope);
    const outcome = child.result();
    this.options.journal.emit('statement.completed', {
      id: statement.id,
      subtask: key,
      status: outcome.status,
    });
    if (outcome.status !== 'success') {
      throw new FaultSignal(
        statement.id,
        outcome.errorCode ?? 'E_SUBTASK_FAILED',
        `subtask ${key} ${outcome.status}: ${outcome.message ?? ''}`,
      );
    }
  }

  /** Entry point for a subtask running inside a parent scope. */
  *runInScope(scope: Scope): Step {
    try {
      yield* this.execBlock(this.options.compiled.ir.steps, scope);
      this.finished ??= new FinishSignal('success');
    } catch (error) {
      if (error instanceof FinishSignal) this.finished = error;
      else throw error;
    }
  }

  // -- shared helpers --------------------------------------------------------

  private releaseAll(scope: Scope): void {
    for (const permit of [...scope.permits]) this.options.gate.releasePermit(permit.permitId);
    scope.permits.length = 0;
    for (const lease of this.options.resources.releaseByHolder(scope.holder)) {
      this.options.journal.emit('resource.released', {
        key: lease.key,
        holder: lease.holder,
        reason: 'fault unwind',
      });
    }
  }

  /** Asks the gate; a denial throws, because it is inhibiting and final. */
  private authorize(
    statementId: string,
    kind: string,
    resources: string[],
    scope: Scope,
    capability?: string,
  ): void {
    const request: SafetyRequest = {
      kind,
      ...(capability ? { capability } : {}),
      resources,
      permits: scope.permits.map((permit) => permit.kind),
      motionDuringToolUse: this.options.motionDuringToolUse,
    };
    const decision = this.options.gate.authorize(request, (inner) => this.assess(inner));
    if (!decision.allowed) {
      throw new FaultSignal(
        statementId,
        'E_SAFETY_INHIBITED',
        `the independent safety model refused ${capability ?? kind}: ${decision.reasons.join('; ')}`,
        true,
      );
    }
    this.lastAssessment = decision.assessment;
  }

  private assess(request: SafetyRequest): SafetyAssessment {
    const assessment = this.options.model.assess(this.snapshot(), request);
    this.lastAssessment = assessment;
    for (const fn of assessment.functions) {
      if (fn.tripped) {
        this.options.journal.emit('safety.function_tripped', {
          id: fn.id,
          effect: fn.effect ?? '',
          detail: fn.detail ?? '',
          state: assessment.state,
        });
      }
    }
    return assessment;
  }

  safetyAssessment(): SafetyAssessment | undefined {
    return this.lastAssessment;
  }

  private snapshot(): StateSnapshot {
    return this.options.world.snapshot(this.options.clock.now());
  }

  private evalContext(snapshot: StateSnapshot): EvalContext {
    return {
      resolver: new StateResolver(snapshot),
      variables: this.variables,
      inZone: (value, zone) => {
        const current = readPath(snapshot, 'zone.current_id');
        const text = typeof value === 'string' ? value : formatValue(value);
        return text === zone || String(current ?? '') === zone;
      },
    };
  }

  private eval(expr: IrExpr): RuntimeValue {
    return evaluate(expr, this.evalContext(this.snapshot()));
  }

  private argsOf(args: Array<{ name: string; value: IrExpr }>): Record<string, RuntimeValue> {
    const snapshot = this.snapshot();
    const context = this.evalContext(snapshot);
    const out: Record<string, RuntimeValue> = {};
    for (const arg of args) out[arg.name] = evaluate(arg.value, context);
    return out;
  }

  private targetOf(target: { zone?: string; expr?: IrExpr }): string {
    if (target.zone) return target.zone;
    if (target.expr) {
      const value = this.eval(target.expr);
      return typeof value === 'string' ? value : formatValue(value);
    }
    return '';
  }

  private findById(id: string): IrStmt | undefined {
    const search = (statements: IrStmt[]): IrStmt | undefined => {
      for (const statement of statements) {
        if (statement.id === id) return statement;
        const nested = nestedStatements(statement);
        const found = search(nested);
        if (found) return found;
      }
      return undefined;
    };
    return search([...this.options.compiled.ir.steps, ...this.options.compiled.ir.onFault]);
  }

  /** Records a twin frame after each statement, for the 3D replay. */
  private trace(statementId: string): void {
    if (this.options.traceTwin === false) return;
    const assessment = this.lastAssessment;
    const frame = this.options.world.twinFrame(this.options.clock.elapsedMs(), {
      state: this.options.gate.isStopped() ? 'SAFE_STOP' : (assessment?.state ?? 'UNKNOWN'),
      tripped: (assessment?.functions ?? []).filter((fn) => fn.tripped).map((fn) => fn.id),
    });
    this.frames.push(frame);
    this.options.journal.emit('twin.frame', {
      statementId,
      t: frame.t,
      carrier: frame.carrier,
      arms: frame.arms.map((arm) => ({
        id: arm.id,
        state: arm.state,
        holding: arm.holding,
        extension: arm.extension,
      })),
      tally: frame.tally,
      safety: frame.safety,
    });
  }

  /** Restores variables from a checkpoint (resume). */
  /** Keys already dispatched before a suspension; restored on resume. */
  restoreCompletedKeys(keys: readonly string[]): void {
    for (const key of keys) if (!this.completedKeys.has(key)) this.completedKeys.set(key, null);
  }

  completedKeyList(): string[] {
    return [...this.completedKeys.keys()];
  }

  restoreVariables(variables: Record<string, RuntimeValue>): void {
    this.variables.clear();
    for (const [key, value] of Object.entries(variables)) this.variables.set(key, value);
  }

  variablesSnapshot(): Record<string, RuntimeValue> {
    return Object.fromEntries(this.variables.entries());
  }
}

/** Every statement nested inside a statement, one level deep. */
export function nestedStatements(statement: IrStmt): IrStmt[] {
  const out: IrStmt[] = [];
  const record = statement as unknown as Record<string, unknown>;
  if (Array.isArray(record['body'])) out.push(...(record['body'] as IrStmt[]));
  if (Array.isArray(record['otherwise'])) out.push(...(record['otherwise'] as IrStmt[]));
  if (statement.kind === 'parallel') {
    for (const branch of statement.branches) out.push(...branch.body);
  }
  return out;
}

function readPath(snapshot: StateSnapshot, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = snapshot.tree[parts[0]!];
  for (const part of parts.slice(1)) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return current ?? null;
}

/** The tightest freshness bound written anywhere inside an expression. */
function refFreshness(expr: IrExpr): number | undefined {
  let bound: number | undefined;
  const visit = (node: IrExpr): void => {
    if (node.kind === 'ref' && node.freshnessMs !== undefined) {
      bound = bound === undefined ? node.freshnessMs : Math.min(bound, node.freshnessMs);
      for (const step of node.steps) if (step.type === 'index') visit(step.expr);
      return;
    }
    switch (node.kind) {
      case 'binary':
        visit(node.left);
        visit(node.right);
        return;
      case 'unary':
        visit(node.operand);
        return;
      case 'call':
        for (const arg of node.args) visit(arg);
        return;
      case 'list':
        for (const item of node.items) visit(item);
        return;
      case 'struct':
        for (const field of node.fields) visit(field.value);
        return;
      default:
        return;
    }
  };
  visit(expr);
  return bound;
}

/** Dotted state paths an expression reads, for freshness checks. */
function refPaths(expr: IrExpr, context: EvalContext): string[] {
  const paths: string[] = [];
  const visit = (node: IrExpr): void => {
    if (node.kind === 'ref') {
      if (node.base.type === 'state') {
        try {
          paths.push(
            context.resolver.resolve(node, {
              read: (name) => context.variables.get(name),
              evaluate: (inner) => evaluate(inner, context),
            }).path,
          );
        } catch {
          // An unreadable path is reported by the caller as a stale read.
        }
      }
      for (const step of node.steps) if (step.type === 'index') visit(step.expr);
      return;
    }
    switch (node.kind) {
      case 'binary':
        visit(node.left);
        visit(node.right);
        return;
      case 'unary':
        visit(node.operand);
        return;
      case 'call':
        for (const arg of node.args) visit(arg);
        return;
      default:
        return;
    }
  };
  visit(expr);
  return paths;
}

function describe(expr: IrExpr): string {
  switch (expr.kind) {
    case 'ref': {
      const base = expr.base.type === 'state' ? expr.base.root : `$${expr.base.name}`;
      const steps = expr.steps
        .map((step) => (step.type === 'field' ? `.${step.name}` : `[${describe(step.expr)}]`))
        .join('');
      return `${base}${steps}`;
    }
    case 'quantity':
      return `${String(expr.value)} ${expr.unit}`;
    case 'number':
      return String(expr.value);
    case 'string':
      return `"${expr.value}"`;
    case 'boolean':
      return String(expr.value);
    case 'enum':
      return `#${expr.name}`;
    case 'null':
      return 'null';
    case 'binary':
      return `${describe(expr.left)} ${expr.op} ${describe(expr.right)}`;
    case 'unary':
      return `${expr.op}${describe(expr.operand)}`;
    case 'call':
      return `${expr.name}(${expr.args.map(describe).join(', ')})`;
    case 'list':
      return `[${expr.items.map(describe).join(', ')}]`;
    case 'struct':
      return `{ ${expr.fields.map((field) => `${field.name} = ${describe(field.value)}`).join(', ')} }`;
    default:
      return '?';
  }
}

function summarise(observations: Record<string, RuntimeValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(observations)) {
    out[key] = Array.isArray(value) ? `[${String(value.length)} items]` : summariseValue(value);
  }
  return out;
}

function summariseValue(value: RuntimeValue): unknown {
  if (value === null || value === undefined) return null;
  if (isQuantity(value)) return `${String(value.value)} ${value.unit}`;
  if (Array.isArray(value)) return `[${String(value.length)} items]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length > 6 ? `{${keys.slice(0, 6).join(', ')}, …}` : value;
  }
  return value;
}
