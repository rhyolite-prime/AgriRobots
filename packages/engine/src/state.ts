import type { SignalQuality } from '@agrirobots/contracts';

import type { IrExpr } from '@agrirobots/compiler-core';

/** A physical number keeps its unit at run time; dimensions are checked, not assumed. */
export interface Quantity {
  value: number;
  unit: string;
}

export type StateValue =
  number | string | boolean | null | Quantity | StateValue[] | { [key: string]: StateValue };

/** The whole readable world at one instant, plus when each part was sampled. */
export interface StateSnapshot {
  tree: { [root: string]: StateValue };
  /** Dotted path -> clock ms when that subtree was last sampled by its source. */
  sampledAtMs: { [path: string]: number };
  /** Dotted path -> signal quality, defaulting to GOOD. */
  quality?: { [path: string]: SignalQuality };
  nowMs: number;
}

export interface ResolvedValue {
  value: StateValue;
  /** Dotted path that was read, e.g. `tool.hand_3.load_mass`. */
  path: string;
  ageMs: number;
  quality: SignalQuality;
  fresh: boolean;
}

export function isQuantity(value: unknown): value is Quantity {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Quantity).value === 'number' &&
    typeof (value as Quantity).unit === 'string'
  );
}

const BASE_UNITS: Record<string, { dimension: string; factor: number }> = {
  km: { dimension: 'length', factor: 1000 },
  m: { dimension: 'length', factor: 1 },
  cm: { dimension: 'length', factor: 0.01 },
  mm: { dimension: 'length', factor: 0.001 },
  t: { dimension: 'mass', factor: 1000 },
  kg: { dimension: 'mass', factor: 1 },
  g: { dimension: 'mass', factor: 0.001 },
  m3: { dimension: 'volume', factor: 1000 },
  L: { dimension: 'volume', factor: 1 },
  mL: { dimension: 'volume', factor: 0.001 },
  h: { dimension: 'time', factor: 3_600_000 },
  min: { dimension: 'time', factor: 60_000 },
  s: { dimension: 'time', factor: 1000 },
  ms: { dimension: 'time', factor: 1 },
  'km/h': { dimension: 'speed', factor: 1 / 3.6 },
  'm/s': { dimension: 'speed', factor: 1 },
  'mm/s': { dimension: 'speed', factor: 0.001 },
  rad: { dimension: 'angle', factor: 180 / Math.PI },
  deg: { dimension: 'angle', factor: 1 },
  'rad/s': { dimension: 'angular_speed', factor: 180 / Math.PI },
  '%': { dimension: 'ratio', factor: 0.01 },
  ratio: { dimension: 'ratio', factor: 1 },
  ppm: { dimension: 'ratio', factor: 1e-6 },
  'g/L': { dimension: 'concentration', factor: 1 },
  'mg/L': { dimension: 'concentration', factor: 0.001 },
  'mol/L': { dimension: 'concentration', factor: 1 },
  V: { dimension: 'voltage', factor: 1 },
  A: { dimension: 'current', factor: 1 },
  W: { dimension: 'power', factor: 1 },
  Wh: { dimension: 'energy', factor: 1 },
  kN: { dimension: 'force', factor: 1000 },
  N: { dimension: 'force', factor: 1 },
  Nm: { dimension: 'torque', factor: 1 },
  kPa: { dimension: 'pressure', factor: 1000 },
  Pa: { dimension: 'pressure', factor: 1 },
  bar: { dimension: 'pressure', factor: 100_000 },
  K: { dimension: 'temperature', factor: 1 },
  degC: { dimension: 'temperature', factor: 1 },
  count: { dimension: 'count', factor: 1 },
  items: { dimension: 'count', factor: 1 },
  eggs: { dimension: 'count', factor: 1 },
  stations: { dimension: 'count', factor: 1 },
  plants: { dimension: 'count', factor: 1 },
  'kg/s': { dimension: 'mass_rate', factor: 1 },
  'g/s': { dimension: 'mass_rate', factor: 0.001 },
  'kg/min': { dimension: 'mass_rate', factor: 1 / 60 },
  'L/s': { dimension: 'volume_rate', factor: 1 },
  'mL/s': { dimension: 'volume_rate', factor: 0.001 },
  'L/min': { dimension: 'volume_rate', factor: 1 / 60 },
  'mL/min': { dimension: 'volume_rate', factor: 0.001 / 60 },
};

export function dimensionOf(unit: string): string | undefined {
  return BASE_UNITS[unit]?.dimension;
}

