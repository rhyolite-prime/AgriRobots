import type { IrExpr } from '@agrirobots/compiler-core';

import type { StateResolver } from './state.ts';
import { convert, dimensionOf, isQuantity, toBase, type StateValue } from './state.ts';

/** Values an expression can produce at run time. */
export type RuntimeValue = StateValue;

export interface EvalContext {
  resolver: StateResolver;
  variables: Map<string, RuntimeValue>;
  /** Called for `in_zone`; the world decides what "in" means. */
  inZone(value: RuntimeValue, zone: string): boolean;
}

export class EvalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvalError';
    this.code = code;
  }
}

const TIME_UNITS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };

/**
 * Evaluator for `agri.expr/v1`.
 *
 * The library is closed: an unknown function is a runtime error, never a
 * fallback. Quantities keep their units through arithmetic, and mixing
 * dimensions throws rather than silently coercing, so a unit mistake in a task
 * stops the mission instead of dosing the wrong amount.
 */
export class ExpressionEvaluator {
  private readonly context: EvalContext;

  constructor(context: EvalContext) {
    this.context = context;
  }

  evaluate(expr: IrExpr): RuntimeValue {
    switch (expr.kind) {
      case 'quantity':
        return { value: expr.value, unit: expr.unit };
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'boolean':
        return expr.value;
      case 'null':
        return null;
      case 'enum':
        // An enum is a named symbol; the world stores it as its name.
        return expr.name;
      case 'ref':
        return this.context.resolver.resolve(expr, {
          read: (name) => this.context.variables.get(name),
          evaluate: (inner) => this.evaluate(inner),
        }).value;
      case 'list':
        return expr.items.map((item) => this.evaluate(item));
      case 'struct': {
        const out: Record<string, RuntimeValue> = {};
        for (const field of expr.fields) out[field.name] = this.evaluate(field.value);
        return out;
      }
      case 'unary':
        return expr.op === '!'
          ? !this.truthy(this.evaluate(expr.operand))
          : negate(this.evaluate(expr.operand));
      case 'binary':
        return this.binary(expr.op, expr.left, expr.right);
      case 'call':
        return this.call(expr.name, expr.args);
      default:
        throw new EvalError('E_EXPR_UNKNOWN', `cannot evaluate ${JSON.stringify(expr)}`);
    }
  }

  evaluateBoolean(expr: IrExpr): boolean {
    return this.truthy(this.evaluate(expr));
  }

  evaluateString(expr: IrExpr): string {
    const value = this.evaluate(expr);
    return typeof value === 'string' ? value : formatValue(value);
  }

  /** Dotted path of a reference expression, for freshness and age built-ins. */
  pathOf(expr: IrExpr): string {
    if (expr.kind !== 'ref') {
      throw new EvalError('E_EXPR_NOT_A_REF', 'age_of/quality_of/is_fresh need a state reference');
    }
    return this.context.resolver.resolve(expr, {
      read: (name) => this.context.variables.get(name),
      evaluate: (inner) => this.evaluate(inner),
    }).path;
  }

