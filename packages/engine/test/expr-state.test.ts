import { describe, expect, it } from 'vitest';

import type { IrExpr } from '@agrirobots/compiler-core';

import {
  convert,
  dimensionOf,
  EvalError,
  evaluate,
  ExpressionEvaluator,
  isQuantity,
  StateResolver,
  toBase,
  type EvalContext,
  type Quantity,
  type StateSnapshot,
} from '../src/index.ts';

const NOW = 1_000_000;

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    tree: {
      tool: {
        hand_3: {
          load_mass: { value: 58, unit: 'g' },
          seal_quality: 'good',
          force_peak: { value: 5.4, unit: 'N' },
        },
        holding_hands: [
          { id: 'hand_3', egg: 'egg-07', transfer_key: 'run:hand_3:egg-07' },
          { id: 'hand_5', egg: 'egg-09', transfer_key: 'run:hand_5:egg-09' },
        ],
      },
      carrier: { tilt: { value: 0.8, unit: 'deg' }, parked: true },
      cassette: { id: 'EG-08', latch: 'LOCKED' },
      zone: { current_id: 'lay-house-3' },
      battery: { charge: { value: 88, unit: '%' } },
    },
    sampledAtMs: {
      tool: NOW - 120,
      carrier: NOW - 40,
      cassette: NOW,
      zone: NOW,
      battery: NOW - 1500,
    },
    nowMs: NOW,
    ...overrides,
  };
}

function context(snapshotOverride: Partial<StateSnapshot> = {}): EvalContext {
  const snap = snapshot(snapshotOverride);
  const variables = new Map<string, unknown>();
  return {
    resolver: new StateResolver(snap),
    variables: variables as Map<string, never>,
    inZone: (value, zone) =>
      String(value ?? '') === zone ||
      String((snap.tree['zone'] as Record<string, unknown>)['current_id']) === zone,
  };
}

function expr(node: IrExpr): IrExpr {
  return node;
}

const ref = (root: string, ...fields: string[]): IrExpr =>
  expr({
    kind: 'ref',
    base: { type: 'state', root },
    steps: fields.map((name) => ({ type: 'field', name })),
  });

const quantity = (value: number, unit: string): IrExpr => expr({ kind: 'quantity', value, unit });
const num = (value: number): IrExpr => expr({ kind: 'number', value });
const str = (value: string): IrExpr => expr({ kind: 'string', value });
const binary = (op: string, left: IrExpr, right: IrExpr): IrExpr =>
  expr({ kind: 'binary', op, left, right });
const call = (name: string, args: IrExpr[]): IrExpr => expr({ kind: 'call', name, args });

describe('state resolver', () => {
  it('reads nested state and reports the age of what it read', () => {
    const resolver = new StateResolver(snapshot());
    const resolved = resolver.resolve(ref('tool', 'hand_3', 'load_mass') as never, {
      read: () => undefined,
      evaluate: () => null,
    });
    expect(resolved.path).toBe('tool.hand_3.load_mass');
    expect(resolved.value).toEqual({ value: 58, unit: 'g' });
    expect(resolved.ageMs).toBe(120);
    expect(resolver.ageOf('carrier.tilt')).toBe(40);
    expect(resolver.qualityOf('battery.charge')).toBe('UNCERTAIN');
    expect(resolver.isFresh('tool.hand_3.load_mass', 200)).toBe(true);
    expect(resolver.isFresh('battery.charge', 200)).toBe(false);
  });

  it('resolves a dynamic index through a variable', () => {
    const ctx = context();
    ctx.variables.set('held', { id: 'hand_5', transfer_key: 'run:hand_5:egg-09' });
    const dynamic: IrExpr = {
      kind: 'ref',
      base: { type: 'state', root: 'tool' },
      steps: [
        {
          type: 'index',
          expr: {
            kind: 'ref',
            base: { type: 'variable', name: 'held' },
            steps: [{ type: 'field', name: 'id' }],
          },
        },
        { type: 'field', name: 'load_mass' },
      ],
    };
    // hand_5 has no load_mass in this snapshot; the read is null, never a throw.
    expect(evaluate(dynamic, ctx)).toBeNull();

    const holding: IrExpr = {
      kind: 'ref',
      base: { type: 'state', root: 'tool' },
      steps: [{ type: 'field', name: 'holding_hands' }],
    };
    expect(evaluate(holding, ctx)).toHaveLength(2);
    expect(call('count_of', [holding])).toBeDefined();
    expect(evaluate(call('count_of', [holding]), ctx)).toBe(2);
  });
});

