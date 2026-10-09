import { AgriScriptError, ERROR_CODES } from '../errors.ts';
import type { Expr, Quantity, ResourceSpec, Span, Statement, TaskAst } from './ast.ts';
import { assignStatementIds, isActuating, type StatementIdMap, type StatementRef } from './ids.ts';
import { BUILTINS, STATE_ROOTS } from './parser.ts';

/** A capability as published by the installed allow-list. */
export interface CapabilityDescriptor {
  id: string;
  type: string;
  hazardClass: 'sensing_only' | 'benign_task' | 'conditional_task' | 'actuation_gated';
  gate: string;
  requiresProcessApproval: boolean;
}

export interface TaskPolicyLimits {
  maxStatements: number;
  maxLoopIterations: number;
  maxParallelBranches: number;
  maxSubtaskDepth: number;
}

/** Everything the validator is allowed to know about the installation. */
export interface TaskValidationContext {
  /** Installed capability registry; an absent id is a compile error (S1). */
  capabilities: readonly CapabilityDescriptor[];
  /** Capabilities the cassette manifest declares for `requires.cassette`. */
  manifestCapabilities?: readonly string[];
  /** Cassette manifest `motion_during_tool_use` (S11 traction overlap rule). */
  motionDuringToolUse?: boolean;
  /** Known cassette ids; when supplied, `requires.cassette` is cross-checked. */
  knownCassettes?: readonly string[];
  /** Task ids available to `run_task`; when supplied, references are checked. */
  knownTasks?: readonly string[];
  limits?: Partial<TaskPolicyLimits>;
}

export const DEFAULT_TASK_POLICY_LIMITS: TaskPolicyLimits = {
  maxStatements: 400,
  maxLoopIterations: 64,
  maxParallelBranches: 16,
  maxSubtaskDepth: 3,
};

export type SemanticRule =
  'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11';

export type ValidationCode =
  | 'E_CAPABILITY_UNKNOWN'
  | 'E_CAPABILITY_NOT_IN_MANIFEST'
  | 'E_CAPABILITY_GATE_UNAPPROVED'
  | 'E_POSTCONDITION_UNOBSERVABLE'
  | 'E_LOOP_BOUND_EXCEEDED'
  | 'E_UNPERMITTED_ACTUATION'
  | 'E_STALE_STATE_READ'
  | 'E_DUPLICATE_STATEMENT_ID'
  | 'E_UNKNOWN_JUMP_TARGET'
  | 'E_UNREACHABLE_STATEMENT'
  | 'E_STATE_SHADOWED'
  | 'E_TASK_TOO_LARGE'
  | 'E_UNIT_MISMATCH'
  | 'E_UNIT_REQUIRED'
  | 'E_NON_DETERMINISTIC'
  | 'E_MISSING_IDEMPOTENCY_KEY'
  | 'E_SUBTASK_UNKNOWN'
  | 'E_SUBTASK_DEPTH'
  | 'E_RESOURCE_DOUBLE_CLAIM'
  | 'E_TRACTION_TOOL_OVERLAP'
  | 'E_CASSETTE_UNKNOWN'
  | 'E_BRANCH_WIDTH';

export interface ValidationIssue {
  code: ValidationCode;
  rule: SemanticRule;
  severity: 'error' | 'warning';
  message: string;
  statementId?: string;
  span?: Span;
}

export const DIMENSIONS: Record<string, string> = {
  km: 'length',
  m: 'length',
  cm: 'length',
  mm: 'length',
  kg: 'mass',
  g: 'mass',
  t: 'mass',
  L: 'volume',
  mL: 'volume',
  m3: 'volume',
  ms: 'time',
  s: 'time',
  min: 'time',
  h: 'time',
  'm/s': 'speed',
  'mm/s': 'speed',
  'km/h': 'speed',
  deg: 'angle',
  rad: 'angle',
  'rad/s': 'angular_speed',
  ratio: 'ratio',
  '%': 'ratio',
  ppm: 'concentration',
  'g/L': 'concentration',
  'mg/L': 'concentration',
  'mol/L': 'concentration',
  V: 'voltage',
  A: 'current',
  W: 'power',
  Wh: 'energy',
  N: 'force',
  kN: 'force',
  Nm: 'torque',
  Pa: 'pressure',
  kPa: 'pressure',
  bar: 'pressure',
  K: 'temperature',
  degC: 'temperature',
  count: 'count',
  items: 'count',
  eggs: 'count',
  stations: 'count',
  plants: 'count',
  'kg/s': 'mass_rate',
  'g/s': 'mass_rate',
  'kg/min': 'mass_rate',
  'L/s': 'volume_rate',
  'mL/s': 'volume_rate',
  'L/min': 'volume_rate',
  'mL/min': 'volume_rate',
};

export function dimensionOf(unit: string): string | undefined {
  return DIMENSIONS[unit];
}

export class TaskValidationError extends AgriScriptError {
  readonly issues: readonly ValidationIssue[];