  private truthy(value: RuntimeValue): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0 && value !== 'false';
    if (isQuantity(value)) return value.value !== 0;
    if (Array.isArray(value)) return value.length > 0;
    return Object.keys(value as object).length > 0;
  }

  private binary(op: string, leftExpr: IrExpr, rightExpr: IrExpr): RuntimeValue {
    // Logical operators short-circuit: a denied branch must not read state it
    // does not need, and must not fail on an unreadable operand.
    if (op === '&&')
      return this.truthy(this.evaluate(leftExpr)) && this.truthy(this.evaluate(rightExpr));
    if (op === '||')
      return this.truthy(this.evaluate(leftExpr)) || this.truthy(this.evaluate(rightExpr));

    const left = this.evaluate(leftExpr);
    const right = this.evaluate(rightExpr);

    switch (op) {
      case '==':
        return equal(left, right);
      case '!=':
        return !equal(left, right);
      case '<':
        return compare(left, right) < 0;
      case '<=':
        return compare(left, right) <= 0;
      case '>':
        return compare(left, right) > 0;
      case '>=':
        return compare(left, right) >= 0;
      case '+':
        return add(left, right);
      case '-':
        return subtract(left, right);
      case '*':
        return multiply(left, right);
      case '/':
        return divide(left, right);
      default:
        throw new EvalError('E_EXPR_OPERATOR', `unknown operator "${op}"`);
    }
  }

  private call(name: string, args: IrExpr[]): RuntimeValue {
    const values = (): RuntimeValue[] => args.map((arg) => this.evaluate(arg));

    switch (name) {
      case 'abs':
        return magnitude(required(values(), 1, name)[0]!);
      case 'min':
      case 'max': {
        const list = required(values(), 1, name);
        let best: RuntimeValue = list[0] ?? null;
        for (const next of list.slice(1)) {
          if (compare(next, best) < 0 === (name === 'min')) best = next;
        }
        return best;
      }
      case 'clamp': {
        const [value, low, high] = required(values(), 3, name);
        if (compare(value!, low!) < 0) return low!;
        if (compare(value!, high!) > 0) return high!;
        return value!;
      }
      case 'len': {
        const [value] = values();
        if (typeof value === 'string') return value.length;
        if (Array.isArray(value)) return value.length;
        if (value && typeof value === 'object' && !isQuantity(value))
          return Object.keys(value).length;
        throw new EvalError('E_EXPR_ARGS', 'len needs a string, list or record');
      }
      case 'count_of': {
        const [value] = values();
        if (Array.isArray(value)) return value.length;
        if (value && typeof value === 'object' && !isQuantity(value))
          return Object.keys(value).length;
        return value === null || value === undefined ? 0 : 1;
      }
      case 'sum': {
        const [value] = required(values(), 1, name);
        const items = (Array.isArray(value) ? value : [value]).filter(
          (item): item is RuntimeValue => item !== undefined,
        );
        if (items.length === 0) return 0;
        return items.slice(1).reduce<RuntimeValue>((total, item) => add(total, item), items[0]!);
      }
      case 'age_of':
        return this.context.resolver.ageOf(this.pathOf(args[0]!));
      case 'quality_of':
        return this.context.resolver.qualityOf(this.pathOf(args[0]!));
      case 'is_fresh': {
        const bound = this.evaluate(args[1]!);
        const ms = isQuantity(bound) ? bound.value * (TIME_UNITS[bound.unit] ?? 0) : number(bound);
        return this.context.resolver.isFresh(this.pathOf(args[0]!), ms);
      }
      case 'confidence_of': {
        const [value] = values();
        if (value && typeof value === 'object' && !isQuantity(value) && !Array.isArray(value)) {
          const confidence = (value as Record<string, RuntimeValue>)['confidence'];
          if (confidence !== undefined) return confidence;
        }
        return value ?? null;
      }
      case 'unit_of': {
        const [value] = values();
        return isQuantity(value) ? value.unit : '';
      }
      case 'coalesce': {
        for (const value of values()) if (value !== null && value !== undefined) return value;
        return null;
      }
      case 'in_zone': {
        const [value, zone] = required(values(), 2, name);
        return this.context.inZone(
          value ?? null,
          typeof zone === 'string' ? zone : formatValue(zone ?? null),
        );
      }
      case 'within_tolerance': {
        const [actual, target, tolerance] = required(values(), 3, name);
        return compare(magnitude(subtract(actual!, target!)), tolerance!) <= 0;
      }
      default:
        throw new EvalError(
          'E_EXPR_UNKNOWN_FUNCTION',
          `built-in "${name}" is not in the closed agri.expr/v1 library`,
        );
    }
  }
}

export function evaluate(expr: IrExpr, context: EvalContext): RuntimeValue {
  return new ExpressionEvaluator(context).evaluate(expr);
}

export function evaluateBoolean(expr: IrExpr, context: EvalContext): boolean {
  return new ExpressionEvaluator(context).evaluateBoolean(expr);
}

