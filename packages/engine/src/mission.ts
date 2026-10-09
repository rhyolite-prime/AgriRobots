import type {
  ConfigurationIds,
  EventSource,
  JournalEvent,
  SafetyState,
} from '@agrirobots/contracts';
import { isMissionPermitting } from '@agrirobots/contracts';
import type { CompiledTask, TaskValidationContext } from '@agrirobots/compiler-core';
import { compileTaskSource } from '@agrirobots/compiler-core';

import { DEFAULT_MISSION_EPOCH_MS, VirtualClock, type Clock } from './clock.ts';
import { ExpressionEvaluator, type RuntimeValue } from './expr.ts';
import {
  Interpreter,
  SuspendSignal,
  type DegradedMode,
  type InterpreterHost,
} from './interpreter.ts';
import { Journal } from './journal.ts';
import { aracnidResourcePolicy, ResourceArbitrator } from './resources.ts';
import { SafetyGate } from './safety-gate.ts';
import { IndependentSafetyModel, type SafetyAssessment } from './safety-model.ts';
import { StateResolver, type StateSnapshot } from './state.ts';
import type { TwinFrame, WorldModel } from './world.ts';

/** Exit codes, extending the SapoEngine convention (docs/09 §8). */
export const EXIT_CODES = {
  success: 0,
  executionFailed: 1,
  usageOrValidation: 2,
  suspended: 3,
  safetyInhibited: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type MissionStatus = 'completed' | 'failed' | 'aborted' | 'suspended' | 'inhibited';

/** Bumped whenever the checkpoint shape changes; a mismatch refuses resume. */
export const CHECKPOINT_VERSION = 2;

export interface MissionCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  runId: string;
  irHash: string;
  sourceHash: string;
  taskName: string;
  taskVersion: string;
  status: MissionStatus;
  /**
   * Top-level statement that completed last; resume continues after it. For a
   * suspended mission this names the statement that suspended, which resume
   * re-enters so the operator's answer is bound on the second pass.
   */
  cursor: { statementId: string; path: string[] };
  /** Idempotency keys already dispatched, so a restart replays instead of repeating. */
  completedKeys: string[];
  clockMs: number;
  variables: Record<string, RuntimeValue>;
  visits: number;
  safetyStop: boolean;
  degraded: DegradedMode | null;
  tally: Record<string, number>;
  createdAt: string;
}

export interface MissionResult {
  status: MissionStatus;
  exitCode: ExitCode;
  runId: string;
  taskName: string;
  taskVersion: string;
  irHash: string;
  sourceHash: string;
  elapsedMs: number;
  message?: string;
  errorCode?: string;
  journal: JournalEvent[];
  journalHash: string;
  twinFrames: TwinFrame[];
  tally: Record<string, number>;
  visits: number;
  safety: { state: SafetyState; tripped: string[]; inhibited: boolean; reasons: string[] };
  checkpoint: MissionCheckpoint;
  suspended?: { reason: string; prompt?: string; choices?: string[]; statementId: string };
}

export interface RunMissionOptions {
  world: WorldModel;
  /** A compiled task, or source plus the validation context to compile it. */
  compiled?: CompiledTask;
  source?: string;
  context?: TaskValidationContext;
  runId?: string;
  epochMs?: number;
  source_?: EventSource;
  configuration?: Partial<ConfigurationIds>;
  host?: InterpreterHost;
  maxVisits?: number;
  /** Journal a twin frame after every statement (default true). */
  traceTwin?: boolean;
  /** Run the preflight clause before arming (default true). */
  preflight?: boolean;
  clock?: Clock;
}

export class MissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MissionError';
    this.code = code;
  }
}

/** Codes that mean "the machine refused", not "the task was wrong". */
const INHIBITING_CODES = new Set([
  'E_SAFETY_INHIBITED',
  'E_PERMIT_DENIED',
  'E_RESOURCE_DENIED',
  'E_PREFLIGHT_FAILED',
  'E_GUARD_BREACH',
  'E_DEGRADED',
]);

function randomishRunId(epochMs: number): string {
  return `run-${epochMs.toString(36)}`;
}

/**
 * Runs one mission: compile (or accept a compiled artifact), check the preflight
 * clause, arm the machine, interpret the statements and report what happened.
 *
 * The runner is the only place where the collaborators are wired together, so a
 * test, the Virtual Lab and the edge runtime all get exactly the same semantics.
 */
