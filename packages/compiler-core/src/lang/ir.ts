import { createHash } from 'node:crypto';

import type { Expr, Quantity, ResourceSpec, Statement, TaskAst, TargetRef } from './ast.ts';
import { assignStatementIds } from './ids.ts';
import { parseTaskSource } from './parser.ts';
import {
  validateTask,
  type CapabilityDescriptor,
  type TaskValidationContext,
  type TaskPolicyLimits,
  type ValidationIssue,
  TaskValidationError,
} from './validate.ts';

/** Format tag of the canonical, signable compilation artifact. */
export const TASK_IR_FORMAT = 'agri.task-ir/v1';

export type IrQuantity = Quantity;

export interface IrDuration {
  value: number;
  unit: string;
  ms: number;
}

export type IrExpr =
  | { kind: 'quantity'; value: number; unit: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'enum'; name: string }
  | {
      kind: 'ref';
      base: { type: 'state'; root: string } | { type: 'variable'; name: string };
      steps: Array<{ type: 'field'; name: string } | { type: 'index'; expr: IrExpr }>;
      freshnessMs?: number;
    }
  | { kind: 'call'; name: string; args: IrExpr[] }
  | { kind: 'unary'; op: '-' | '!'; operand: IrExpr }
  | { kind: 'binary'; op: string; left: IrExpr; right: IrExpr }
  | { kind: 'list'; items: IrExpr[] }
  | { kind: 'struct'; fields: Array<{ name: string; value: IrExpr }> };

export interface IrArg {
  name: string;
  value: IrExpr;
}

export interface IrAssertion {
  condition: IrExpr;
  freshnessMs?: number;
}

export interface IrResourceSpec {
  class: ResourceSpec['klass'];
  /** Literal instance name, or a canonical expression for a dynamic claim. */
  instance?: string | IrExpr;
}

export interface IrTarget {
  zone?: string;
  expr?: IrExpr;
}

export type IrFaultOrId = { kind: 'fault' } | { kind: 'goto'; target: string };

export type IrJoin = { kind: 'all' } | { kind: 'first_success' } | { kind: 'quorum'; count: number };

export interface IrBranch {
  id?: string;
  resource: IrResourceSpec;
  body: IrStmt[];
}

export interface IrAwaitTarget {
  kind: 'event' | 'completion' | 'operator' | 'condition';
  name?: string;
  ofStatement?: string;
  prompt?: string;
  replyInto?: string;
  choices?: string[];
  condition?: IrExpr;
}

/** One compiled statement: a stable id, no source spans, nothing optional left implicit. */
export type IrStmt =
  | { id: string; label?: string; kind: 'move'; route: IrTarget; speed?: IrQuantity; within: IrDuration }
  | {
      id: string;
      label?: string;
      kind: 'dock';
      station: IrTarget;
      tolerance?: IrQuantity;
      within: IrDuration;
    }
  | { id: string; label?: string; kind: 'return_to'; place: IrTarget; within: IrDuration }
  | {
      id: string;
      label?: string;
      kind: 'actuate';
      capability: string;
      args: IrArg[];
      using?: IrResourceSpec[];
      within: IrDuration;
      verify: IrAssertion[];
      onMismatch?:
        | { kind: 'fault' }
        | { kind: 'retry'; atMost: number; backoff?: IrDuration; idempotencyKey: IrExpr };
      idempotencyKey?: IrExpr;
    }
  | {
      id: string;
      label?: string;
      kind: 'observe';
      capability: string;
      args: IrArg[];
      into: string;
      within?: IrDuration;
      abstainIf?: IrExpr;
    }
  | {
      id: string;
      label?: string;
      kind: 'await';
      target: IrAwaitTarget;
      within: IrDuration;
      onTimeout?: IrFaultOrId;
    }
  | {
      id: string;
      label?: string;
      kind: 'with_permit';
      permit: string;
      on?: IrResourceSpec[];
      lease?: IrDuration;
      body: IrStmt[];
    }
  | {
      id: string;
      label?: string;
      kind: 'request_permit';
      permit: string;
      on?: IrResourceSpec[];
      lease?: IrDuration;
      onDenied?: IrFaultOrId;
    }
  | {
      id: string;
      label?: string;
      kind: 'guard';
      condition: IrExpr;
      freshnessMs?: number;
      every: IrDuration;
      body: IrStmt[];
      onBreach?: IrFaultOrId;
    }
  | {
      id: string;
      label?: string;
      kind: 'for_each';
      variable: string;
      collection: IrExpr;
      atMost: number;
      body: IrStmt[];
      onExhausted?: IrFaultOrId;
    }
  | { id: string; label?: string; kind: 'repeat'; times: number; body: IrStmt[] }
  | {
      id: string;
      label?: string;
      kind: 'when';
      condition: IrExpr;
      freshnessMs?: number;
      body: IrStmt[];
      otherwise?: IrStmt[];
    }
  | { id: string; label?: string; kind: 'parallel'; branches: IrBranch[]; join: IrJoin }
  | { id: string; label?: string; kind: 'sequence'; body: IrStmt[] }
  | { id: string; label?: string; kind: 'record'; event: string; fields: IrArg[] }
  | { id: string; label?: string; kind: 'safe_stop'; reason?: IrExpr }
  | { id: string; label?: string; kind: 'park_tool' }
  | { id: string; label?: string; kind: 'degrade_to'; mode: string; reason?: IrExpr }
  | { id: string; label?: string; kind: 'notify'; role: string; severity: string; message?: string }
  | {
      id: string;
      label?: string;
      kind: 'run_task';
      task: string;
      args?: IrArg[];
      depthAtMost: number;
    }
  | {
      id: string;
      label?: string;
      kind: 'finish';
      status: 'success' | 'failed' | 'aborted';
      errorCode?: string;
      message?: IrExpr;
    }
  | { id: string; label?: string; kind: 'noop'; text?: string };

