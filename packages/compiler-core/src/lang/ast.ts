/**
 * Abstract syntax tree for `agri.task/v1`.
 *
 * One node type per grammar production group, each carrying the source span so
 * validator and runtime messages can name the exact token. The AST is the input
 * to semantic validation (grammar rules S1-S11) and to the canonical IR.
 */

export interface Span {
  /** Zero-based offset of the first character. */
  start: number;
  /** Zero-based offset just past the last character. */
  end: number;
  line: number;
  column: number;
}

export interface Quantity {
  value: number;
  unit: string;
}

export interface Duration extends Quantity {
  /** Normalised milliseconds; the only form the runtime uses. */
  ms: number;
}

export type ResourceClass = 'sensing' | 'logging' | 'communication' | 'tool' | 'traction' | 'fluid';

/** `tool`, `tool[hand_3]`, `tool[$held.id]` — an instance may be dynamic. */
export interface ResourceSpec {
  klass: ResourceClass;
  /** Literal instance name, or an expression evaluated at run time. */
  instance?: string | Expr;
  span: Span;
}

/** A commissioned zone/route id, or a path into a variable bound at run time. */
export type TargetRef =
  { kind: 'zone'; name: string; span: Span } | { kind: 'expr'; expr: Expr; span: Span };

export type PermitKind =
  'tool_energy' | 'auto_task' | 'auto_travel' | 'service' | 'fluid_line' | 'guarded_plot_entry';

export type DegradedMode =
  'sensing_only' | 'shadow' | 'reduced_speed' | 'hold_position' | 'return_to_dock';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type JoinPolicy =
  { kind: 'all' } | { kind: 'first_success' } | { kind: 'quorum'; count: number };

/** `fault` routes to the task's on_fault clause; an id routes to a statement. */
export type FaultOrId = { kind: 'fault' } | { kind: 'goto'; target: string };

export type RefBase = { type: 'state'; root: string } | { type: 'variable'; name: string };

export type RefStep = { type: 'field'; name: string } | { type: 'index'; expr: Expr };

export type BinaryOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '&&' | '||';