export function runMission(options: RunMissionOptions): MissionResult {
  const compiled = resolveCompiled(options);
  const epochMs = options.epochMs ?? DEFAULT_MISSION_EPOCH_MS;
  const clock = options.clock instanceof VirtualClock ? options.clock : new VirtualClock(epochMs);
  const runId = options.runId ?? randomishRunId(epochMs);

  const model = new IndependentSafetyModel({
    carrierId: options.world.carrierId,
    cassetteId: options.world.cassetteId,
  });
  const resources = new ResourceArbitrator(options.world.resourcePolicy ?? aracnidResourcePolicy());

  const probe = new Journal({
    runId,
    source: options.source_ ?? 'simulator',
    clock,
    configuration: configurationOf(options, compiled),
    safetyState: () => 'UNKNOWN',
  });
  const gate = new SafetyGate({
    clock,
    journal: probe,
    model,
    resources,
    motionDuringToolUse: options.world.motionDuringToolUse,
  });

  const interpreter = new Interpreter({
    compiled,
    world: options.world,
    clock,
    journal: probe,
    gate,
    resources,
    model,
    motionDuringToolUse: options.world.motionDuringToolUse,
    ...(options.host ? { host: options.host } : {}),
    ...(options.maxVisits ? { maxVisits: options.maxVisits } : {}),
    traceTwin: options.traceTwin ?? true,
  });

  probe.emit('mission.started', {
    task: `${compiled.ir.task.name}@${compiled.ir.task.version}`,
    irHash: compiled.irHash,
    sourceHash: compiled.sourceHash,
    carrier: options.world.carrierId,
    cassette: options.world.cassetteId,
    scenario: describeWorld(options.world),
  });

  options.world.bindMission?.({
    runId,
    taskName: compiled.ir.task.name,
    taskVersion: compiled.ir.task.version,
  });

  const preflightOutcome =
    options.preflight === false
      ? { ok: true, reason: '' }
      : runPreflight(compiled, options.world, clock, probe, model, gate);
  if (!preflightOutcome.ok) {
    return finish({
      status: 'inhibited',
      exitCode: EXIT_CODES.safetyInhibited,
      errorCode: 'E_PREFLIGHT_FAILED',
      message: preflightOutcome.reason,
      compiled,
      runId,
      clock,
      journal: probe,
      interpreter,
      gate,
      model,
      world: options.world,
    });
  }

  let suspended: MissionResult['suspended'];
  try {
    const generator = interpreter.run();
    let step = generator.next();
    while (!step.done) step = generator.next();
  } catch (error) {
    if (error instanceof SuspendSignal) {
      suspended = {
        reason: error.reason,
        statementId: error.statementId,
        ...(error.prompt ? { prompt: error.prompt } : {}),
        ...(error.choices ? { choices: error.choices } : {}),
      };
    } else {
      throw error;
    }
  }

  if (suspended) {
    return finish({
      status: 'suspended',
      exitCode: EXIT_CODES.suspended,
      errorCode: 'E_SUSPENDED',
      message: suspended.prompt ?? `waiting for ${suspended.reason}`,
      compiled,
      runId,
      clock,
      journal: probe,
      interpreter,
      gate,
      model,
      world: options.world,
      suspended,
    });
  }

  const outcome = interpreter.result();
  // Safety-inhibited is a classification of how the mission ended, not of which
  // statement ended it: a guard breach or a refused permit that ran the task's
  // own fault clause still exits 4 (docs/09 section 7).
  const inhibited = probe.events.some(
    (event) =>
      event.kind === 'safety.inhibited' ||
      event.kind === 'mission.inhibited' ||
      (event.kind === 'fault.entered' &&
        (event.payload as { inhibited?: unknown }).inhibited === true),
  );

  if (outcome.status === 'success') {
    return finish({
      status: 'completed',
      exitCode: EXIT_CODES.success,
      compiled,
      runId,
      clock,
      journal: probe,
      interpreter,
      gate,
      model,
      world: options.world,
      message: outcome.message,
    });
  }

  const code =
    outcome.errorCode ?? (outcome.status === 'aborted' ? 'E_TASK_ABORTED' : 'E_TASK_FAILED');
  return finish({
    status:
      outcome.status === 'aborted'
        ? 'aborted'
        : inhibited || INHIBITING_CODES.has(code)
          ? 'inhibited'
          : 'failed',
    exitCode:
      inhibited || INHIBITING_CODES.has(code)
        ? EXIT_CODES.safetyInhibited
        : EXIT_CODES.executionFailed,
    errorCode: code,
    message: outcome.message,
    compiled,
    runId,
    clock,
    journal: probe,
    interpreter,
    gate,
    model,
    world: options.world,
  });
}