/** Statements as stored in the IR before they are narrowed by `kind`. */
export type IrStatement = IrStmt;

export interface IrIndexEntry {
  id: string;
  kind: Statement['kind'];
  label?: string;
  capability?: string;
  permits?: string[];
  resources?: string[];
  parents: string[];
}

export interface IrStatistics {
  statementCount: number;
  actuatingStatements: number;
  capabilities: string[];
  resourceClaims: string[];
  permitScopes: number;
  guards: number;
  parallelBranches: number;
  maxParallelWidth: number;
  maxLoopBound: number;
  maxRetryAttempts: number;
  taskDeadlineMs: number | null;
  subtaskCalls: number;
}

export interface TaskIr {
  format: typeof TASK_IR_FORMAT;
  task: { name: string; version: string };
  meta?: TaskAst['meta'];
  requires: {
    cassette: string;
    capabilities: string[];
    operatorPolicy: string;
    zones: string[];
    map?: string;
    route?: { ref: string; commissioned: boolean };
    model?: string;
    calibration?: string;
    processApproval?: string;
  };
  limits: Array<{ key: string; value: number; unit: string }>;
  preflight: IrAssertion[];
  steps: IrStmt[];
  onFault: IrStmt[];
  evidence: { retain: string[]; privacy?: string; retentionDays?: number };
  index: IrIndexEntry[];
  statistics: IrStatistics;
}

export interface CompiledTask {
  ast: TaskAst;
  ir: TaskIr;
  /** sha256 over the canonical IR bytes; the value a signature covers. */
  irHash: string;
  /** sha256 over the exact source text. */
  sourceHash: string;
  /** Canonical, byte-stable JSON of the IR. */
  canonicalJson: string;
  issues: ValidationIssue[];
}

const TIME_FACTORS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };

/**
 * Deterministic JSON: object keys sorted, no `undefined`, no functions, numbers
 * in their shortest round-trip form. Two compilations of the same source always
 * produce the same bytes, so the hash is a stable artifact identity.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TaskValidationError('ir', [
        {
          code: 'E_NON_DETERMINISTIC',
          rule: 'S10',
          severity: 'error',
          message: 'the IR contains a non-finite number',
        },
      ]);
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') {
    throw new TaskValidationError('ir', [
      {
        code: 'E_NON_DETERMINISTIC',
        rule: 'S10',
        severity: 'error',
        message: `the IR contains a ${typeof value}, which has no canonical form`,
      },
    ]);
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry === undefined) continue;
    out[key] = canonicalise(entry);
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function irQuantity(quantity: Quantity): IrQuantity {
  return { value: quantity.value, unit: quantity.unit };
}

function irDuration(duration: { value: number; unit: string; ms: number }): IrDuration {
  return { value: duration.value, unit: duration.unit, ms: duration.ms };
}

function irTarget(target: TargetRef): IrTarget {
  return target.kind === 'zone' ? { zone: target.name } : { expr: irExpr(target.expr) };
}

function irResource(spec: ResourceSpec): IrResourceSpec {
  if (spec.instance === undefined) return { class: spec.klass };
  if (typeof spec.instance === 'string') return { class: spec.klass, instance: spec.instance };
  return { class: spec.klass, instance: irExpr(spec.instance) };
}

/** Expressions are already span-free data; only spans are stripped here. */
function irExpr(expr: Expr): IrExpr {
  switch (expr.kind) {
    case 'ref':
      return {
        kind: 'ref',
        base: expr.base,
        steps: expr.steps.map((step) =>
          step.type === 'field'
            ? { type: 'field', name: step.name }
            : { type: 'index', expr: irExpr(step.expr) },
        ),
        ...(expr.freshness ? { freshnessMs: expr.freshness.ms } : {}),
      };
    case 'binary':
      return { kind: 'binary', op: expr.op, left: irExpr(expr.left), right: irExpr(expr.right) };
    case 'unary':
      return { kind: 'unary', op: expr.op, operand: irExpr(expr.operand) };
    case 'call':
      return { kind: 'call', name: expr.name, args: expr.args.map(irExpr) };
    case 'list':
      return { kind: 'list', items: expr.items.map(irExpr) };
    case 'struct':
      return {
        kind: 'struct',
        fields: expr.fields.map((field) => ({ name: field.name, value: irExpr(field.value) })),
      };
    case 'quantity':
      return { kind: 'quantity', value: expr.value.value, unit: expr.value.unit };
    case 'number':
      return { kind: 'number', value: expr.value };
    case 'string':
      return { kind: 'string', value: expr.value };
    case 'boolean':
      return { kind: 'boolean', value: expr.value };
    case 'null':
      return { kind: 'null' };
    case 'enum':
      return { kind: 'enum', name: expr.name };
    default:
      return { kind: 'null' };
  }
}

function irArgs(args: Array<{ name: string; value: Expr }>): IrArg[] {
  return args.map((arg) => ({ name: arg.name, value: irExpr(arg.value) }));
}

function irAssertions(
  assertions: Array<{ condition: Expr; freshness?: { ms: number } }>,
): IrAssertion[] {
  return assertions.map((assertion) => ({
    condition: irExpr(assertion.condition),
    ...(assertion.freshness ? { freshnessMs: assertion.freshness.ms } : {}),
  }));
}

