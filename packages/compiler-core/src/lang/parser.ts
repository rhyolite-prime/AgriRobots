import { AgriScriptError, ERROR_CODES } from '../errors.ts';
import type {
  Argument,
  Assertion,
  AwaitTarget,
  Branch,
  DegradedMode,
  Duration,
  Expr,
  FaultOrId,
  JoinPolicy,
  MetaClause,
  OnMismatch,
  Quantity,
  RequiresClause,
  ResourceClass,
  ResourceSpec,
  Severity,
  TargetRef,
  Span,
  Statement,
  TaskAst,
} from './ast.ts';
import { tokenize, type Token } from './lexer.ts';

/** Closed vocabulary from the grammar's <state-root> production. */
export const STATE_ROOTS = [
  'carrier',
  'cassette',
  'tool',
  'battery',
  'safety',
  'localization',
  'perception',
  'route',
  'zone',
  'inventory',
  'operator',
  'task',
  'environment',
] as const;

/** Closed vocabulary from the grammar's <builtin-name> production. */
export const BUILTINS = [
  'abs',
  'min',
  'max',
  'clamp',
  'len',
  'sum',
  'age_of',
  'quality_of',
  'confidence_of',
  'unit_of',
  'coalesce',
  'in_zone',
  'within_tolerance',
  'is_fresh',
  'count_of',
] as const;

export const RESOURCE_CLASSES = [
  'sensing',
  'logging',
  'communication',
  'tool',
  'traction',
  'fluid',
] as const;

export const PERMIT_KINDS = [
  'tool_energy',
  'auto_task',
  'auto_travel',
  'service',
  'fluid_line',
  'guarded_plot_entry',
] as const;

export const DEGRADED_MODES = [
  'sensing_only',
  'shadow',
  'reduced_speed',
  'hold_position',
  'return_to_dock',
] as const;

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const OPERATOR_POLICIES = [
  'supervisor_on_site',
  'two_person_rule',
  'remote_observer',
  'unattended_forbidden',
] as const;

export const RETAIN_ITEMS = [
  'recipe_hash',
  'cassette_manifest',
  'route_events',
  'safety_events',
  'scale_trace',
  'dose_trace',
  'tool_trace',
  'perception_records',
  'operator_actions',
  'calibration_refs',
  'model_refs',
  'journal',
] as const;

const TIME_UNITS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };

export class ParseError extends AgriScriptError {
  readonly span: Span;
  readonly line: number;
  readonly column: number;

  constructor(message: string, span: Span) {
    super(ERROR_CODES.yamlParse, `${message} (line ${span.line}, column ${span.column})`);
    this.name = 'ParseError';
    this.span = span;
    this.line = span.line;
    this.column = span.column;
  }
}