  constructor(taskName: string, issues: readonly ValidationIssue[]) {
    const detail = issues
      .map((issue) => `  [${issue.code}] ${issue.rule}: ${issue.message}`)
      .join('\n');
    super(
      ERROR_CODES.semantic,
      `task "${taskName}" failed semantic validation:\n${detail}`,
      issues.map((issue) => `${issue.code} (${issue.rule}): ${issue.message}`),
    );
    this.name = 'TaskValidationError';
    this.issues = issues;
  }
}

/** Lexical scope carried down while checking statements. */
interface Scope {
  /** Permit kinds granted by enclosing `with_permit` blocks (S4). */
  permits: string[];
  /** Depth of enclosing `guard` blocks. */
  guards: number;
  /** Exclusive resources claimed by enclosing `parallel` branches (S11). */
  branchClaims: string[];
}

interface RefUse {
  expr: Extract<Expr, { kind: 'ref' }>;
  /** True when the ref only appears inside an index expression. */
  insideIndex: boolean;
}

function collectRefs(expr: Expr, insideIndex = false, out: RefUse[] = []): RefUse[] {
  switch (expr.kind) {
    case 'ref': {
      out.push({ expr, insideIndex });
      for (const step of expr.steps) {
        if (step.type === 'index') collectRefs(step.expr, true, out);
      }
      return out;
    }
    case 'binary':
      collectRefs(expr.left, insideIndex, out);
      collectRefs(expr.right, insideIndex, out);
      return out;
    case 'unary':
      collectRefs(expr.operand, insideIndex, out);
      return out;
    case 'call':
      for (const arg of expr.args) collectRefs(arg, insideIndex, out);
      return out;
    case 'list':
      for (const item of expr.items) collectRefs(item, insideIndex, out);
      return out;
    case 'struct':
      for (const field of expr.fields) collectRefs(field.value, insideIndex, out);
      return out;
    default:
      return out;
  }
}

function* collectExprs(expr: Expr): Generator<Expr> {
  yield expr;
  switch (expr.kind) {
    case 'ref':
      for (const step of expr.steps) if (step.type === 'index') yield* collectExprs(step.expr);
      return;
    case 'binary':
      yield* collectExprs(expr.left);
      yield* collectExprs(expr.right);
      return;
    case 'unary':
      yield* collectExprs(expr.operand);
      return;
    case 'call':
      for (const arg of expr.args) yield* collectExprs(arg);
      return;
    case 'list':
      for (const item of expr.items) yield* collectExprs(item);
      return;
    case 'struct':
      for (const field of expr.fields) yield* collectExprs(field.value);
      return;
    default:
      return;
  }
}

function blockContainsPhysical(statements: Statement[]): boolean {
  for (const statement of statements) {
    if (isActuating(statement)) return true;
    const record = statement as unknown as Record<string, unknown>;
    for (const key of ['body', 'otherwise']) {
      const nested = record[key];
      if (Array.isArray(nested) && blockContainsPhysical(nested as Statement[])) return true;
    }
    if (statement.kind === 'parallel') {
      for (const branch of statement.branches) {
        if (blockContainsPhysical(branch.body)) return true;
      }
    }
  }
  return false;
}

function resourceKey(spec: ResourceSpec, variables: (expr: Expr) => string): string {
  if (spec.instance === undefined) return spec.klass;
  if (typeof spec.instance === 'string') return `${spec.klass}[${spec.instance}]`;
  return `${spec.klass}[${variables(spec.instance)}]`;
}

/**
 * Semantic validation of a parsed task, implementing grammar rules S1-S11.
 *
 * Issues are collected, never fail-fast: one run reports every problem so a
 * task author fixes them in one pass (the SapoEngine BlueprintValidator
 * convention). Warnings do not block compilation; errors do.
 */
export class TaskValidator {
  private readonly issues: ValidationIssue[] = [];
  private readonly ids: StatementIdMap;
  private readonly policy: TaskPolicyLimits;
  private readonly task: TaskAst;
  private readonly context: TaskValidationContext;

  constructor(task: TaskAst, context: TaskValidationContext) {
    this.task = task;
    this.context = context;
    this.ids = assignStatementIds(task);
    this.policy = { ...DEFAULT_TASK_POLICY_LIMITS, ...(context.limits ?? {}) };
  }

  validate(): ValidationIssue[] {
    this.checkRequires();
    this.checkSize();
    this.checkStatementIds();
    this.checkReachability();
    this.checkPreflight();
    this.checkSteps(this.task.steps, { permits: [], guards: 0, branchClaims: [] });
    this.checkSteps(this.task.onFault, { permits: [], guards: 0, branchClaims: [] });
    return [...this.issues].sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
  }

  private add(issue: Omit<ValidationIssue, 'severity'> & { severity?: 'error' | 'warning' }): void {
    this.issues.push({ severity: 'error', ...issue });
  }

  private locate(statement?: Statement): { statementId?: string; span?: Span } {
    if (!statement) return {};
    const ref = this.ids.byStatement.get(statement);
    return {
      ...(ref ? { statementId: ref.id } : {}),
      ...(statement.span ? { span: statement.span } : {}),
    };
  }