/**
 * Resumes a suspended or interrupted mission.
 *
 * Refusal is the default: a mission that stopped because the machine asked for a
 * safe stop never auto-resumes, and a checkpoint whose IR hash does not match the
 * installed task is rejected outright. Preflight runs again, because the world
 * has been moving without us.
 */
export function resumeMission(
  checkpoint: MissionCheckpoint,
  options: RunMissionOptions,
): MissionResult {
  const compiled = resolveCompiled(options);
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new MissionError(
      'E_RESUME_CHECKPOINT_VERSION',
      `checkpoint version ${String(checkpoint.version)} is not readable by this engine (expects ${String(CHECKPOINT_VERSION)})`,
    );
  }
  if (compiled.irHash !== checkpoint.irHash) {
    throw new MissionError(
      'E_RESUME_IR_MISMATCH',
      `checkpoint was taken against IR ${checkpoint.irHash} but the installed task compiles to ${compiled.irHash}`,
    );
  }
  if (checkpoint.safetyStop) {
    throw new MissionError(
      'E_RESUME_AFTER_SAFE_STOP',
      'the mission stopped on a task-requested safe stop; it needs inspection and a deliberate re-arm, not an auto-resume',
    );
  }

  const epochMs = options.epochMs ?? DEFAULT_MISSION_EPOCH_MS;
  const clock = new VirtualClock(epochMs);
  clock.setElapsed(checkpoint.clockMs);

  const model = new IndependentSafetyModel({
    carrierId: options.world.carrierId,
    cassetteId: options.world.cassetteId,
  });
  const resources = new ResourceArbitrator(options.world.resourcePolicy ?? aracnidResourcePolicy());
  const journal = new Journal({
    runId: checkpoint.runId,
    source: options.source_ ?? 'simulator',
    clock,
    configuration: configurationOf(options, compiled),
    safetyState: () => 'UNKNOWN',
  });
  const gate = new SafetyGate({
    clock,
    journal,
    model,
    resources,
    motionDuringToolUse: options.world.motionDuringToolUse,
  });
  const interpreter = new Interpreter({
    compiled,
    world: options.world,
    clock,
    journal,
    gate,
    resources,
    model,
    motionDuringToolUse: options.world.motionDuringToolUse,
    ...(options.host ? { host: options.host } : {}),
    traceTwin: options.traceTwin ?? true,
  });

  journal.emit('checkpoint.saved', {
    restored: true,
    cursor: checkpoint.cursor.statementId,
    clockMs: checkpoint.clockMs,
    irHash: checkpoint.irHash,
    visits: checkpoint.visits,
  });
  interpreter.restoreVariables(checkpoint.variables);
  interpreter.restoreCompletedKeys(checkpoint.completedKeys);

  options.world.bindMission?.({
    runId: checkpoint.runId,
    taskName: compiled.ir.task.name,
    taskVersion: compiled.ir.task.version,
  });

  const preflightOutcome =
    options.preflight === false
      ? { ok: true, reason: '' }
      : runPreflight(compiled, options.world, clock, journal, model, gate);
  if (!preflightOutcome.ok) {
    return finish({
      status: 'inhibited',
      exitCode: EXIT_CODES.safetyInhibited,
      errorCode: 'E_PREFLIGHT_FAILED',
      message: `resume refused: ${preflightOutcome.reason}`,
      compiled,
      runId: checkpoint.runId,
      clock,
      journal,
      interpreter,
      gate,
      model,
      world: options.world,
    });
  }

  // Continue after the last completed top-level statement. A block that was
  // half-finished restarts from its head, which is safe only because every
  // physical action carries an idempotency key. A mission that *suspended* is
  // different: its cursor names a statement that never completed, so the await
  // is re-entered and the operator's answer is bound on this pass.
  const statements = compiled.ir.steps;
  const cursorIndex = statements.findIndex(
    (statement) => statement.id === checkpoint.cursor.statementId,
  );
  const restartAtCursor = checkpoint.status === 'suspended';
  const remaining =
    cursorIndex < 0
      ? statements
      : statements.slice(restartAtCursor ? cursorIndex : cursorIndex + 1);

  try {
    const generator = interpreter.runFrom(remaining);
    let step = generator.next();
    while (!step.done) step = generator.next();
  } catch (error) {
    if (!(error instanceof SuspendSignal)) throw error;
    return finish({
      status: 'suspended',
      exitCode: EXIT_CODES.suspended,
      errorCode: 'E_SUSPENDED',
      message: error.prompt ?? `waiting for ${error.reason}`,
      compiled,
      runId: checkpoint.runId,
      clock,
      journal,
      interpreter,
      gate,
      model,
      world: options.world,
      suspended: {
        reason: error.reason,
        statementId: error.statementId,
        ...(error.prompt ? { prompt: error.prompt } : {}),
      },
    });
  }

  const outcome = interpreter.result();
  const inhibitedAfterResume = journal.events.some(
    (event) =>
      event.kind === 'safety.inhibited' ||
      event.kind === 'mission.inhibited' ||
      (event.kind === 'fault.entered' &&
        (event.payload as { inhibited?: unknown }).inhibited === true),
  );
  const resumedCode =
    outcome.errorCode ?? (outcome.status === 'aborted' ? 'E_TASK_ABORTED' : undefined);
  const resumedInhibited =
    outcome.status !== 'success' &&
    (inhibitedAfterResume || (resumedCode !== undefined && INHIBITING_CODES.has(resumedCode)));
  return finish({
    status:
      outcome.status === 'success'
        ? 'completed'
        : outcome.status === 'aborted'
          ? 'aborted'
          : resumedInhibited
            ? 'inhibited'
            : 'failed',
    exitCode:
      outcome.status === 'success'
        ? EXIT_CODES.success
        : resumedInhibited
          ? EXIT_CODES.safetyInhibited
          : EXIT_CODES.executionFailed,
    ...(resumedCode ? { errorCode: resumedCode } : {}),
    message: outcome.message,
    compiled,
    runId: checkpoint.runId,
    clock,
    journal,
    interpreter,
    gate,
    model,
    world: options.world,
  });
}