/** Recursive-descent parser for `agri.task/v1`. */
export class TaskParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  // -- token helpers ---------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== 'eof') this.index += 1;
    return token;
  }

  private isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === 'punct' && token.value === value;
  }

  private isIdent(value?: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === 'ident' && (value === undefined || token.value === value);
  }

  private eatPunct(value: string): boolean {
    if (this.isPunct(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private eatIdent(value: string): boolean {
    if (this.isIdent(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectPunct(value: string): Span {
    const token = this.peek();
    if (!this.isPunct(value)) {
      throw new ParseError(`expected "${value}" but found ${describeToken(token)}`, token.span);
    }
    return this.advance().span;
  }

  private expectIdent(value: string): void {
    const token = this.peek();
    if (!this.isIdent(value)) {
      throw new ParseError(`expected "${value}" but found ${describeToken(token)}`, token.span);
    }
    this.advance();
  }

  private identToken(): Token {
    const token = this.peek();
    if (token.type !== 'ident') {
      throw new ParseError(`expected an identifier but found ${describeToken(token)}`, token.span);
    }
    return this.advance();
  }

  private fail(message: string, span?: Span): never {
    throw new ParseError(message, span ?? this.peek().span);
  }

  // -- document --------------------------------------------------------------

  parse(): TaskAst {
    const start = this.peek().span;
    const meta = this.isIdent('meta') ? this.parseMeta() : undefined;

    this.expectIdent('task');
    const nameToken = this.identToken();
    this.expectPunct('@');
    const version = this.parseVersionText();

    this.expectPunct('{');
    const requires = this.parseRequires();
    const limits = this.parseLimits();
    const preflight = this.parsePreflight();
    const steps = this.parseNamedBlock('steps');
    const onFault = this.parseNamedBlock('on_fault');
    const evidence = this.parseEvidence();
    const end = this.expectPunct('}');

    if (this.peek().type !== 'eof') {
      this.fail(`unexpected trailing input ${describeToken(this.peek())}`);
    }

    return {
      ...(meta ? { meta } : {}),
      name: nameToken.value,
      version,
      requires,
      limits,
      preflight,
      steps,
      onFault,
      evidence,
      span: { start: start.start, end: end.end, line: start.line, column: start.column },
    };
  }

  private parseMeta(): MetaClause {
    this.expectIdent('meta');
    this.expectPunct('{');
    const meta: MetaClause = {};
    while (!this.isPunct('}')) {
      const key = this.identToken().value;
      if (key === 'tags') {
        meta.tags = this.parseStringList();
      } else {
        const token = this.peek();
        if (token.type !== 'string') {
          this.fail(`meta.${key} expects a string literal`);
        }
        const value = this.advance().value;
        if (key === 'owner') meta.owner = value;
        else if (key === 'change_ticket') meta.changeTicket = value;
        else if (key === 'description') meta.description = value;
        else this.fail(`unknown meta entry "${key}"`);
      }
      this.expectPunct(';');
    }
    this.expectPunct('}');
    return meta;
  }

  private parseStringList(): string[] {
    const values: string[] = [];
    for (;;) {
      const token = this.peek();
      if (token.type !== 'string') this.fail('expected a string literal');
      values.push(this.advance().value);
      if (!this.eatPunct(',')) return values;
    }
  }

  /** A version is one lexical unit: `1.0.0`. */
  private parseVersionText(): string {
    const token = this.peek();
    if (token.type !== 'version') {
      this.fail(`expected a version such as 1.0.0 but found ${describeToken(token)}`);
    }
    this.advance();
    return token.value;
  }

  private parseRequires(): RequiresClause {
    this.expectIdent('requires');
    this.expectPunct('{');
    const requires: RequiresClause = {
      cassette: '',
      capabilities: [],
      operatorPolicy: '',
      zones: [],
    };
    let seenCassette = false;
    let seenOperator = false;
    let seenZones = false;

    while (!this.isPunct('}')) {
      const keyToken = this.identToken();
      switch (keyToken.value) {
        case 'cassette': {
          requires.cassette = this.identToken().value;
          this.expectIdent('with');
          requires.capabilities = this.parseCapabilityList();
          seenCassette = true;
          break;
        }
        case 'operator': {
          requires.operatorPolicy = this.identToken().value;
          if (!OPERATOR_POLICIES.includes(requires.operatorPolicy as never)) {
            this.fail(`unknown operator policy "${requires.operatorPolicy}"`, keyToken.span);
          }
          seenOperator = true;
          break;
        }
        case 'zones': {
          requires.zones = this.parseIdentifierList();
          seenZones = true;
          break;
        }
        case 'map':
        case 'model': {
          const ref = this.parseArtifactRef();
          if (keyToken.value === 'map') requires.map = ref;
          else requires.model = ref;
          break;
        }
        case 'route': {
          const ref = this.identToken().value;
          const commissioned = this.eatIdent('commissioned');
          requires.route = { ref, commissioned };
          break;
        }
        case 'calibration': {
          requires.calibration = this.identToken().value;
          break;
        }
        case 'process_approval': {
          requires.processApproval = this.identToken().value;
          break;
        }
        default:
          this.fail(`unknown requires entry "${keyToken.value}"`, keyToken.span);
      }
      this.expectPunct(';');
    }
    this.expectPunct('}');

    if (!seenCassette) this.fail('requires: missing "cassette <id> with <capabilities>;"');
    if (!seenOperator) this.fail('requires: missing "operator <policy>;"');
    if (!seenZones) this.fail('requires: missing "zones <zone>, …;"');
    return requires;
  }

  private parseCapabilityList(): string[] {
    const ids: string[] = [];
    for (;;) {
      ids.push(this.parseCapabilityId());
      if (!this.eatPunct(',')) return ids;
    }
  }

  /** `pick_egg.v1` lexes as ident "." ident. */
  private parseCapabilityId(): string {
    const base = this.identToken();
    if (!this.eatPunct('.')) {
      this.fail(`capability "${base.value}" is missing its ".v<n>" version`, base.span);
    }
    const version = this.identToken();
    if (!/^v[0-9]+$/.test(version.value)) {
      this.fail(`capability version "${version.value}" must look like v1`, version.span);
    }
    return `${base.value}.${version.value}`;
  }

  private parseIdentifierList(): string[] {
    const ids: string[] = [];
    for (;;) {
      ids.push(this.identToken().value);
      if (!this.eatPunct(',')) return ids;
    }
  }

  /** `name@1.2.3` with an optional `#<hash>` suffix. */
  private parseArtifactRef(): string {
    const name = this.identToken().value;
    if (!this.eatPunct('@')) return name;
    const version = this.parseVersionText();
    if (this.peek().type === 'enum') {
      return `${name}@${version}#${this.advance().value}`;
    }
    return `${name}@${version}`;
  }

  private parseLimits(): Record<string, Quantity> {
    this.expectIdent('limits');
    this.expectPunct('{');
    const limits: Record<string, Quantity> = {};
    while (!this.isPunct('}')) {
      const key = this.identToken().value;
      this.expectPunct('=');
      const token = this.peek();
      if (token.type !== 'quantity') {
        this.fail(`limit "${key}" must be a quantity with a unit`, token.span);
      }
      this.advance();
      if (key in limits) this.fail(`limit "${key}" is declared twice`, token.span);
      limits[key] = { value: token.number ?? 0, unit: token.unit ?? '' };
      this.expectPunct(';');
    }
    this.expectPunct('}');
    return limits;
  }

  private parsePreflight(): Assertion[] {
    this.expectIdent('preflight');
    this.expectPunct('{');
    const assertions: Assertion[] = [];
    while (!this.isPunct('}')) {
      assertions.push(this.parseAssertion());
      this.expectPunct(';');
    }
    this.expectPunct('}');
    if (assertions.length === 0) this.fail('preflight must contain at least one assertion');
    return assertions;
  }

  private parseAssertion(): Assertion {
    const span = this.peek().span;
    const condition = this.parseExpr();
    const freshness = this.parseFreshnessSuffix() ?? trailingFreshness(condition);
    return { condition, ...(freshness ? { freshness } : {}), span };
  }

  /** A statement-level `@ within <duration>` following an expression. */
  private parseFreshnessSuffix(): Duration | undefined {
    if (!this.isPunct('@')) return undefined;
    this.advance();
    this.expectIdent('within');
    return this.parseDuration();
  }

  private parseNamedBlock(keyword: 'steps' | 'on_fault'): Statement[] {
    this.expectIdent(keyword);
    this.expectPunct('{');
    const statements = this.parseStatementList();
    this.expectPunct('}');
    if (keyword === 'on_fault' && statements.length === 0) {
      this.fail('on_fault must contain at least one statement');
    }
    return statements;
  }

  private parseEvidence(): { retain: string[]; privacy?: string; retentionDays?: number } {
    this.expectIdent('evidence');
    this.expectPunct('{');
    this.expectIdent('retain');
    const retain: string[] = [];
    for (;;) {
      const item = this.identToken().value;
      if (!RETAIN_ITEMS.includes(item as never)) {
        this.fail(`unknown evidence retention item "${item}"`);
      }
      retain.push(item);
      if (!this.eatPunct(',')) break;
    }
    this.expectPunct(';');

    let privacy: string | undefined;
    let retentionDays: number | undefined;
    while (!this.isPunct('}')) {
      const key = this.identToken().value;
      if (key === 'privacy') {
        privacy = this.identToken().value;
      } else if (key === 'retention_days') {
        const token = this.peek();
        if (token.type !== 'number') this.fail('retention_days expects an integer');
        retentionDays = this.advance().number;
      } else {
        this.fail(`unknown evidence entry "${key}"`);
      }
      this.expectPunct(';');
    }
    this.expectPunct('}');
    return { retain, ...(privacy ? { privacy } : {}), ...(retentionDays ? { retentionDays } : {}) };
  }

  // -- statements ------------------------------------------------------------

  private parseStatementList(): Statement[] {
    const statements: Statement[] = [];
    while (!this.isPunct('}') && this.peek().type !== 'eof') {
      statements.push(this.parseStatement());
    }
    return statements;
  }

  private parseStatement(): Statement {
    const startToken = this.peek();

    // optional statement label  `dispense: actuate …`
    let id: string | undefined;
    if (startToken.type === 'ident' && this.isPunct(':', 1)) {
      id = this.advance().value;
      this.advance();
    }

    const keywordToken = this.peek();
    if (keywordToken.type !== 'ident') {
      this.fail(`expected a statement keyword but found ${describeToken(keywordToken)}`);
    }

    const statement = this.parseStatementBody(keywordToken.value);
    const end = this.expectPunct(';');
    return {
      ...statement,
      ...(id ? { id } : {}),
      span: {
        start: startToken.span.start,
        end: end.end,
        line: startToken.span.line,
        column: startToken.span.column,
      },
    } as Statement;
  }

  private parseStatementBody(keyword: string): Statement {
    const span = this.peek().span;
    switch (keyword) {
      case 'move':
        return this.parseMove(span);
      case 'dock':
        return this.parseDock(span);
      case 'return_to':
        return this.parseReturnTo(span);
      case 'actuate':
        return this.parseActuate(span);
      case 'observe':
        return this.parseObserve(span);
      case 'await':
        return this.parseAwait(span);
      case 'with_permit':
        return this.parseWithPermit(span);
      case 'request_permit':
        return this.parseRequestPermit(span);
      case 'guard':
        return this.parseGuard(span);
      case 'for_each':
        return this.parseForEach(span);
      case 'repeat':
        return this.parseRepeat(span);
      case 'when':
        return this.parseWhen(span);
      case 'parallel':
        return this.parseParallel(span);
      case 'sequence':
        return this.parseSequence(span);
      case 'record':
        return this.parseRecord(span);
      case 'safe_stop':
        return this.parseSafeStop(span);
      case 'park_tool':
        this.advance();
        return { kind: 'park_tool', span };
      case 'degrade_to':
        return this.parseDegrade(span);
      case 'notify':
        return this.parseNotify(span);
      case 'run_task':
        return this.parseRunTask(span);
      case 'finish':
        return this.parseFinish(span);
      case 'noop': {
        this.advance();
        const label = this.peek().type === 'string' ? this.advance().value : undefined;
        return { kind: 'noop', ...(label ? { label } : {}), span };
      }
      default:
        return this.fail(`unknown statement keyword "${keyword}"`, span);
    }
  }

  private parseMove(span: Span): Statement {
    this.expectIdent('move');
    this.expectIdent('along');
    const route = this.parseTargetRef();
    let speed: Quantity | undefined;
    if (this.eatIdent('at')) {
      const token = this.peek();
      if (token.type !== 'quantity') this.fail('move … at expects a speed quantity');
      this.advance();
      speed = { value: token.number ?? 0, unit: token.unit ?? '' };
    }
    const within = this.parseWithin();
    return { kind: 'move', route, ...(speed ? { speed } : {}), within, span };
  }

  private parseDock(span: Span): Statement {
    this.expectIdent('dock');
    this.expectIdent('at');
    const station = this.parseTargetRef();
    let tolerance: Quantity | undefined;
    if (this.eatIdent('tolerance')) {
      const token = this.peek();
      if (token.type !== 'quantity') this.fail('dock … tolerance expects a length quantity');
      this.advance();
      tolerance = { value: token.number ?? 0, unit: token.unit ?? '' };
    }
    const within = this.parseWithin();
    return { kind: 'dock', station, ...(tolerance ? { tolerance } : {}), within, span };
  }

  private parseReturnTo(span: Span): Statement {
    this.expectIdent('return_to');
    const place = this.parseTargetRef();
    const within = this.parseWithin();
    return { kind: 'return_to', place, within, span };
  }

  /** `<motion-target> ::= <zone-id> | <variable-path>` */
  private parseTargetRef(): TargetRef {
    const token = this.peek();
    if (token.type === 'variable') {
      const expr = this.parseExpr();
      return { kind: 'expr', expr, span: token.span };
    }
    if (token.type !== 'ident') {
      this.fail(`expected a zone id or a $variable path but found ${describeToken(token)}`);
    }
    this.advance();
    return { kind: 'zone', name: token.value, span: token.span };
  }

  private parseWithin(): Duration {
    this.expectIdent('within');
    return this.parseDuration();
  }

  private parseDuration(): Duration {
    const token = this.peek();
    if (token.type !== 'quantity') {
      this.fail(`expected a duration such as "90 s" but found ${describeToken(token)}`);
    }
    this.advance();
    const unit = token.unit ?? '';
    const factor = TIME_UNITS[unit];
    if (factor === undefined) {
      this.fail(`"${String(token.number)} ${unit}" is not a duration`, token.span);
    }
    const value = token.number ?? 0;
    return { value, unit, ms: Math.round(value * factor) };
  }

  private parseActuate(span: Span): Statement {
    this.expectIdent('actuate');
    const capability = this.parseCapabilityId();
    const args = this.parseArguments();

    let using: ResourceSpec[] | undefined;
    if (this.eatIdent('using')) {
      using = this.parseResourceSpecList();
    }

    const within = this.parseWithin();

    this.expectIdent('verify');
    this.expectPunct('{');
    const verify: Assertion[] = [];
    while (!this.isPunct('}')) {
      verify.push(this.parseAssertion());
      this.expectPunct(';');
    }
    this.expectPunct('}');
    if (verify.length === 0) {
      this.fail(`actuate ${capability}: "verify" must state at least one post-condition`);
    }

    let onMismatch: OnMismatch | undefined;
    if (this.eatIdent('on_mismatch')) {
      if (this.eatIdent('fault')) {
        onMismatch = { kind: 'fault' };
      } else {
        this.expectIdent('retry');
        this.expectIdent('at_most');
        const atMostToken = this.peek();
        if (atMostToken.type !== 'number') this.fail('retry at_most expects an integer');
        const atMost = this.advance().number ?? 0;
        this.expectIdent('times');
        let backoff: Duration | undefined;
        if (this.eatIdent('backoff')) backoff = this.parseDuration();
        this.expectIdent('idempotency_key');
        const idempotencyKey = this.parseExpr();
        onMismatch = { kind: 'retry', atMost, ...(backoff ? { backoff } : {}), idempotencyKey };
      }
    }

    let idempotencyKey: Expr | undefined;
    if (this.eatIdent('idempotency_key')) {
      idempotencyKey = this.parseExpr();
    }

    return {
      kind: 'actuate',
      capability,
      args,
      ...(using ? { using } : {}),
      within,
      verify,
      ...(onMismatch ? { onMismatch } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      span,
    };
  }

  private parseArguments(): Argument[] {
    this.expectPunct('(');
    const args: Argument[] = [];
    while (!this.isPunct(')')) {
      const name = this.identToken().value;
      this.expectPunct('=');
      const value = this.parseExpr();
      args.push({ name, value });
      if (!this.eatPunct(',')) break;
    }
    this.expectPunct(')');
    return args;
  }

  private parseObserve(span: Span): Statement {
    this.expectIdent('observe');
    const capability = this.parseCapabilityId();
    const args = this.parseArguments();
    this.expectIdent('into');
    const intoToken = this.peek();
    if (intoToken.type !== 'variable') {
      this.fail('observe … into expects a $variable');
    }
    const into = this.advance().value;
    let within: Duration | undefined;
    if (this.isIdent('within')) within = this.parseWithin();
    let abstainIf: Expr | undefined;
    if (this.eatIdent('abstain_if')) abstainIf = this.parseExpr();
    return {
      kind: 'observe',
      capability,
      args,
      into,
      ...(within ? { within } : {}),
      ...(abstainIf ? { abstainIf } : {}),
      span,
    };
  }

  private parseAwait(span: Span): Statement {
    this.expectIdent('await');
    const target: AwaitTarget = this.isIdent('event')
      ? { kind: 'event', name: this.parseEventName(), span }
      : this.isIdent('completion_of')
        ? (this.advance(), { kind: 'completion', ofStatement: this.identToken().value, span })
        : this.isIdent('operator')
          ? this.parseOperatorPrompt(span)
          : { kind: 'condition', condition: this.parseExpr(), span };

    const within = this.parseWithin();
    let onTimeout: FaultOrId | undefined;
    if (this.eatIdent('on_timeout')) onTimeout = this.parseFaultOrId();
    return { kind: 'await', target, within, ...(onTimeout ? { onTimeout } : {}), span };
  }

  private parseOperatorPrompt(span: Span): AwaitTarget {
    this.expectIdent('operator');
    const token = this.peek();
    if (token.type !== 'string') this.fail('await operator expects a prompt string');
    const prompt = this.advance().value;
    let replyInto: string | undefined;
    if (this.eatIdent('reply')) {
      const variable = this.peek();
      if (variable.type !== 'variable') this.fail('reply expects a $variable');
      replyInto = this.advance().value;
    }
    let choices: string[] | undefined;
    if (this.eatIdent('choice_of')) choices = this.parseStringList();
    return {
      kind: 'operator',
      prompt,
      ...(replyInto ? { replyInto } : {}),
      ...(choices ? { choices } : {}),
      span,
    };
  }

  private parseEventName(): string {
    this.expectIdent('event');
    let name = this.identToken().value;
    while (this.isPunct('.') && this.peek(1).type === 'ident') {
      this.advance();
      name += `.${this.advance().value}`;
    }
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(name)) {
      this.fail(`event name "${name}" must be dotted lowercase, e.g. egg.picked`);
    }
    return name;
  }

  private parseWithPermit(span: Span): Statement {
    this.expectIdent('with_permit');
    const permit = this.parsePermitKind();
    let on: ResourceSpec[] | undefined;
    if (this.eatIdent('on')) on = this.parseResourceSpecList();
    let lease: Duration | undefined;
    if (this.eatIdent('for')) lease = this.parseDuration();
    const body = this.parseBlock();
    return {
      kind: 'with_permit',
      permit,
      ...(on ? { on } : {}),
      ...(lease ? { lease } : {}),
      body,
      span,
    };
  }

  private parseRequestPermit(span: Span): Statement {
    this.expectIdent('request_permit');
    const permit = this.parsePermitKind();
    let on: ResourceSpec[] | undefined;
    if (this.eatIdent('on')) on = this.parseResourceSpecList();
    let lease: Duration | undefined;
    if (this.eatIdent('for')) lease = this.parseDuration();
    let onDenied: FaultOrId | undefined;
    if (this.eatIdent('on_denied')) onDenied = this.parseFaultOrId();
    return {
      kind: 'request_permit',
      permit,
      ...(on ? { on } : {}),
      ...(lease ? { lease } : {}),
      ...(onDenied ? { onDenied } : {}),
      span,
    };
  }

  private parsePermitKind(): (typeof PERMIT_KINDS)[number] {
    const token = this.identToken();
    if (!PERMIT_KINDS.includes(token.value as never)) {
      this.fail(`unknown permit kind "${token.value}"`, token.span);
    }
    return token.value as (typeof PERMIT_KINDS)[number];
  }

  private parseGuard(span: Span): Statement {
    this.expectIdent('guard');
    const condition = this.parseExpr();
    const freshness = this.parseFreshnessSuffix() ?? trailingFreshness(condition);
    this.expectIdent('every');
    const every = this.parseDuration();
    const body = this.parseBlock();
    let onBreach: FaultOrId | undefined;
    if (this.eatIdent('on_breach')) onBreach = this.parseFaultOrId();
    return {
      kind: 'guard',
      condition,
      ...(freshness ? { freshness } : {}),
      every,
      body,
      ...(onBreach ? { onBreach } : {}),
      span,
    };
  }

  private parseForEach(span: Span): Statement {
    this.expectIdent('for_each');
    const variableToken = this.peek();
    if (variableToken.type !== 'variable') this.fail('for_each expects a $variable');
    const variable = this.advance().value;
    this.expectIdent('in');
    const collection = this.parseExpr();
    this.expectIdent('at_most');
    const boundToken = this.peek();
    if (boundToken.type !== 'number') this.fail('for_each … at_most expects an integer');
    const atMost = this.advance().number ?? 0;
    const body = this.parseBlock();
    let onExhausted: FaultOrId | undefined;
    if (this.eatIdent('on_exhausted')) onExhausted = this.parseFaultOrId();
    return {
      kind: 'for_each',
      variable,
      collection,
      atMost,
      body,
      ...(onExhausted ? { onExhausted } : {}),
      span,
    };
  }

  private parseRepeat(span: Span): Statement {
    this.expectIdent('repeat');
    const token = this.peek();
    if (token.type !== 'number') this.fail('repeat expects an integer count');
    const times = this.advance().number ?? 0;
    this.expectIdent('times');
    const body = this.parseBlock();
    return { kind: 'repeat', times, body, span };
  }

  private parseWhen(span: Span): Statement {
    this.expectIdent('when');
    const condition = this.parseExpr();
    const freshness = this.parseFreshnessSuffix() ?? trailingFreshness(condition);
    const body = this.parseBlock();
    let otherwise: Statement[] | undefined;
    if (this.eatIdent('otherwise')) otherwise = this.parseBlock();
    return {
      kind: 'when',
      condition,
      ...(freshness ? { freshness } : {}),
      body,
      ...(otherwise ? { otherwise } : {}),
      span,
    };
  }

  private parseParallel(span: Span): Statement {
    this.expectIdent('parallel');
    this.expectPunct('{');
    const branches: Branch[] = [];
    while (!this.isPunct('}')) {
      const branchStart = this.peek().span;
      let branchId: string | undefined;
      if (branchStart && this.peek().type === 'ident' && this.isPunct(':', 1)) {
        branchId = this.advance().value;
        this.advance();
      }
      this.expectIdent('branch');
      const resource = this.parseResourceSpec();
      const body = this.parseBlock();
      branches.push({
        ...(branchId ? { id: branchId } : {}),
        resource,
        body,
        span: {
          start: branchStart.start,
          end: body.at(-1)?.span.end ?? branchStart.end,
          line: branchStart.line,
          column: branchStart.column,
        },
      });
    }
    this.expectPunct('}');
    if (branches.length === 0) this.fail('parallel requires at least one branch');

    this.expectIdent('join');
    const join = this.parseJoinPolicy();
    return { kind: 'parallel', branches, join, span };
  }

  private parseJoinPolicy(): JoinPolicy {
    const token = this.identToken();
    if (token.value === 'all') return { kind: 'all' };
    if (token.value === 'first_success') return { kind: 'first_success' };
    if (token.value === 'quorum') {
      this.expectPunct('(');
      const countToken = this.peek();
      if (countToken.type !== 'number') this.fail('quorum expects an integer');
      const count = this.advance().number ?? 0;
      this.expectPunct(')');
      return { kind: 'quorum', count };
    }
    return this.fail(`unknown join policy "${token.value}"`, token.span);
  }

  private parseSequence(span: Span): Statement {
    this.expectIdent('sequence');
    return { kind: 'sequence', body: this.parseBlock(), span };
  }

  private parseBlock(): Statement[] {
    this.expectPunct('{');
    const body = this.parseStatementList();
    this.expectPunct('}');
    return body;
  }

  private parseResourceSpecList(): ResourceSpec[] {
    const specs: ResourceSpec[] = [this.parseResourceSpec()];
    while (this.eatPunct('+')) specs.push(this.parseResourceSpec());
    return specs;
  }

  private parseResourceSpec(): ResourceSpec {
    const token = this.identToken();
    if (!RESOURCE_CLASSES.includes(token.value as never)) {
      this.fail(`unknown resource class "${token.value}"`, token.span);
    }
    const spec: ResourceSpec = { klass: token.value as ResourceClass, span: token.span };
    if (this.eatPunct('[')) {
      if (this.peek().type === 'variable' || this.isPunct('(') || this.peek().type === 'string') {
        spec.instance = this.parseExpr();
      } else if (this.peek().type === 'ident') {
        // `tool[hand_1]` is a literal instance; `tool[$held.id]` is dynamic.
        const instanceToken = this.advance();
        const isStateRoot = (STATE_ROOTS as readonly string[]).includes(instanceToken.value);
        if (isStateRoot || this.isPunct('.') || this.isPunct('[')) {
          this.index -= 1;
          spec.instance = this.parseExpr();
        } else {
          spec.instance = instanceToken.value;
        }
      } else {
        this.fail('resource instance must be a name or an expression');
      }
      this.expectPunct(']');
    }
    return spec;
  }

  private parseRecord(span: Span): Statement {
    this.expectIdent('record');
    const event = this.parseEventNameBare();
    this.expectPunct('{');
    const fields: Argument[] = [];
    while (!this.isPunct('}')) {
      const name = this.identToken().value;
      this.expectPunct('=');
      fields.push({ name, value: this.parseExpr() });
      if (this.isPunct(';')) {
        this.advance();
        if (this.isPunct('}')) break;
        continue;
      }
      if (this.isPunct('}')) break;
      this.fail('record fields are separated by ";"');
    }
    this.expectPunct('}');
    return { kind: 'record', event, fields, span };
  }

  private parseEventNameBare(): string {
    let name = this.identToken().value;
    while (this.isPunct('.') && this.peek(1).type === 'ident') {
      this.advance();
      name += `.${this.advance().value}`;
    }
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(name)) {
      this.fail(`event name "${name}" must be dotted lowercase, e.g. egg.picked`);
    }
    return name;
  }

  private parseSafeStop(span: Span): Statement {
    this.expectIdent('safe_stop');
    const reason = this.parseOptionalReason();
    return { kind: 'safe_stop', ...(reason ? { reason } : {}), span };
  }

  private parseDegrade(span: Span): Statement {
    this.expectIdent('degrade_to');
    const token = this.identToken();
    if (!DEGRADED_MODES.includes(token.value as never)) {
      this.fail(`unknown degraded mode "${token.value}"`, token.span);
    }
    const reason = this.parseOptionalReason();
    return {
      kind: 'degrade_to',
      mode: token.value as DegradedMode,
      ...(reason ? { reason } : {}),
      span,
    };
  }

  private parseOptionalReason(): Expr | undefined {
    if (!this.eatIdent('reason')) return undefined;
    this.expectPunct('=');
    return this.parseExpr();
  }

  private parseNotify(span: Span): Statement {
    this.expectIdent('notify');
    const role = this.identToken().value;
    this.expectIdent('severity');
    const severityToken = this.identToken();
    if (!SEVERITIES.includes(severityToken.value as never)) {
      this.fail(`unknown severity "${severityToken.value}"`, severityToken.span);
    }
    const message = this.peek().type === 'string' ? this.advance().value : undefined;
    return {
      kind: 'notify',
      role,
      severity: severityToken.value as Severity,
      ...(message ? { message } : {}),
      span,
    };
  }

  private parseRunTask(span: Span): Statement {
    this.expectIdent('run_task');
    const name = this.identToken().value;
    this.expectPunct('@');
    const version = this.parseVersionText();
    let args: Argument[] | undefined;
    if (this.eatIdent('with')) args = this.parseArguments();
    this.expectIdent('depth_at_most');
    const depthToken = this.peek();
    if (depthToken.type !== 'number') this.fail('depth_at_most expects an integer');
    const depthAtMost = this.advance().number ?? 0;
    return { kind: 'run_task', name, version, ...(args ? { args } : {}), depthAtMost, span };
  }

  private parseFinish(span: Span): Statement {
    this.expectIdent('finish');
    const statusToken = this.identToken();
    const status = statusToken.value;
    if (status !== 'success' && status !== 'failed' && status !== 'aborted') {
      this.fail(`finish expects success, failed or aborted`, statusToken.span);
    }
    let errorCode: string | undefined;
    if (status === 'failed') {
      errorCode = this.identToken().value;
      if (!/^[A-Z][A-Z0-9_]*$/.test(errorCode)) {
        this.fail(`error code "${errorCode}" must be UPPER_SNAKE`, statusToken.span);
      }
    }
    let message: Expr | undefined;
    if (this.eatIdent('message')) {
      this.expectPunct('=');
      message = this.parseExpr();
    }
    return {
      kind: 'finish',
      status,
      ...(errorCode ? { errorCode } : {}),
      ...(message ? { message } : {}),
      span,
    };
  }

  private parseFaultOrId(): FaultOrId {
    if (this.eatIdent('fault')) return { kind: 'fault' };
    return { kind: 'goto', target: this.identToken().value };
  }

  // -- expressions -----------------------------------------------------------

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isPunct('||')) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right, span: spanFrom(left.span, right.span) };
      void op;
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isPunct('&&')) {
      this.advance();
      const right = this.parseNot();
      left = { kind: 'binary', op: '&&', left, right, span: spanFrom(left.span, right.span) };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isPunct('!')) {
      const op = this.advance();
      const operand = this.parseNot();
      return { kind: 'unary', op: '!', operand, span: spanFrom(op.span, operand.span) };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const token = this.peek();
    if (token.type === 'punct' && ['==', '!=', '<', '<=', '>', '>='].includes(token.value)) {
      this.advance();
      const right = this.parseAdditive();
      return {
        kind: 'binary',
        op: token.value as '==',
        left,
        right,
        span: spanFrom(left.span, right.span),
      };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isPunct('+') || this.isPunct('-')) {
      const op = this.advance().value as '+' | '-';
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right, span: spanFrom(left.span, right.span) };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.isPunct('*') || this.isPunct('/')) {
      const op = this.advance().value as '*' | '/';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right, span: spanFrom(left.span, right.span) };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isPunct('-')) {
      const op = this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: '-', operand, span: spanFrom(op.span, operand.span) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.isPunct('.')) {
        this.advance();
        const name = this.identToken().value;
        if (expr.kind === 'ref') {
          expr = { ...expr, steps: [...expr.steps, { type: 'field', name }] };
          continue;
        }
        this.fail('field access is only valid on a state or variable reference');
      }
      if (this.isPunct('[')) {
        this.advance();
        const index = this.parseExpr();
        const end = this.expectPunct(']');
        if (expr.kind === 'ref') {
          expr = { ...expr, steps: [...expr.steps, { type: 'index', expr: index }] };
          continue;
        }
        expr = {
          kind: 'ref',
          base: { type: 'state', root: 'task' },
          steps: [{ type: 'index', expr: index }],
          span: spanFrom(expr.span, end),
        };
        this.fail('index access is only valid on a state or variable reference');
      }
      // `@ within <duration>` binds to a state reference here; after a compound
      // condition it belongs to the enclosing assertion and is parsed there.
      if (this.isPunct('@') && this.isIdent('within', 1) && expr.kind === 'ref') {
        const freshness = this.parseFreshnessSuffix();
        if (freshness) expr = { ...expr, freshness };
        continue;
      }
      return expr;
    }
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    switch (token.type) {
      case 'quantity':
        this.advance();
        return {
          kind: 'quantity',
          value: { value: token.number ?? 0, unit: token.unit ?? '' },
          span: token.span,
        };
      case 'number':
        this.advance();
        return { kind: 'number', value: token.number ?? 0, span: token.span };
      case 'string':
        this.advance();
        return { kind: 'string', value: token.value, span: token.span };
      case 'enum':
        this.advance();
        return { kind: 'enum', name: token.value, span: token.span };
      case 'version':
        return this.fail(`unexpected version "${token.value}" in an expression`);
      case 'variable':
        this.advance();
        return {
          kind: 'ref',
          base: { type: 'variable', name: token.value },
          steps: [],
          span: token.span,
        };
      case 'punct': {
        if (token.value === '(') {
          this.advance();
          const inner = this.parseExpr();
          this.expectPunct(')');
          return inner;
        }
        if (token.value === '[') {
          this.advance();
          const items: Expr[] = [];
          while (!this.isPunct(']')) {
            items.push(this.parseExpr());
            if (!this.eatPunct(',')) break;
          }
          const end = this.expectPunct(']');
          return { kind: 'list', items, span: spanFrom(token.span, end) };
        }
        if (token.value === '{') {
          this.advance();
          const fields: Array<{ name: string; value: Expr }> = [];
          while (!this.isPunct('}')) {
            const name = this.identToken().value;
            this.expectPunct('=');
            fields.push({ name, value: this.parseExpr() });
            if (!this.eatPunct(',')) break;
          }
          const end = this.expectPunct('}');
          return { kind: 'struct', fields, span: spanFrom(token.span, end) };
        }
        return this.fail(`unexpected "${token.value}" in an expression`);
      }
      case 'ident': {
        if (token.value === 'true' || token.value === 'false') {
          this.advance();
          return { kind: 'boolean', value: token.value === 'true', span: token.span };
        }
        if (token.value === 'null') {
          this.advance();
          return { kind: 'null', span: token.span };
        }
        if ((BUILTINS as readonly string[]).includes(token.value) && this.isPunct('(', 1)) {
          this.advance();
          this.advance();
          const args: Expr[] = [];
          while (!this.isPunct(')')) {
            args.push(this.parseExpr());
            if (!this.eatPunct(',')) break;
          }
          const end = this.expectPunct(')');
          return { kind: 'call', name: token.value, args, span: spanFrom(token.span, end) };
        }
        if ((STATE_ROOTS as readonly string[]).includes(token.value)) {
          this.advance();
          return {
            kind: 'ref',
            base: { type: 'state', root: token.value },
            steps: [],
            span: token.span,
          };
        }
        return this.fail(
          `unexpected identifier "${token.value}": expressions read state roots (${'{'}carrier, cassette, tool, …{'}'}), $variables, literals and built-in calls only`,
        );
      }
      default:
        return this.fail(`unexpected ${describeToken(token)} in an expression`);
    }
  }
}