  // -- S1: capabilities resolve and are declared by the manifest -------------

  private checkRequires(): void {
    const { capabilities, manifestCapabilities, knownCassettes } = this.context;
    const directory = new Map(capabilities.map((capability) => [capability.id, capability]));

    if (knownCassettes && !knownCassettes.includes(this.task.requires.cassette)) {
      this.add({
        code: 'E_CASSETTE_UNKNOWN',
        rule: 'S1',
        message: `cassette "${this.task.requires.cassette}" is not a known cassette id`,
        span: this.task.span,
      });
    }

    for (const required of this.task.requires.capabilities) {
      const descriptor = directory.get(required);
      if (!descriptor) {
        this.add({
          code: 'E_CAPABILITY_UNKNOWN',
          rule: 'S1',
          message: `capability "${required}" is not in the installed allow-list`,
          span: this.task.span,
        });
        continue;
      }
      if (
        manifestCapabilities &&
        manifestCapabilities.length > 0 &&
        !manifestCapabilities.includes(required)
      ) {
        this.add({
          code: 'E_CAPABILITY_NOT_IN_MANIFEST',
          rule: 'S1',
          message: `capability "${required}" is not declared by cassette ${this.task.requires.cassette}`,
          span: this.task.span,
        });
      }
      if (descriptor.requiresProcessApproval && !this.task.requires.processApproval) {
        this.add({
          code: 'E_CAPABILITY_GATE_UNAPPROVED',
          rule: 'S1',
          message: `capability "${required}" needs a process approval reference in requires`,
          span: this.task.span,
        });
      }
    }
  }

  // -- S8: bounded size ------------------------------------------------------

  private checkSize(): void {
    const count = this.ids.order.length;
    if (count > this.policy.maxStatements) {
      this.add({
        code: 'E_TASK_TOO_LARGE',
        rule: 'S8',
        message: `${String(count)} statements exceeds the policy bound of ${String(this.policy.maxStatements)}`,
        span: this.task.span,
      });
    }
  }

  // -- S6: unique ids, existing jump targets, reachability -------------------

  private checkStatementIds(): void {
    const seen = new Map<string, StatementRef>();
    for (const ref of this.ids.order) {
      const previous = seen.get(ref.id);
      if (previous) {
        this.add({
          code: 'E_DUPLICATE_STATEMENT_ID',
          rule: 'S6',
          message: `statement id "${ref.id}" is used twice`,
          statementId: ref.id,
          span: ref.statement.span,
        });
      } else {
        seen.set(ref.id, ref);
      }
    }

    for (const ref of this.ids.order) {
      for (const target of jumpTargets(ref.statement)) {
        if (!this.ids.byId.has(target)) {
          this.add({
            code: 'E_UNKNOWN_JUMP_TARGET',
            rule: 'S6',
            message: `jump target "${target}" does not exist in task "${this.task.name}"`,
            statementId: ref.id,
            span: ref.statement.span,
          });
        }
      }
    }
  }

