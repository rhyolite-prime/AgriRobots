import type { IrExpr, IrResourceSpec } from '@agrirobots/compiler-core';

import { formatValue, type RuntimeValue } from './expr.ts';

/** Resource classes from the grammar's `<resource-class>` production. */
export const RESOURCE_CLASSES = [
  'sensing',
  'logging',
  'communication',
  'tool',
  'traction',
  'fluid',
] as const;

export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

/**
 * Which resources exist and how they are shared. This is the run-time half of
 * grammar rule S11: the compiler refuses a static double claim, the arbitrator
 * refuses a dynamic one, and a refusal is always inhibiting.
 */
export interface ResourcePolicy {
  /** Exclusive instances: one holder at a time, e.g. `tool.hand_1`. */
  exclusive: string[];
  /** Shared instances: any number of holders, e.g. `sensing.nest_scan`. */
  shared: string[];
}

export interface ResourceLease {
  id: string;
  key: string;
  klass: ResourceClass;
  holder: string;
  exclusive: boolean;
  acquiredAtMs: number;
  expiresAtMs?: number;
}

export type AcquisitionResult =
  | { granted: true; leases: ResourceLease[] }
  | { granted: false; reason: string; key: string; holder?: string };

/** ARACNID resource model (docs/10 §6): hands and magazine exclusive, sensing shared. */
export function aracnidResourcePolicy(handCount = 8): ResourcePolicy {
  const exclusive = ['traction', 'tool.magazine'];
  for (let hand = 1; hand <= handCount; hand += 1) exclusive.push(`tool.hand_${String(hand)}`);
  return {
    exclusive,
    shared: ['sensing.nest_scan', 'sensing.hand_cam', 'logging', 'communication'],
  };
}

/**
 * Resolves `<resource-spec>` claims to keys and arbitrates them.
 *
 * Claims are taken atomically: if one instance in a list is unavailable, none
 * are granted, because a half-taken claim (hand without magazine) is exactly the
 * condition SF-AR-10 exists to prevent.
 */
export class ResourceArbitrator {
  private readonly leases: ResourceLease[] = [];
  private nextId = 0;

  private readonly policy: ResourcePolicy;

  constructor(policy: ResourcePolicy) {
    this.policy = policy;
  }

  /** `tool[hand_1]` -> `tool.hand_1`; `tool[$held.id]` -> `tool.hand_3`. */
  resolve(spec: IrResourceSpec, evaluate: (expr: IrExpr) => RuntimeValue): string {
    if (spec.instance === undefined) return spec.class;
    if (typeof spec.instance === 'string') return `${spec.class}.${spec.instance}`;
    const value = evaluate(spec.instance);
    const text = typeof value === 'string' ? value : formatValue(value);
    if (text === '') {
      // An unresolved dynamic instance is a refusal, not a wildcard claim.
      return `${spec.class}.__unresolved__`;
    }
    return `${spec.class}.${text}`;
  }

  isExclusive(key: string): boolean {
    if (this.policy.exclusive.includes(key)) return true;
    if (this.policy.shared.includes(key)) return false;
    // Unknown resources are treated as exclusive: fail closed.
    return true;
  }

  holderOf(key: string, nowMs: number): ResourceLease | undefined {
    return this.leases.find(
      (lease) => lease.key === key && lease.exclusive && !this.expired(lease, nowMs),
    );
  }

  active(nowMs: number): ResourceLease[] {
    return this.leases.filter((lease) => !this.expired(lease, nowMs));
  }

  acquire(holder: string, keys: string[], nowMs: number, leaseMs?: number): AcquisitionResult {
    const unique = [...new Set(keys)];

    // All-or-nothing: check every key before taking any of them.
    for (const key of unique) {
      if (!this.isExclusive(key)) continue;
      const existing = this.holderOf(key, nowMs);
      if (existing && existing.holder !== holder) {
        return {
          granted: false,
          key,
          holder: existing.holder,
          reason: `"${key}" is held by ${existing.holder}`,
        };
      }
    }

    const granted: ResourceLease[] = [];
    for (const key of unique) {
      const klass = key.split('.')[0] as ResourceClass;
      this.nextId += 1;
      const lease: ResourceLease = {
        id: `lease-${String(this.nextId)}`,
        key,
        klass: RESOURCE_CLASSES.includes(klass) ? klass : 'tool',
        holder,
        exclusive: this.isExclusive(key),
        acquiredAtMs: nowMs,
        ...(leaseMs ? { expiresAtMs: nowMs + leaseMs } : {}),
      };
      this.leases.push(lease);
      granted.push(lease);
    }
    return { granted: true, leases: granted };
  }

  release(leaseIds: string[]): ResourceLease[] {
    const released: ResourceLease[] = [];
    for (const id of leaseIds) {
      const index = this.leases.findIndex((lease) => lease.id === id);
      if (index >= 0) released.push(...this.leases.splice(index, 1));
    }
    return released;
  }

  releaseByHolder(holder: string): ResourceLease[] {
    const released: ResourceLease[] = [];
    for (let index = this.leases.length - 1; index >= 0; index -= 1) {
      const lease = this.leases[index]!;
      if (lease.holder === holder) {
        this.leases.splice(index, 1);
        released.push(lease);
      }
    }
    return released;
  }

  /** Drops expired leases; returns them so the caller can journal the expiry. */
  expire(nowMs: number): ResourceLease[] {
    const expired = this.leases.filter((lease) => this.expired(lease, nowMs));
    for (const lease of expired) {
      const index = this.leases.indexOf(lease);
      if (index >= 0) this.leases.splice(index, 1);
    }
    return expired;
  }

  private expired(lease: ResourceLease, nowMs: number): boolean {
    return lease.expiresAtMs !== undefined && lease.expiresAtMs <= nowMs;
  }
}