/** Builds the canonical IR for a validated AST. */
export function buildTaskIr(task: TaskAst): TaskIr {
  const ids = assignStatementIds(task);
  const index: IrIndexEntry[] = [];
  const statistics: IrStatistics = {
    statementCount: ids.order.length,
    actuatingStatements: 0,
    capabilities: [],
    resourceClaims: [],
    permitScopes: 0,
    guards: 0,
    parallelBranches: 0,
    maxParallelWidth: 0,
    maxLoopBound: 0,
    maxRetryAttempts: 0,
    taskDeadlineMs: null,
    subtaskCalls: 0,
  };

  const capabilitySet = new Set<string>();
  const claimSet = new Set<string>();

  const convert = (statement: Statement): IrStmt => {
    const ref = ids.byStatement.get(statement);
    const id = ref?.id ?? 's0';
    const base: Record<string, unknown> = {
      id,
      kind: statement.kind,
      ...(statement.id ? { label: statement.id } : {}),
    };
    const parents = ref?.parentIds ?? [];

    switch (statement.kind) {
      case 'move':
        Object.assign(base, {
          route: irTarget(statement.route),
          ...(statement.speed ? { speed: irQuantity(statement.speed) } : {}),
          within: irDuration(statement.within),
        });
        break;
      case 'dock':
        Object.assign(base, {
          station: irTarget(statement.station),
          ...(statement.tolerance ? { tolerance: irQuantity(statement.tolerance) } : {}),
          within: irDuration(statement.within),
        });
        break;
      case 'return_to':
        Object.assign(base, {
          place: irTarget(statement.place),
          within: irDuration(statement.within),
        });
        break;
      case 'actuate': {
        capabilitySet.add(statement.capability);
        statistics.actuatingStatements += 1;
        const resources = (statement.using ?? []).map(irResource);
        for (const spec of statement.using ?? []) claimSet.add(claimKey(spec));
        const mismatch = statement.onMismatch;
        Object.assign(base, {
          capability: statement.capability,
          args: irArgs(statement.args),
          ...(resources.length > 0 ? { using: resources } : {}),
          within: irDuration(statement.within),
          verify: irAssertions(statement.verify),
          ...(mismatch
            ? mismatch.kind === 'fault'
              ? { onMismatch: { kind: 'fault' } }
              : {
                  onMismatch: {
                    kind: 'retry',
                    atMost: mismatch.atMost,
                    ...(mismatch.backoff ? { backoff: irDuration(mismatch.backoff) } : {}),
                    idempotencyKey: irExpr(mismatch.idempotencyKey),
                  },
                }
            : {}),
          ...(statement.idempotencyKey ? { idempotencyKey: irExpr(statement.idempotencyKey) } : {}),
        });
        if (mismatch?.kind === 'retry') {
          statistics.maxRetryAttempts = Math.max(statistics.maxRetryAttempts, mismatch.atMost);
        }
        break;
      }
      case 'observe':
        capabilitySet.add(statement.capability);
        Object.assign(base, {
          capability: statement.capability,
          args: irArgs(statement.args),
          into: statement.into,
          ...(statement.within ? { within: irDuration(statement.within) } : {}),
          ...(statement.abstainIf ? { abstainIf: irExpr(statement.abstainIf) } : {}),
        });
        break;
      case 'await':
        Object.assign(base, {
          target: {
            kind: statement.target.kind,
            ...(statement.target.name ? { name: statement.target.name } : {}),
            ...(statement.target.ofStatement ? { ofStatement: statement.target.ofStatement } : {}),
            ...(statement.target.prompt ? { prompt: statement.target.prompt } : {}),
            ...(statement.target.replyInto ? { replyInto: statement.target.replyInto } : {}),
            ...(statement.target.choices ? { choices: statement.target.choices } : {}),
            ...(statement.target.condition
              ? { condition: irExpr(statement.target.condition) }
              : {}),
          },
          within: irDuration(statement.within),
          ...(statement.onTimeout ? { onTimeout: statement.onTimeout } : {}),
        });
        break;
      case 'with_permit': {
        statistics.permitScopes += 1;
        const on = (statement.on ?? []).map(irResource);
        for (const spec of statement.on ?? []) claimSet.add(claimKey(spec));
        Object.assign(base, {
          permit: statement.permit,
          ...(on.length > 0 ? { on } : {}),
          ...(statement.lease ? { lease: irDuration(statement.lease) } : {}),
          body: statement.body.map(convert),
        });
        break;
      }
      case 'request_permit':
        Object.assign(base, {
          permit: statement.permit,
          ...(statement.on ? { on: statement.on.map(irResource) } : {}),
          ...(statement.lease ? { lease: irDuration(statement.lease) } : {}),
          ...(statement.onDenied ? { onDenied: statement.onDenied } : {}),
        });
        break;
      case 'guard':
        statistics.guards += 1;
        Object.assign(base, {
          condition: irExpr(statement.condition),
          ...(statement.freshness ? { freshnessMs: statement.freshness.ms } : {}),
          every: irDuration(statement.every),
          body: statement.body.map(convert),
          ...(statement.onBreach ? { onBreach: statement.onBreach } : {}),
        });
        break;
      case 'for_each':
        statistics.maxLoopBound = Math.max(statistics.maxLoopBound, statement.atMost);
        Object.assign(base, {
          variable: statement.variable,
          collection: irExpr(statement.collection),
          atMost: statement.atMost,
          body: statement.body.map(convert),
          ...(statement.onExhausted ? { onExhausted: statement.onExhausted } : {}),
        });
        break;
      case 'repeat':
        statistics.maxLoopBound = Math.max(statistics.maxLoopBound, statement.times);
        Object.assign(base, { times: statement.times, body: statement.body.map(convert) });
        break;
      case 'when':
        Object.assign(base, {
          condition: irExpr(statement.condition),
          ...(statement.freshness ? { freshnessMs: statement.freshness.ms } : {}),
          body: statement.body.map(convert),
          ...(statement.otherwise ? { otherwise: statement.otherwise.map(convert) } : {}),
        });
        break;
      case 'parallel':
        statistics.parallelBranches += statement.branches.length;
        statistics.maxParallelWidth = Math.max(
          statistics.maxParallelWidth,
          statement.branches.length,
        );
        claimSet.add(claimKey(statement.branches[0]!.resource));
        Object.assign(base, {
          branches: statement.branches.map((branch) => {
            claimSet.add(claimKey(branch.resource));
            return {
              ...(branch.id ? { id: branch.id } : {}),
              resource: irResource(branch.resource),
              body: branch.body.map(convert),
            };
          }),
          join: statement.join,
        });
        break;
      case 'sequence':
        Object.assign(base, { body: statement.body.map(convert) });
        break;
      case 'record':
        Object.assign(base, { event: statement.event, fields: irArgs(statement.fields) });
        break;
      case 'safe_stop':
        Object.assign(base, { ...(statement.reason ? { reason: irExpr(statement.reason) } : {}) });
        statistics.actuatingStatements += 1;
        break;
      case 'park_tool':
        statistics.actuatingStatements += 1;
        break;
      case 'degrade_to':
        Object.assign(base, {
          mode: statement.mode,
          ...(statement.reason ? { reason: irExpr(statement.reason) } : {}),
        });
        break;
      case 'notify':
        Object.assign(base, {
          role: statement.role,
          severity: statement.severity,
          ...(statement.message ? { message: statement.message } : {}),
        });
        break;
      case 'run_task':
        statistics.subtaskCalls += 1;
        Object.assign(base, {
          task: `${statement.name}@${statement.version}`,
          ...(statement.args ? { args: irArgs(statement.args) } : {}),
          depthAtMost: statement.depthAtMost,
        });
        break;
      case 'finish':
        Object.assign(base, {
          status: statement.status,
          ...(statement.errorCode ? { errorCode: statement.errorCode } : {}),
          ...(statement.message ? { message: irExpr(statement.message) } : {}),
        });
        break;
      case 'noop':
        Object.assign(base, { ...(statement.label ? { text: statement.label } : {}) });
        break;
      default:
        break;
    }

    index.push({
      id,
      kind: statement.kind,
      ...(statement.id ? { label: statement.id } : {}),
      ...(statement.kind === 'actuate' || statement.kind === 'observe'
        ? { capability: statement.capability }
        : {}),
      ...(statement.kind === 'with_permit' || statement.kind === 'request_permit'
        ? { permits: [statement.permit] }
        : {}),
      ...(statement.kind === 'actuate' && statement.using
        ? { resources: statement.using.map(claimKey) }
        : {}),
      parents,
    });
    // `base` was filled by the switch above; the union is narrowed by `kind`.
    return base as unknown as IrStmt;
  };

  const steps = task.steps.map(convert);
  const onFault = task.onFault.map(convert);

  const deadline = task.limits['task_deadline'];
  statistics.taskDeadlineMs = deadline
    ? Math.round(deadline.value * (TIME_FACTORS[deadline.unit] ?? 0))
    : null;
  statistics.capabilities = [...capabilitySet].sort();
  statistics.resourceClaims = [...claimSet].sort();

  return {
    format: TASK_IR_FORMAT,
    task: { name: task.name, version: task.version },
    ...(task.meta ? { meta: task.meta } : {}),
    requires: task.requires,
    limits: Object.entries(task.limits)
      .map(([key, quantity]) => ({ key, value: quantity.value, unit: quantity.unit }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    preflight: irAssertions(task.preflight),
    steps,
    onFault,
    evidence: task.evidence,
    index,
    statistics,
  };
}

function claimKey(spec: ResourceSpec): string {
  if (spec.instance === undefined) return spec.klass;
  if (typeof spec.instance === 'string') return `${spec.klass}[${spec.instance}]`;
  return `${spec.klass}[<dynamic>]`;
}

export interface CompileOptions {
  /** Throw `TaskValidationError` on error-severity issues. Default true. */
  throwOnError?: boolean;
  limits?: Partial<TaskPolicyLimits>;
}

/**
 * Parses, semantically validates and compiles `agri.task/v1` source to the
 * canonical IR, returning the IR hash that a signature and a mission resume
 * both bind to.
 */
export function compileTaskSource(
  source: string,
  context: { capabilities: readonly CapabilityDescriptor[] } & Partial<TaskValidationContext>,
  options: CompileOptions = {},
): CompiledTask {
  const ast = parseTaskSource(source);
  const issues = validateTask(ast, { ...context, limits: options.limits });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0 && options.throwOnError !== false) {
    throw new TaskValidationError(ast.name, errors);
  }
  const ir = buildTaskIr(ast);
  const canonical = canonicalJson(ir);
  return {
    ast,
    ir,
    irHash: sha256Hex(canonical),
    sourceHash: sha256Hex(source),
    canonicalJson: canonical,
    issues,
  };
}