/** Converts to the dimension's base unit; throws on an unknown unit. */
export function toBase(quantity: Quantity): { dimension: string; value: number } {
  const entry = BASE_UNITS[quantity.unit];
  if (!entry) {
    throw new RangeError(`unknown unit "${quantity.unit}"`);
  }
  if (entry.dimension === 'temperature' && quantity.unit === 'degC') {
    return { dimension: 'temperature', value: quantity.value + 273.15 };
  }
  return { dimension: entry.dimension, value: quantity.value * entry.factor };
}

export function sameDimension(a: Quantity, b: Quantity): boolean {
  return dimensionOf(a.unit) !== undefined && dimensionOf(a.unit) === dimensionOf(b.unit);
}

/** Converts `quantity` into `unit` when the dimensions agree. */
export function convert(quantity: Quantity, unit: string): Quantity {
  if (quantity.unit === unit) return quantity;
  const from = BASE_UNITS[quantity.unit];
  const to = BASE_UNITS[unit];
  if (!from || !to || from.dimension !== to.dimension) {
    throw new RangeError(`cannot express ${quantity.unit} in ${unit}`);
  }
  if (to.dimension === 'temperature') {
    const kelvin = toBase(quantity).value;
    return { value: unit === 'degC' ? kelvin - 273.15 : kelvin, unit };
  }
  return { value: (quantity.value * from.factor) / to.factor, unit };
}

/**
 * Reads a state reference out of a snapshot, resolving dynamic index steps and
 * reporting how old the reading is. Age and quality travel with the value so a
 * stale read can be treated as inhibiting everywhere it is used.
 */
export class StateResolver {
  private readonly snapshot: StateSnapshot;

  constructor(snapshot: StateSnapshot) {
    this.snapshot = snapshot;
  }

  resolve(ref: Extract<IrExpr, { kind: 'ref' }>, variables: VariableReader): ResolvedValue {
    const root = ref.base.type === 'state' ? ref.base.root : `$${ref.base.name}`;
    let current: StateValue =
      ref.base.type === 'state'
        ? (this.snapshot.tree[root] ?? null)
        : (variables.read(ref.base.name) ?? null);

    const path: string[] = ref.base.type === 'state' ? [root] : [`$${ref.base.name}`];

    for (const step of ref.steps) {
      if (step.type === 'field') {
        path.push(step.name);
        current = fieldOf(current, step.name);
        continue;
      }
      const key = variables.evaluate(step.expr);
      const keyText = typeof key === 'string' ? key : String(key);
      path.push(keyText);
      current = fieldOf(current, keyText);
    }

    const dotted = path.join('.');
    const sampledAt = this.sampleTime(dotted);
    const ageMs = Math.max(0, this.snapshot.nowMs - sampledAt);
    return {
      value: current,
      path: dotted,
      ageMs,
      quality: this.qualityOf(dotted),
      fresh: this.ageOf(dotted) <= 0 || this.qualityOf(dotted) !== 'STALE',
    };
  }

  /** Age of a path in ms, using the closest sampled ancestor. */
  ageOf(dottedPath: string): number {
    return Math.max(0, this.snapshot.nowMs - this.sampleTime(dottedPath));
  }

  qualityOf(dottedPath: string): SignalQuality {
    const explicit = this.snapshot.quality?.[dottedPath];
    if (explicit) return explicit;
    const age = this.ageOf(dottedPath);
    if (age > 5000) return 'STALE';
    if (age > 1000) return 'UNCERTAIN';
    return 'GOOD';
  }

  /** True when the newest sample for this path is within `boundMs`. */
  isFresh(dottedPath: string, boundMs: number): boolean {
    return this.ageOf(dottedPath) <= boundMs && this.qualityOf(dottedPath) !== 'BAD';
  }

  private sampleTime(dottedPath: string): number {
    const times = this.snapshot.sampledAtMs;
    let path = dottedPath;
    for (;;) {
      const at = times[path];
      if (at !== undefined) return at;
      const cut = path.lastIndexOf('.');
      if (cut <= 0) return this.snapshot.nowMs;
      path = path.slice(0, cut);
    }
  }
}

function fieldOf(value: StateValue, name: string): StateValue {
  if (Array.isArray(value)) {
    const index = Number(name);
    return Number.isInteger(index) ? (value[index] ?? null) : null;
  }
  if (value && typeof value === 'object' && !isQuantity(value)) {
    return (value as Record<string, StateValue>)[name] ?? null;
  }
  return null;
}

/** How the interpreter exposes script-local variables to the resolver. */
export interface VariableReader {
  read(name: string): StateValue | undefined;
  evaluate(expr: IrExpr): StateValue;
}