/** Argument list with a checked arity, so a missing argument is a loud error. */
function required(values: RuntimeValue[], arity: number, name: string): RuntimeValue[] {
  const filled = values.filter((value) => value !== undefined);
  if (filled.length < arity) {
    throw new EvalError(
      'E_EXPR_ARGS',
      `${name} needs ${String(arity)} argument${arity === 1 ? '' : 's'}, got ${String(filled.length)}`,
    );
  }
  return filled;
}

export function formatValue(value: RuntimeValue): string {
  if (value === null || value === undefined) return '';
  if (isQuantity(value)) return `${String(value.value)} ${value.unit}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function number(value: RuntimeValue): number {
  if (typeof value === 'number') return value;
  if (isQuantity(value)) return value.value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
    return Number(value);
  throw new EvalError('E_EXPR_NOT_NUMERIC', `expected a number, got ${formatValue(value)}`);
}

function magnitude(value: RuntimeValue): RuntimeValue {
  return isQuantity(value)
    ? { value: Math.abs(value.value), unit: value.unit }
    : Math.abs(number(value));
}

function add(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (typeof left === 'string' || typeof right === 'string') {
    if (isQuantity(left) || isQuantity(right)) {
      throw new EvalError('E_EXPR_MIXED_CONCAT', 'cannot concatenate a quantity with a string');
    }
    return `${formatValue(left)}${formatValue(right)}`;
  }
  if (isQuantity(left) && isQuantity(right)) {
    return { value: left.value + convert(right, left.unit).value, unit: left.unit };
  }
  if (isQuantity(left)) {
    return { value: left.value + number(right), unit: left.unit };
  }
  if (isQuantity(right)) {
    return { value: number(left) + right.value, unit: right.unit };
  }
  return number(left) + number(right);
}

function subtract(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (isQuantity(left) && isQuantity(right)) {
    return { value: left.value - convert(right, left.unit).value, unit: left.unit };
  }
  if (isQuantity(left)) return { value: left.value - number(right), unit: left.unit };
  if (isQuantity(right)) return { value: number(left) - right.value, unit: right.unit };
  return number(left) - number(right);
}

function multiply(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  if (isQuantity(left)) return { value: left.value * number(right), unit: left.unit };
  if (isQuantity(right)) return { value: number(left) * right.value, unit: right.unit };
  return number(left) * number(right);
}

function divide(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  const divisor = isQuantity(right) ? right.value : number(right);
  if (divisor === 0) throw new EvalError('E_EXPR_DIVIDE_BY_ZERO', 'division by zero');
  if (isQuantity(left)) return { value: left.value / divisor, unit: left.unit };
  return number(left) / divisor;
}

function negate(value: RuntimeValue): RuntimeValue {
  return isQuantity(value) ? { value: -value.value, unit: value.unit } : -number(value);
}

export function equal(left: RuntimeValue, right: RuntimeValue): boolean {
  if (isQuantity(left) && isQuantity(right)) {
    if (dimensionOf(left.unit) !== dimensionOf(right.unit)) return false;
    return Math.abs(toBase(left).value - toBase(right).value) < 1e-9;
  }
  if (isQuantity(left) || isQuantity(right)) return false;
  if (left === null || right === null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equal(item, right[index]!));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, RuntimeValue>;
    const b = right as Record<string, RuntimeValue>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => equal(a[key]!, b[key]!));
  }
  return left === right;
}

export function compare(left: RuntimeValue, right: RuntimeValue): number {
  if (isQuantity(left) && isQuantity(right)) {
    const a = toBase(left);
    const b = toBase(right);
    if (a.dimension !== b.dimension) {
      throw new EvalError(
        'E_EXPR_DIMENSION',
        `cannot compare ${left.value} ${left.unit} (${a.dimension}) with ${right.value} ${right.unit} (${b.dimension})`,
      );
    }
    return Math.sign(a.value - b.value);
  }
  if (isQuantity(left) || isQuantity(right)) {
    throw new EvalError(
      'E_EXPR_DIMENSION',
      `cannot compare ${formatValue(left)} with ${formatValue(right)}: one carries a unit and the other does not`,
    );
  }
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right);
  return Math.sign(number(left) - number(right));
}