export type Expr =
  | { kind: 'quantity'; value: Quantity; span: Span }
  | { kind: 'number'; value: number; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'boolean'; value: boolean; span: Span }
  | { kind: 'null'; span: Span }
  | { kind: 'enum'; name: string; span: Span }
  | { kind: 'ref'; base: RefBase; steps: RefStep[]; freshness?: Duration; span: Span }
  | { kind: 'call'; name: string; args: Expr[]; span: Span }
  | { kind: 'unary'; op: '-' | '!'; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | { kind: 'list'; items: Expr[]; span: Span }
  | { kind: 'struct'; fields: Array<{ name: string; value: Expr }>; span: Span };

export interface Argument {
  name: string;
  value: Expr;
}

export interface Assertion {
  condition: Expr;
  /** Statement-level freshness bound; a ref may also carry its own. */
  freshness?: Duration;
  span: Span;
}

export interface RetrySpec {
  atMost: number;
  backoff?: Duration;
  idempotencyKey: Expr;
}

export type OnMismatch = { kind: 'fault' } | ({ kind: 'retry' } & RetrySpec);

export interface AwaitTarget {
  kind: 'event' | 'completion' | 'operator' | 'condition';
  name?: string;
  ofStatement?: string;
  prompt?: string;
  replyInto?: string;
  choices?: string[];
  condition?: Expr;
  span: Span;
}

export interface Branch {
  id?: string;
  resource: ResourceSpec;
  body: Statement[];
  span: Span;
}

export type Statement =
  | {
      kind: 'move';
      id?: string;
      route: TargetRef;
      speed?: Quantity;
      within: Duration;
      span: Span;
    }
  | {
      kind: 'dock';
      id?: string;
      station: TargetRef;
      tolerance?: Quantity;
      within: Duration;
      span: Span;
    }
  | { kind: 'return_to'; id?: string; place: TargetRef; within: Duration; span: Span }
  | {
      kind: 'actuate';
      id?: string;
      capability: string;
      args: Argument[];
      using?: ResourceSpec[];
      within: Duration;
      verify: Assertion[];
      onMismatch?: OnMismatch;
      idempotencyKey?: Expr;
      span: Span;
    }
  | {
      kind: 'observe';
      id?: string;
      capability: string;
      args: Argument[];
      into: string;
      within?: Duration;
      abstainIf?: Expr;
      span: Span;
    }
  | {
      kind: 'await';
      id?: string;
      target: AwaitTarget;
      within: Duration;
      onTimeout?: FaultOrId;
      span: Span;
    }
  | {
      kind: 'with_permit';
      id?: string;
      permit: PermitKind;
      on?: ResourceSpec[];
      lease?: Duration;
      body: Statement[];
      span: Span;
    }
  | {
      kind: 'request_permit';
      id?: string;
      permit: PermitKind;
      on?: ResourceSpec[];
      lease?: Duration;
      onDenied?: FaultOrId;
      span: Span;
    }
  | {
      kind: 'guard';
      id?: string;
      condition: Expr;
      /** Assertion-level `@ within <duration>` when the condition is compound. */
      freshness?: Duration;
      every: Duration;
      body: Statement[];
      onBreach?: FaultOrId;
      span: Span;
    }
  | {
      kind: 'for_each';
      id?: string;
      variable: string;
      collection: Expr;
      atMost: number;
      body: Statement[];
      onExhausted?: FaultOrId;
      span: Span;
    }
  | { kind: 'repeat'; id?: string; times: number; body: Statement[]; span: Span }
  | {
      kind: 'when';
      id?: string;
      condition: Expr;
      /** Assertion-level `@ within <duration>` when the condition is compound. */
      freshness?: Duration;
      body: Statement[];
      otherwise?: Statement[];
      span: Span;
    }
  | { kind: 'parallel'; id?: string; branches: Branch[]; join: JoinPolicy; span: Span }
  | { kind: 'sequence'; id?: string; body: Statement[]; span: Span }
  | { kind: 'record'; id?: string; event: string; fields: Argument[]; span: Span }
  | { kind: 'safe_stop'; id?: string; reason?: Expr; span: Span }
  | { kind: 'park_tool'; id?: string; span: Span }
  | { kind: 'degrade_to'; id?: string; mode: DegradedMode; reason?: Expr; span: Span }
  | {
      kind: 'notify';
      id?: string;
      role: string;
      severity: Severity;
      message?: string;
      span: Span;
    }
  | {
      kind: 'run_task';
      id?: string;
      name: string;
      version: string;
      args?: Argument[];
      depthAtMost: number;
      span: Span;
    }
  | {
      kind: 'finish';
      id?: string;
      status: 'success' | 'failed' | 'aborted';
      errorCode?: string;
      message?: Expr;
      span: Span;
    }
  | { kind: 'noop'; id?: string; label?: string; span: Span };

export interface RequiresClause {
  cassette: string;
  capabilities: string[];
  operatorPolicy: string;
  zones: string[];
  map?: string;
  route?: { ref: string; commissioned: boolean };
  model?: string;
  calibration?: string;
  processApproval?: string;
}

export interface EvidenceClause {
  retain: string[];
  privacy?: string;
  retentionDays?: number;
}

export interface MetaClause {
  owner?: string;
  changeTicket?: string;
  description?: string;
  tags?: string[];
}

export interface TaskAst {
  meta?: MetaClause;
  name: string;
  version: string;
  requires: RequiresClause;
  limits: Record<string, Quantity>;
  preflight: Assertion[];
  steps: Statement[];
  onFault: Statement[];
  evidence: EvidenceClause;
  span: Span;
}

/** Statement kinds that can physically affect the world. */
export const PHYSICAL_STATEMENTS = ['move', 'dock', 'return_to', 'actuate'] as const;

/** Statement kinds that only sense or record. */
export const PASSIVE_STATEMENTS = ['observe', 'record', 'notify', 'noop'] as const;

/** Statement kinds that request a reduction of energy or capability. */
export const SAFETY_REQUEST_STATEMENTS = ['safe_stop', 'park_tool', 'degrade_to'] as const;