interface FinishArgs {
  status: MissionStatus;
  exitCode: ExitCode;
  compiled: CompiledTask;
  runId: string;
  clock: VirtualClock | Clock;
  journal: Journal;
  interpreter: Interpreter;
  gate: SafetyGate;
  model: IndependentSafetyModel;
  world: WorldModel;
  errorCode?: string;
  message?: string;
  suspended?: MissionResult['suspended'];
}

function finish(args: FinishArgs): MissionResult {
  const snapshot = args.world.snapshot(args.clock.now());
  const assessment: SafetyAssessment = args.model.assess(snapshot, {
    kind: 'final',
    resources: [],
    permits: [],
    motionDuringToolUse: args.world.motionDuringToolUse,
  });
  const state: SafetyState = args.gate.isStopped() ? 'SAFE_STOP' : assessment.state;

  args.journal.emit(
    args.status === 'completed'
      ? 'mission.completed'
      : args.status === 'aborted'
        ? 'mission.aborted'
        : args.status === 'suspended'
          ? 'mission.suspended'
          : args.status === 'inhibited'
            ? 'mission.inhibited'
            : 'mission.failed',
    {
      status: args.status,
      ...(args.errorCode ? { errorCode: args.errorCode } : {}),
      ...(args.message ? { message: args.message } : {}),
      elapsedMs: args.clock instanceof VirtualClock ? args.clock.elapsedMs() : 0,
      visits: args.interpreter.visitCount,
      tally: args.interpreter.tally,
      safety: {
        state,
        tripped: assessment.functions.filter((fn) => fn.tripped).map((fn) => fn.id),
      },
    },
    { safetyState: state },
  );

  const frames: TwinFrame[] = args.interpreter.twinFrames;
  const completed = args.journal.of('statement.completed');
  const lastStatement = completed[completed.length - 1];
  const cursorPayload = (lastStatement?.payload ?? {}) as Record<string, unknown>;

  const checkpoint: MissionCheckpoint = {
    version: CHECKPOINT_VERSION,
    runId: args.runId,
    irHash: args.compiled.irHash,
    sourceHash: args.compiled.sourceHash,
    taskName: args.compiled.ir.task.name,
    taskVersion: args.compiled.ir.task.version,
    status: args.status,
    cursor: args.suspended
      ? { statementId: args.suspended.statementId, path: [] }
      : {
          statementId: String(cursorPayload['id'] ?? ''),
          path: String(cursorPayload['path'] ?? '')
            .split('/')
            .filter((part) => part !== ''),
        },
    completedKeys: args.interpreter.completedKeyList(),
    clockMs: args.clock instanceof VirtualClock ? args.clock.elapsedMs() : 0,
    variables: args.interpreter.variablesSnapshot(),
    visits: args.interpreter.visitCount,
    safetyStop: args.gate.isStopped(),
    degraded: null,
    tally: args.interpreter.tally,
    createdAt: args.clock.timestamp(),
  };
  args.journal.emit('checkpoint.saved', {
    cursor: checkpoint.cursor.statementId,
    clockMs: checkpoint.clockMs,
  });

  return {
    status: args.status,
    exitCode: args.exitCode,
    runId: args.runId,
    taskName: args.compiled.ir.task.name,
    taskVersion: args.compiled.ir.task.version,
    irHash: args.compiled.irHash,
    sourceHash: args.compiled.sourceHash,
    elapsedMs: checkpoint.clockMs,
    ...(args.message ? { message: args.message } : {}),
    ...(args.errorCode ? { errorCode: args.errorCode } : {}),
    journal: args.journal.events,
    journalHash: args.journal.hash(),
    twinFrames: frames,
    tally: checkpoint.tally,
    visits: checkpoint.visits,
    safety: {
      state,
      tripped: assessment.functions.filter((fn) => fn.tripped).map((fn) => fn.id),
      inhibited: assessment.inhibited,
      reasons: assessment.reasons,
    },
    checkpoint,
    ...(args.suspended ? { suspended: args.suspended } : {}),
  };
}

