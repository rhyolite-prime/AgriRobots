import type { CompiledTask } from '@agrirobots/compiler-core';

import { renderAssertion } from '../../app/shared/ir-render';
import type { CompiledSummary } from '../../app/shared/lab-types';

/**
 * Reduces a compiled task to what the browser shows: identity, hashes, limits,
 * preflight conditions as written, and the statement index. The full canonical
 * IR stays server-side; its hash is what the UI quotes.
 */
export function toCompiledSummary(compiled: CompiledTask): CompiledSummary {
  const ir = compiled.ir;
  return {
    taskName: ir.task.name,
    taskVersion: ir.task.version,
    irHash: compiled.irHash,
    sourceHash: compiled.sourceHash,
    canonicalBytes: Buffer.byteLength(compiled.canonicalJson, 'utf8'),
    statistics: {
      statementCount: ir.statistics.statementCount,
      actuatingStatements: ir.statistics.actuatingStatements,
      capabilities: [...ir.statistics.capabilities],
      resourceClaims: [...ir.statistics.resourceClaims],
      permitScopes: ir.statistics.permitScopes,
      guards: ir.statistics.guards,
      parallelBranches: ir.statistics.parallelBranches,
      maxParallelWidth: ir.statistics.maxParallelWidth,
      maxLoopBound: ir.statistics.maxLoopBound,
      maxRetryAttempts: ir.statistics.maxRetryAttempts,
      taskDeadlineMs: ir.statistics.taskDeadlineMs,
      subtaskCalls: ir.statistics.subtaskCalls,
    },
    limits: ir.limits.map((limit) => ({ key: limit.key, value: limit.value, unit: limit.unit })),
    preflight: ir.preflight.map((assertion) => renderAssertion(assertion)),
    statements: ir.index.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      parents: [...entry.parents],
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.capability ? { capability: entry.capability } : {}),
      ...(entry.permits ? { permits: [...entry.permits] } : {}),
      ...(entry.resources ? { resources: [...entry.resources] } : {}),
    })),
  };
}