  private checkReachability(): void {
    const edges = new Map<string, string[]>();
    const link = (from: string, to: string | undefined): void => {
      if (!to) return;
      const list = edges.get(from) ?? [];
      list.push(to);
      edges.set(from, list);
    };

    const faultEntry = this.faultEntry();
    const walk = (statements: Statement[], continuation?: string, owner?: string): void => {
      if (owner) link(owner, this.firstOf(statements));
      statements.forEach((statement, index) => {
        const ref = this.ids.byStatement.get(statement);
        if (!ref) return;
        const next =
          index + 1 < statements.length ? this.idOf(statements[index + 1]!) : continuation;
        if (statement.kind !== 'finish') link(ref.id, next);
        for (const target of jumpTargets(statement)) link(ref.id, target);
        if (hasFaultRoute(statement)) link(ref.id, faultEntry);
        // Any physical action can fail, and an unhandled failure always lands in
        // on_fault: that edge is implicit, so the clause is reachable whenever
        // something in the task can act on the world.
        if (isActuating(statement) && faultEntry) link(ref.id, faultEntry);

        if (statement.kind === 'parallel') {
          for (const branch of statement.branches) walk(branch.body, next, ref.id);
          return;
        }
        if (statement.kind === 'when') {
          walk(statement.body, next, ref.id);
          if (statement.otherwise) walk(statement.otherwise, next, ref.id);
          return;
        }
        const record = statement as unknown as Record<string, unknown>;
        const body = record['body'];
        if (Array.isArray(body)) walk(body as Statement[], next, ref.id);
      });
    };

    walk(this.task.steps);
    walk(this.task.onFault);

    const entry = this.task.steps[0];
    if (!entry) return;
    const reachable = new Set<string>();
    const queue = [this.idOf(entry)];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of edges.get(id) ?? []) if (!reachable.has(next)) queue.push(next);
    }

    for (const ref of this.ids.order) {
      // The fault clause is entered by the runtime, never by fall-through: a
      // deadline can expire, a permit can be denied and the independent safety
      // model can inhibit, so reachability analysis only applies to `steps`.
      if (ref.clause === 'on_fault') continue;
      if (!reachable.has(ref.id)) {
        this.add({
          code: 'E_UNREACHABLE_STATEMENT',
          rule: 'S6',
          message: `statement "${ref.id}" cannot be reached from the first step`,
          statementId: ref.id,
          span: ref.statement.span,
        });
      }
    }

    // on_fault is always reachable at run time: a deadline can expire, a permit
    // can be denied and the independent safety model can inhibit, so no static
    // "orphaned fault clause" check is meaningful here.
  }

  private idOf(statement: Statement): string {
    return this.ids.byStatement.get(statement)?.id ?? 's0';
  }

  private firstOf(statements: Statement[]): string | undefined {
    const first = statements[0];
    return first ? this.idOf(first) : undefined;
  }

  private faultEntry(): string | undefined {
    return this.firstOf(this.task.onFault);
  }

  // -- S5: preflight freshness ----------------------------------------------

  private checkPreflight(): void {
    for (const assertion of this.task.preflight) {
      this.checkFreshness(assertion.condition, assertion.freshness, 'S5', 'preflight');
    }
  }

  private checkFreshness(
    condition: Expr,
    statementFreshness: unknown,
    rule: SemanticRule,
    where: string,
    statement?: Statement,
  ): void {
    for (const use of collectRefs(condition)) {
      if (use.expr.base.type !== 'state') continue;
      if (use.expr.freshness || statementFreshness) continue;
      this.add({
        code: 'E_STALE_STATE_READ',
        rule,
        message: `${where} reads ${describeRef(use.expr)} without a freshness bound ("@ within <duration>"); a stale read is inhibiting, never permissive`,
        ...this.locate(statement),
        span: use.expr.span,
      });
    }
  }

  // -- per-statement checks --------------------------------------------------

  private checkSteps(statements: Statement[], scope: Scope): void {
    // S7/S10: a local variable may never shadow a state root.
    for (const statement of statements) {
      const shadow = shadowedRoot(statement);
      if (shadow) {
        this.add({
          code: 'E_STATE_SHADOWED',
          rule: 'S7',
          message: `$${shadow} shadows the state root "${shadow}"; tasks cannot write to state`,
          ...this.locate(statement),
        });
      }
    }

    for (const statement of statements) {
      this.checkStatement(statement, scope);
    }
  }

  private checkStatement(statement: Statement, scope: Scope): void {
    switch (statement.kind) {
      case 'actuate': {
        this.checkCapability(statement.capability, statement);
        this.checkPermitEnclosure(statement, scope);
        this.checkResources(statement.using ?? [], statement, scope);
        this.checkPostconditions(statement);
        this.checkIdempotency(statement);
        this.checkDeadlineBudget(statement.within.ms, statement);
        break;
      }
      case 'observe': {
        this.checkCapability(statement.capability, statement);
        if (statement.abstainIf) {
          for (const use of collectRefs(statement.abstainIf)) {
            if (use.expr.base.type === 'state' && !use.expr.freshness && !statement.within) {
              this.add({
                code: 'E_STALE_STATE_READ',
                rule: 'S5',
                message: `abstain_if reads ${describeRef(use.expr)} without a freshness bound`,
                ...this.locate(statement),
              });
            }
          }
        }
        break;
      }
      case 'move':
      case 'dock':
      case 'return_to': {
        this.checkDeadlineBudget(statement.within.ms, statement);
        if (statement.kind === 'move' && statement.speed) {
          const limit = this.task.limits['travel_speed'];
          if (limit && dimensionOf(limit.unit) !== dimensionOf(statement.speed.unit)) {
            this.add({
              code: 'E_UNIT_MISMATCH',
              rule: 'S9',
              message: `move speed ${String(statement.speed.value)} ${statement.speed.unit} is not comparable with travel_speed ${String(limit.value)} ${limit.unit}`,
              ...this.locate(statement),
            });
          }
        }
        break;
      }
      case 'with_permit': {
        this.checkResources(statement.on ?? [], statement, scope);
        this.checkSteps(statement.body, {
          permits: [...scope.permits, statement.permit],
          guards: scope.guards,
          branchClaims: scope.branchClaims,
        });
        return;
      }
      case 'request_permit': {
        this.checkResources(statement.on ?? [], statement, scope);
        break;
      }
      case 'guard': {
        this.checkFreshness(statement.condition, statement.freshness, 'S5', 'guard', statement);
        this.checkUnits(statement.condition, statement);
        this.checkSteps(statement.body, {
          permits: scope.permits,
          guards: scope.guards + 1,
          branchClaims: scope.branchClaims,
        });
        return;
      }
      case 'for_each': {
        if (statement.atMost > this.policy.maxLoopIterations) {
          this.add({
            code: 'E_LOOP_BOUND_EXCEEDED',
            rule: 'S3',
            message: `for_each bound ${String(statement.atMost)} exceeds the policy limit of ${String(this.policy.maxLoopIterations)}`,
            ...this.locate(statement),
          });
        }
        this.checkUnits(statement.collection, statement);
        this.checkSteps(statement.body, scope);
        return;
      }
      case 'repeat': {
        if (statement.times > this.policy.maxLoopIterations) {
          this.add({
            code: 'E_LOOP_BOUND_EXCEEDED',
            rule: 'S3',
            message: `repeat ${String(statement.times)} exceeds the policy limit of ${String(this.policy.maxLoopIterations)}`,
            ...this.locate(statement),
          });
        }
        this.checkSteps(statement.body, scope);
        return;
      }
      case 'when': {
        const physical = blockContainsPhysical(statement.body);
        if (physical) {
          this.checkFreshness(statement.condition, statement.freshness, 'S5', 'when', statement);
        }
        this.checkUnits(statement.condition, statement);
        this.checkSteps(statement.body, scope);
        if (statement.otherwise) this.checkSteps(statement.otherwise, scope);
        return;
      }
      case 'parallel': {
        if (statement.branches.length > this.policy.maxParallelBranches) {
          this.add({
            code: 'E_BRANCH_WIDTH',
            rule: 'S8',
            message: `${String(statement.branches.length)} parallel branches exceeds the policy limit of ${String(this.policy.maxParallelBranches)}`,
            ...this.locate(statement),
          });
        }
        this.checkParallelClaims(statement, scope);
        for (const branch of statement.branches) {
          this.checkSteps(branch.body, {
            permits: scope.permits,
            guards: scope.guards,
            branchClaims: [...scope.branchClaims, resourceKey(branch.resource, describeExpr)],
          });
        }
        return;
      }
      case 'sequence': {
        this.checkSteps(statement.body, scope);
        return;
      }
      case 'run_task': {
        if (statement.depthAtMost > this.policy.maxSubtaskDepth) {
          this.add({
            code: 'E_SUBTASK_DEPTH',
            rule: 'S8',
            message: `run_task depth ${String(statement.depthAtMost)} exceeds the policy limit of ${String(this.policy.maxSubtaskDepth)}`,
            ...this.locate(statement),
          });
        }
        if (
          this.context.knownTasks &&
          !this.context.knownTasks.includes(`${statement.name}@${statement.version}`)
        ) {
          this.add({
            code: 'E_SUBTASK_UNKNOWN',
            rule: 'S1',
            message: `subtask "${statement.name}@${statement.version}" is not installed`,
            ...this.locate(statement),
          });
        }
        break;
      }
      case 'record': {
        for (const field of statement.fields) this.checkUnits(field.value, statement);
        break;
      }
      case 'await': {
        this.checkDeadlineBudget(statement.within.ms, statement);
        if (statement.target.condition) this.checkUnits(statement.target.condition, statement);
        break;
      }
      default:
        break;
    }

    // Every expression anywhere is unit-checked and determinism-checked.
    for (const expr of statementExpressions(statement)) {
      this.checkUnits(expr, statement);
      this.checkDeterminism(expr, statement);
    }
  }

  private checkCapability(capability: string, statement: Statement): void {
    const descriptor = this.context.capabilities.find((entry) => entry.id === capability);
    if (!descriptor) {
      this.add({
        code: 'E_CAPABILITY_UNKNOWN',
        rule: 'S1',
        message: `capability "${capability}" is not in the installed allow-list`,
        ...this.locate(statement),
      });
      return;
    }
    const manifest = this.context.manifestCapabilities;
    if (manifest && manifest.length > 0 && !manifest.includes(capability)) {
      this.add({
        code: 'E_CAPABILITY_NOT_IN_MANIFEST',
        rule: 'S1',
        message: `capability "${capability}" is not declared by cassette ${this.task.requires.cassette}`,
        ...this.locate(statement),
      });
    }
    if (descriptor.requiresProcessApproval && !this.task.requires.processApproval) {
      this.add({
        code: 'E_CAPABILITY_GATE_UNAPPROVED',
        rule: 'S1',
        message: `capability "${capability}" is ${descriptor.hazardClass} at gate ${descriptor.gate} and needs a process approval reference`,
        ...this.locate(statement),
      });
    }
  }

  /** S4: gated actuation must sit inside a permit scope. */
  private checkPermitEnclosure(statement: Statement, scope: { permits: string[] }): void {
    const descriptor = this.context.capabilities.find(
      (entry) => entry.id === (statement.kind === 'actuate' ? statement.capability : ''),
    );
    if (!descriptor) return;
    const gated =
      descriptor.hazardClass === 'conditional_task' || descriptor.hazardClass === 'actuation_gated';
    if (!gated) return;
    if (scope.permits.length === 0) {
      this.add({
        code: 'E_UNPERMITTED_ACTUATION',
        rule: 'S4',
        message: `actuate ${descriptor.id} (${descriptor.hazardClass}) is not lexically enclosed by a with_permit block`,
        ...this.locate(statement),
      });
    }
  }

  /** S2: post-conditions are observable state, not script-private variables. */
  private checkPostconditions(statement: Extract<Statement, { kind: 'actuate' }>): void {
    for (const assertion of statement.verify) {
      for (const use of collectRefs(assertion.condition)) {
        if (use.expr.base.type === 'variable' && !use.insideIndex) {
          this.add({
            code: 'E_POSTCONDITION_UNOBSERVABLE',
            rule: 'S2',
            message: `verify reads $${use.expr.base.name}, which is script state; post-conditions must read observable carrier/cassette/tool state`,
            ...this.locate(statement),
          });
        }
        if (use.expr.base.type === 'state' && !use.expr.freshness && !assertion.freshness) {
          this.add({
            code: 'E_STALE_STATE_READ',
            rule: 'S5',
            message: `verify reads ${describeRef(use.expr)} without a freshness bound`,
            ...this.locate(statement),
          });
        }
      }
    }
  }

  /** S10: bounded retry with an explicit idempotency key. */
  private checkIdempotency(statement: Extract<Statement, { kind: 'actuate' }>): void {
    const mismatch = statement.onMismatch;
    if (mismatch?.kind === 'retry') {
      if (mismatch.atMost > this.policy.maxLoopIterations) {
        this.add({
          code: 'E_LOOP_BOUND_EXCEEDED',
          rule: 'S3',
          message: `retry at_most ${String(mismatch.atMost)} exceeds the policy limit`,
          ...this.locate(statement),
        });
      }
      if (!statement.idempotencyKey && !mismatch.idempotencyKey) {
        this.add({
          code: 'E_MISSING_IDEMPOTENCY_KEY',
          rule: 'S10',
          message: `actuate ${statement.capability} retries without an idempotency_key`,
          ...this.locate(statement),
        });
      }
    }
  }

  private checkDeadlineBudget(ms: number, statement: Statement): void {
    const deadline = this.task.limits['task_deadline'];
    if (!deadline) return;
    const total = deadline.value * (TIME_FACTORS[deadline.unit] ?? 1);
    if (ms > total) {
      this.add({
        code: 'E_LOOP_BOUND_EXCEEDED',
        rule: 'S3',
        message: `a single action budget of ${String(ms)} ms exceeds the task deadline of ${String(total)} ms`,
        ...this.locate(statement),
      });
    }
  }

  /** S11: one claim per exclusive resource, and no traction/tool overlap. */
  /**
   * S11 inside one statement: a resource list may not name the same exclusive
   * instance twice, and work inside a parallel branch may only touch what that
   * branch claimed. Re-requesting an ancestor's claim is not a conflict: it is
   * the same holder narrowing its own scope (branch -> permit -> actuate).
   */
  private checkResources(specs: ResourceSpec[], statement: Statement, scope: Scope): void {
    const keys = this.claimKeys(specs);
    const local = new Set<string>();
    for (const key of keys) {
      if (local.has(key) && isExclusive(key)) {
        this.add({
          code: 'E_RESOURCE_DOUBLE_CLAIM',
          rule: 'S11',
          message: `resource "${key}" is claimed twice by the same statement`,
          ...this.locate(statement),
        });
      }
      local.add(key);
      if (!isExclusive(key)) continue;
      if (scope.branchClaims.includes(key)) continue;
      if (scope.branchClaims.length > 0) {
        this.add({
          code: 'E_RESOURCE_DOUBLE_CLAIM',
          rule: 'S11',
          message: `claims "${key}" inside a parallel branch that holds ${scope.branchClaims.join(', ')}; another branch may own it`,
          ...this.locate(statement),
        });
      }
    }
  }

  private checkParallelClaims(
    statement: Extract<Statement, { kind: 'parallel' }>,
    scope: Scope,
  ): void {
    const seen = new Map<string, number>();
    let tractionClaimed = false;
    let toolClaimed = false;
    statement.branches.forEach((branch, index) => {
      const key = resourceKey(branch.resource, describeExpr);
      const previous = seen.get(key);
      if (previous !== undefined) {
        this.add({
          code: 'E_RESOURCE_DOUBLE_CLAIM',
          rule: 'S11',
          message: `parallel branches ${String(previous + 1)} and ${String(index + 1)} both claim "${key}"`,
          ...this.locate(statement),
        });
      }
      seen.set(key, index);
      if (isExclusive(key) && scope.branchClaims.includes(key)) {
        this.add({
          code: 'E_RESOURCE_DOUBLE_CLAIM',
          rule: 'S11',
          message: `parallel branch ${String(index + 1)} claims "${key}" which the enclosing branch already holds`,
          ...this.locate(statement),
        });
      }
      if (branch.resource.klass === 'traction') tractionClaimed = true;
      if (branch.resource.klass === 'tool') toolClaimed = true;
      if (blockClaimsTraction(branch.body) && branch.resource.klass === 'tool') toolClaimed = true;
      if (blockClaimsTool(branch.body) && branch.resource.klass === 'traction')
        tractionClaimed = true;
    });

    if (tractionClaimed && toolClaimed && this.context.motionDuringToolUse !== true) {
      this.add({
        code: 'E_TRACTION_TOOL_OVERLAP',
        rule: 'S11',
        message:
          'traction and a tool instance are claimed concurrently, but the cassette manifest does not approve motion during tool use',
        ...this.locate(statement),
      });
    }
  }

  private claimKeys(specs: ResourceSpec[]): string[] {
    return specs.map((spec) => resourceKey(spec, describeExpr));
  }

  /** S9: dimensional consistency inside one expression. */
  private checkUnits(expr: Expr, statement: Statement): void {
    for (const node of collectExprs(expr)) {
      if (node.kind !== 'binary') continue;
      const left = quantityOf(node.left);
      const right = quantityOf(node.right);
      if (node.op === '+' || node.op === '-') {
        if (left && right && dimensionOf(left.unit) !== dimensionOf(right.unit)) {
          this.add({
            code: 'E_UNIT_MISMATCH',
            rule: 'S9',
            message: `cannot combine ${formatQuantity(left)} with ${formatQuantity(right)}`,
            ...this.locate(statement),
            span: node.span,
          });
        }
        if (
          (left && !right && !isStringExpr(node.right)) ||
          (right && !left && !isStringExpr(node.left))
        ) {
          this.add({
            code: 'E_UNIT_REQUIRED',
            rule: 'S9',
            message: `${formatQuantity(left ?? right!)} is combined with a unit-less value; every physical number carries its unit`,
            ...this.locate(statement),
            span: node.span,
          });
        }
      }
      if (['==', '!=', '<', '<=', '>', '>='].includes(node.op)) {
        if (left && right && dimensionOf(left.unit) !== dimensionOf(right.unit)) {
          this.add({
            code: 'E_UNIT_MISMATCH',
            rule: 'S9',
            message: `cannot compare ${formatQuantity(left)} with ${formatQuantity(right)}`,
            ...this.locate(statement),
            span: node.span,
          });
        }
        if (left && !right && node.right.kind === 'number') {
          this.add({
            code: 'E_UNIT_REQUIRED',
            rule: 'S9',
            message: `${formatQuantity(left)} is compared with a unit-less number`,
            ...this.locate(statement),
            span: node.span,
          });
        }
        if (right && !left && node.left.kind === 'number') {
          this.add({
            code: 'E_UNIT_REQUIRED',
            rule: 'S9',
            message: `${formatQuantity(right)} is compared with a unit-less number`,
            ...this.locate(statement),
            span: node.span,
          });
        }
      }
      if (node.op === '+') {
        const leftKind = stringness(node.left);
        const rightKind = stringness(node.right);
        if (leftKind === 'string' && rightKind === 'numeric') {
          this.add({
            code: 'E_UNIT_MISMATCH',
            rule: 'S9',
            message: '"+" combines a string with a quantity or number; format the number first',
            ...this.locate(statement),
            span: node.span,
          });
        }
        if (leftKind === 'numeric' && rightKind === 'string') {
          this.add({
            code: 'E_UNIT_MISMATCH',
            rule: 'S9',
            message: '"+" combines a quantity or number with a string; format the number first',
            ...this.locate(statement),
            span: node.span,
          });
        }
      }
    }
  }

  /** S10: no wall clock, no randomness, closed built-in set. */
  private checkDeterminism(expr: Expr, statement: Statement): void {
    for (const node of collectExprs(expr)) {
      if (node.kind === 'call' && !(BUILTINS as readonly string[]).includes(node.name)) {
        this.add({
          code: 'E_NON_DETERMINISTIC',
          rule: 'S10',
          message: `built-in "${node.name}" is not in the closed expression library`,
          ...this.locate(statement),
          span: node.span,
        });
      }
      if (node.kind === 'ref' && node.base.type === 'state') {
        const root = node.base.root;
        if (!(STATE_ROOTS as readonly string[]).includes(root)) {
          this.add({
            code: 'E_NON_DETERMINISTIC',
            rule: 'S10',
            message: `state root "${root}" is not in the closed state vocabulary`,
            ...this.locate(statement),
            span: node.span,
          });
        }
        if (root === 'environment' && node.steps.length === 0) {
          this.add({
            code: 'E_NON_DETERMINISTIC',
            rule: 'S10',
            severity: 'warning',
            message:
              'reading the whole "environment" root is not deterministic; read a named field',
            ...this.locate(statement),
            span: node.span,
          });
        }
      }
    }
  }
}