describe('unit algebra', () => {
  it('converts inside a dimension and refuses across dimensions', () => {
    expect(dimensionOf('kPa')).toBe('pressure');
    expect(convert({ value: 1, unit: 'kg' }, 'g')).toEqual({ value: 1000, unit: 'g' });
    expect(convert({ value: 25, unit: 'kPa' }, 'Pa')).toEqual({ value: 25_000, unit: 'Pa' });
    expect(toBase({ value: 1, unit: 'min' })).toEqual({ dimension: 'time', value: 60_000 });
    expect(() => convert({ value: 1, unit: 'kg' }, 'kPa')).toThrowError(RangeError);
  });

  it('compares quantities across units of one dimension', () => {
    const ctx = context();
    // 0.058 kg == 58 g
    expect(
      evaluate(binary('==', ref('tool', 'hand_3', 'load_mass'), quantity(0.058, 'kg')), ctx),
    ).toBe(true);
    expect(evaluate(binary('>', ref('tool', 'hand_3', 'load_mass'), quantity(40, 'g')), ctx)).toBe(
      true,
    );
    expect(
      evaluate(binary('<=', ref('tool', 'hand_3', 'force_peak'), quantity(12, 'N')), ctx),
    ).toBe(true);
  });

  it('refuses a dimensionally inconsistent comparison instead of coercing', () => {
    const ctx = context();
    expect(() =>
      evaluate(binary('>', ref('tool', 'hand_3', 'load_mass'), quantity(40, 'kPa')), ctx),
    ).toThrowError(EvalError);
    expect(() => evaluate(binary('<', ref('carrier', 'tilt'), num(4)), ctx)).toThrowError(
      EvalError,
    );
  });

  it('keeps units through arithmetic', () => {
    const ctx = context();
    expect(evaluate(binary('+', quantity(40, 'g'), quantity(0.02, 'kg')), ctx)).toEqual({
      value: 60,
      unit: 'g',
    });
    expect(evaluate(binary('*', quantity(6, 'N'), num(2)), ctx)).toEqual({ value: 12, unit: 'N' });
    expect(() => evaluate(binary('/', quantity(6, 'N'), num(0)), ctx)).toThrowError(EvalError);
  });
});

describe('agri.expr/v1 evaluator', () => {
  it('implements the closed built-in library', () => {
    const ctx = context();
    expect(evaluate(call('abs', [num(-3)]), ctx)).toBe(3);
    expect(evaluate(call('min', [num(4), num(2), num(9)]), ctx)).toEqual(2);
    expect(evaluate(call('max', [quantity(4, 'g'), quantity(9, 'g')]), ctx)).toEqual({
      value: 9,
      unit: 'g',
    });
    expect(evaluate(call('clamp', [num(12), num(0), num(6)]), ctx)).toBe(6);
    expect(evaluate(call('unit_of', [quantity(6, 'N')]), ctx)).toBe('N');
    expect(evaluate(call('coalesce', [expr({ kind: 'null' }), str('fallback')]), ctx)).toBe(
      'fallback',
    );
    expect(evaluate(call('len', [str('abc')]), ctx)).toBe(3);
    expect(evaluate(call('age_of', [ref('carrier', 'tilt')]), ctx)).toBe(40);
    expect(evaluate(call('is_fresh', [ref('carrier', 'tilt'), quantity(200, 'ms')]), ctx)).toBe(
      true,
    );
    expect(evaluate(call('is_fresh', [ref('battery', 'charge'), quantity(200, 'ms')]), ctx)).toBe(
      false,
    );
    expect(evaluate(call('quality_of', [ref('battery', 'charge')]), ctx)).toBe('UNCERTAIN');
    expect(
      evaluate(
        call('within_tolerance', [quantity(500, 'g'), quantity(505, 'g'), quantity(10, 'g')]),
        ctx,
      ),
    ).toBe(true);
    expect(evaluate(call('in_zone', [str('lay-house-3'), str('lay-house-3')]), ctx)).toBe(true);
  });

  it('refuses a built-in that is not in the library', () => {
    expect(() => evaluate(call('random', []), context())).toThrowError(
      /closed agri.expr\/v1 library/,
    );
    expect(() => evaluate(call('now', []), context())).toThrowError(EvalError);
  });

  it('concatenates strings for idempotency keys', () => {
    const ctx = context();
    ctx.variables.set('held', { id: 'hand_3', transfer_key: 'run:hand_3:egg-07' });
    const key = binary(
      '+',
      binary('+', ref('task', 'run_id'), str(':')),
      expr({
        kind: 'ref',
        base: { type: 'variable', name: 'held' },
        steps: [{ type: 'field', name: 'id' }],
      }),
    );
    expect(evaluate(key, ctx)).toBe(':hand_3');
    expect(() => evaluate(binary('+', str('mass='), quantity(2, 'kg')), ctx)).toThrowError(
      EvalError,
    );
  });

  it('short-circuits logical operators so a denied branch reads nothing', () => {
    const ctx = context();
    const unreadable: IrExpr = {
      kind: 'ref',
      base: { type: 'state', root: 'perception' },
      steps: [{ type: 'field', name: 'x' }],
    };
    expect(
      evaluate(
        binary('&&', expr({ kind: 'boolean', value: false }), binary('>', unreadable, num(1))),
        ctx,
      ),
    ).toBe(false);
    expect(
      evaluate(
        binary('||', expr({ kind: 'boolean', value: true }), binary('>', unreadable, num(1))),
        ctx,
      ),
    ).toBe(true);
  });

  it('treats a quantity as a value, not as a number', () => {
    expect(isQuantity({ value: 1, unit: 'kg' } satisfies Quantity)).toBe(true);
    expect(isQuantity({ value: 1 })).toBe(false);
    expect(new ExpressionEvaluator(context()).evaluateBoolean(ref('carrier', 'parked'))).toBe(true);
  });
});