/** Checks the preflight clause and the machine's own mode before arming. */
function runPreflight(
  compiled: CompiledTask,
  world: WorldModel,
  clock: Clock,
  journal: Journal,
  model: IndependentSafetyModel,
  gate: SafetyGate,
): { ok: boolean; reason: string } {
  const snapshot: StateSnapshot = world.snapshot(clock.now());
  const assessment = model.assess(snapshot, {
    kind: 'preflight',
    resources: [],
    permits: [],
    motionDuringToolUse: world.motionDuringToolUse,
  });

  if (!isMissionPermitting(assessment.state) && assessment.state !== 'READY') {
    journal.emit('preflight.failed', {
      reason: `the machine reports ${assessment.state}, which does not permit a mission`,
      state: assessment.state,
    });
    return { ok: false, reason: `machine state ${assessment.state} does not permit a mission` };
  }
  if (assessment.inhibited) {
    journal.emit('preflight.failed', {
      reason: assessment.reasons.join('; '),
      functions: assessment.functions.filter((fn) => fn.tripped).map((fn) => fn.id),
    });
    return { ok: false, reason: assessment.reasons.join('; ') };
  }
  void gate;

  const resolver = new StateResolver(snapshot);
  const context = {
    resolver,
    variables: new Map<string, RuntimeValue>(),
    inZone: (value: RuntimeValue, zone: string) => String(value ?? '') === zone,
  };
  const evaluator = new ExpressionEvaluator(context);

  for (const assertion of compiled.ir.preflight) {
    let stale = false;
    const bound = assertion.freshnessMs ?? minRefFreshness(assertion.condition);
    if (bound !== undefined) {
      for (const path of statePaths(assertion.condition, context)) {
        if (resolver.ageOf(path) > bound) stale = true;
      }
    }
    let holds = false;
    try {
      holds = !stale && evaluator.evaluateBoolean(assertion.condition);
    } catch (error) {
      journal.emit('preflight.failed', {
        condition: describeExpr(assertion.condition),
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        reason: `preflight could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    journal.emit(holds ? 'preflight.checked' : 'preflight.failed', {
      condition: describeExpr(assertion.condition),
      holds,
      stale,
      ...(bound !== undefined ? { freshnessMs: bound } : {}),
    });
    if (!holds) {
      return {
        ok: false,
        reason: stale
          ? `${describeExpr(assertion.condition)} could not be read fresh within ${String(bound)} ms`
          : `${describeExpr(assertion.condition)} did not hold`,
      };
    }
  }
  return { ok: true, reason: '' };
}

function resolveCompiled(options: RunMissionOptions): CompiledTask {
  if (options.compiled) return options.compiled;
  if (!options.source) {
    throw new MissionError(
      'E_MISSION_INPUT',
      'runMission needs either a compiled task or source text',
    );
  }
  if (!options.context) {
    throw new MissionError(
      'E_MISSION_INPUT',
      'compiling from source needs a TaskValidationContext (the installed capability registry)',
    );
  }
  try {
    return compileTaskSource(options.source, options.context);
  } catch (error) {
    throw new MissionError(
      'E_TASK_INVALID',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function configurationOf(options: RunMissionOptions, compiled: CompiledTask): ConfigurationIds {
  return {
    carrierId: options.world.carrierId,
    cassetteSerial: options.world.cassetteId,
    recipeHash: compiled.irHash,
    mapRevision: compiled.ir.requires.map ?? undefined,
    modelVersion: compiled.ir.requires.model ?? undefined,
    calibrationBundleHash: compiled.ir.requires.calibration ?? undefined,
    ...options.configuration,
  };
}

function describeWorld(world: WorldModel): Record<string, unknown> {
  const describable = world as unknown as { describe?: () => Record<string, unknown> };
  return typeof describable.describe === 'function'
    ? describable.describe()
    : { name: world.constructor.name };
}

function minRefFreshness(expr: unknown): number | undefined {
  const node = expr as {
    kind?: string;
    freshnessMs?: number;
    left?: unknown;
    right?: unknown;
    args?: unknown[];
    steps?: Array<{ type: string; expr?: unknown }>;
  };
  if (!node || typeof node !== 'object') return undefined;
  let bound = node.kind === 'ref' ? node.freshnessMs : undefined;
  const consider = (value: number | undefined): void => {
    if (value !== undefined) bound = bound === undefined ? value : Math.min(bound, value);
  };
  consider(minRefFreshness(node.left));
  consider(minRefFreshness(node.right));
  for (const arg of node.args ?? []) consider(minRefFreshness(arg));
  for (const step of node.steps ?? [])
    if (step.type === 'index') consider(minRefFreshness(step.expr));
  return bound;
}

function statePaths(
  expr: unknown,
  context: { resolver: StateResolver; variables: Map<string, RuntimeValue> },
): string[] {
  const node = expr as {
    kind?: string;
    base?: { type: string; root?: string; name?: string };
    steps?: Array<{ type: string; name?: string; expr?: unknown }>;
    left?: unknown;
    right?: unknown;
    args?: unknown[];
  };
  if (!node || typeof node !== 'object') return [];
  const paths: string[] = [];
  if (node.kind === 'ref' && node.base?.type === 'state') {
    try {
      paths.push(
        context.resolver.resolve(node as never, {
          read: (name: string) => context.variables.get(name),
          evaluate: (inner: never) =>
            new ExpressionEvaluator({ ...context, inZone: () => false }).evaluate(inner),
        }).path,
      );
    } catch {
      // unreadable paths are reported as stale by the caller
    }
  }
  paths.push(...statePaths(node.left, context), ...statePaths(node.right, context));
  for (const arg of node.args ?? []) paths.push(...statePaths(arg, context));
  for (const step of node.steps ?? [])
    if (step.type === 'index') paths.push(...statePaths(step.expr, context));
  return paths;
}

function describeExpr(expr: unknown): string {
  const node = expr as Record<string, unknown>;
  if (!node || typeof node !== 'object') return '?';
  switch (node['kind']) {
    case 'ref': {
      const base = node['base'] as { type: string; root?: string; name?: string };
      const steps = (node['steps'] as Array<{ type: string; name?: string; expr?: unknown }>) ?? [];
      return `${base.type === 'state' ? base.root : `$${base.name}`}${steps
        .map((step) =>
          step.type === 'field' ? `.${step.name ?? ''}` : `[${describeExpr(step.expr)}]`,
        )
        .join('')}`;
    }
    case 'binary':
      return `${describeExpr(node['left'])} ${String(node['op'])} ${describeExpr(node['right'])}`;
    case 'quantity':
      return `${String(node['value'])} ${String(node['unit'])}`;
    case 'enum':
      return `#${String(node['name'])}`;
    case 'string':
      return `"${String(node['value'])}"`;
    default:
      return String(node['value'] ?? node['name'] ?? node['kind']);
  }
}