const TIME_FACTORS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };

function quantityOf(expr: Expr): Quantity | undefined {
  return expr.kind === 'quantity' ? expr.value : undefined;
}

function isStringExpr(expr: Expr): boolean {
  return expr.kind === 'string';
}

/**
 * Whether an expression is definitely a string, definitely numeric, or unknown
 * until run time. References and built-in calls are unknown: `task.run_id` is a
 * string and `tool.load_mass` is a quantity, and only the world can say which.
 */
function stringness(expr: Expr): 'string' | 'numeric' | 'unknown' {
  switch (expr.kind) {
    case 'string':
      return 'string';
    case 'number':
    case 'quantity':
      return 'numeric';
    default:
      return 'unknown';
  }
}

function formatQuantity(quantity: Quantity): string {
  return `${String(quantity.value)} ${quantity.unit}`;
}

function isExclusive(key: string): boolean {
  return key.startsWith('tool') || key === 'traction';
}

function describeRef(ref: Extract<Expr, { kind: 'ref' }>): string {
  const base = ref.base.type === 'state' ? ref.base.root : `$${ref.base.name}`;
  const steps = ref.steps
    .map((step) => (step.type === 'field' ? `.${step.name}` : `[${describeExpr(step.expr)}]`))
    .join('');
  return `${base}${steps}`;
}

function describeExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'ref':
      return describeRef(expr);
    case 'string':
      return `"${expr.value}"`;
    case 'enum':
      return `#${expr.name}`;
    case 'number':
      return String(expr.value);
    case 'quantity':
      return formatQuantity(expr.value);
    case 'boolean':
      return String(expr.value);
    case 'null':
      return 'null';
    case 'call':
      return `${expr.name}(${expr.args.map(describeExpr).join(', ')})`;
    case 'list':
      return `[${expr.items.map(describeExpr).join(', ')}]`;
    case 'struct':
      return `{ ${expr.fields.map((field) => `${field.name} = ${describeExpr(field.value)}`).join(', ')} }`;
    case 'unary':
      return `${expr.op}${describeExpr(expr.operand)}`;
    case 'binary':
      return `${describeExpr(expr.left)} ${expr.op} ${describeExpr(expr.right)}`;
    default:
      return '?';
  }
}

function shadowedRoot(statement: Statement): string | undefined {
  if (statement.kind === 'observe') {
    return (STATE_ROOTS as readonly string[]).includes(statement.into) ? statement.into : undefined;
  }
  if (statement.kind === 'for_each') {
    return (STATE_ROOTS as readonly string[]).includes(statement.variable)
      ? statement.variable
      : undefined;
  }
  return undefined;
}