/**
 * A `<freshness>` written at the very end of a condition bounds every state read
 * in that condition, not just the reference it happens to follow. The parser
 * binds it to the rightmost reference first (grammar line <state-ref>), so lift
 * it back to the assertion when that is where it was written.
 */
function trailingFreshness(expr: Expr): Duration | undefined {
  let current: Expr = expr;
  for (;;) {
    switch (current.kind) {
      case 'ref':
        return current.freshness;
      case 'binary':
        current = current.right;
        break;
      case 'unary':
        current = current.operand;
        break;
      case 'call': {
        const last = current.args.at(-1);
        if (!last) return undefined;
        current = last;
        break;
      }
      default:
        return undefined;
    }
  }
}

function spanFrom(start: Span, end: Span): Span {
  return { start: start.start, end: end.end, line: start.line, column: start.column };
}

function describeToken(token: Token): string {
  switch (token.type) {
    case 'eof':
      return 'end of input';
    case 'string':
      return `string "${token.value}"`;
    case 'quantity':
      return `quantity ${String(token.number)} ${token.unit ?? ''}`;
    case 'number':
      return `number ${String(token.number)}`;
    case 'enum':
      return `enum #${token.value}`;
    case 'variable':
      return `variable $${token.value}`;
    case 'punct':
      return `"${token.value}"`;
    default:
      return `"${token.value}"`;
  }
}

/** Parses `agri.task/v1` source text into an AST. */
export function parseTaskSource(source: string): TaskAst {
  return new TaskParser(source).parse();
}