function blockClaimsTraction(statements: Statement[]): boolean {
  return statements.some(
    (statement) =>
      statement.kind === 'move' || statement.kind === 'dock' || statement.kind === 'return_to',
  );
}

function blockClaimsTool(statements: Statement[]): boolean {
  return statements.some((statement) => statement.kind === 'actuate');
}

/** Jump targets declared by a statement (`on_breach goto x`, …). */
export function jumpTargets(statement: Statement): string[] {
  const targets: string[] = [];
  const push = (value: { kind: string; target?: string } | undefined): void => {
    if (value && value.kind === 'goto' && value.target) targets.push(value.target);
  };
  if (statement.kind === 'guard') push(statement.onBreach);
  if (statement.kind === 'await') push(statement.onTimeout);
  if (statement.kind === 'request_permit') push(statement.onDenied);
  if (statement.kind === 'for_each') push(statement.onExhausted);
  return targets;
}

/** Whether the statement routes a failure into the task's on_fault clause. */
export function hasFaultRoute(statement: Statement): boolean {
  if (statement.kind === 'actuate' && statement.onMismatch?.kind === 'fault') return true;
  if (statement.kind === 'guard' && statement.onBreach?.kind === 'fault') return true;
  if (statement.kind === 'await' && statement.onTimeout?.kind === 'fault') return true;
  if (statement.kind === 'request_permit' && statement.onDenied?.kind === 'fault') return true;
  if (statement.kind === 'for_each' && statement.onExhausted?.kind === 'fault') return true;
  return false;
}

/** Every expression a statement mentions, for whole-statement checks. */
export function statementExpressions(statement: Statement): Expr[] {
  const record = statement as unknown as Record<string, unknown>;
  const out: Expr[] = [];
  const push = (value: unknown): void => {
    if (value && typeof value === 'object' && 'kind' in (value as object)) {
      const candidate = value as Expr;
      if (typeof candidate.kind === 'string') out.push(candidate);
    }
  };
  push(record['condition']);
  push(record['reason']);
  push(record['message']);
  push(record['abstainIf']);
  push(record['collection']);
  push(record['idempotencyKey']);
  if (Array.isArray(record['args'])) {
    for (const arg of record['args'] as Array<{ value: Expr }>) push(arg.value);
  }
  if (Array.isArray(record['verify'])) {
    for (const assertion of record['verify'] as Array<{ condition: Expr }>)
      push(assertion.condition);
  }
  if (Array.isArray(record['fields'])) {
    for (const field of record['fields'] as Array<{ value: Expr }>) push(field.value);
  }
  return out;
}

/** Collects every semantic issue without throwing. */
export function validateTask(ast: TaskAst, context: TaskValidationContext): ValidationIssue[] {
  return new TaskValidator(ast, context).validate();
}

/** Throws when any error-severity issue exists. */
export function assertTaskValid(ast: TaskAst, context: TaskValidationContext): ValidationIssue[] {
  const issues = validateTask(ast, context);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new TaskValidationError(ast.name, errors);
  return issues;
}
