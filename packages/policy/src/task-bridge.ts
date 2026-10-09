import { readFileSync } from 'node:fs';

import { CASSETTE_IDS } from '@agrirobots/domain-model';
import {
  compileTaskSource,
  type CapabilityDescriptor,
  type CompiledTask,
  type TaskPolicyLimits,
  type TaskValidationContext,
} from '@agrirobots/compiler-core';

import {
  capabilityAvailableAtGate,
  loadCapabilityAllowList,
  type CapabilityAllowList,
  type CapabilityEntry,
} from './allow-list.ts';
import { POLICY_ERROR_CODES, PolicyError } from './errors.ts';

/** Cassette manifest fields the task validator needs. */
export interface ManifestSummary {
  capabilities: readonly string[];
  motionDuringToolUse?: boolean;
}

/**
 * The installed allow-list expressed in the compiler's terms.
 *
 * The compiler never reads the YAML file itself: the registry is injected, so a
 * bench, a simulator and a machine can each compile against the allow-list that
 * is actually installed on them (grammar rule S1).
 */
export function capabilityDescriptors(
  allowList: CapabilityAllowList = loadCapabilityAllowList(),
): CapabilityDescriptor[] {
  return allowList.capabilities.map((entry: CapabilityEntry) => ({
    id: entry.id,
    type: entry.cassetteType,
    hazardClass: entry.hazardClass,
    gate: entry.minimumGate,
    requiresProcessApproval: entry.processApprovalRequired,
  }));
}

export interface TaskContextOptions {
  allowList?: CapabilityAllowList;
  manifest?: ManifestSummary;
  knownTasks?: readonly string[];
  limits?: Partial<TaskPolicyLimits>;
}

/** Builds a validation context from the installed policy data. */
export function taskValidationContext(options: TaskContextOptions = {}): TaskValidationContext {
  const allowList = options.allowList ?? loadCapabilityAllowList();
  return {
    capabilities: capabilityDescriptors(allowList),
    knownCassettes: [...CASSETTE_IDS],
    ...(options.manifest ? { manifestCapabilities: options.manifest.capabilities } : {}),
    ...(options.manifest?.motionDuringToolUse !== undefined
      ? { motionDuringToolUse: options.manifest.motionDuringToolUse }
      : {}),
    ...(options.knownTasks ? { knownTasks: options.knownTasks } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  };
}

/** Compiles `agri.task/v1` source against the installed allow-list. */
export function compileAgriTaskSource(
  source: string,
  options: TaskContextOptions & { throwOnError?: boolean } = {},
): CompiledTask {
  const { throwOnError, ...contextOptions } = options;
  return compileTaskSource(source, taskValidationContext(contextOptions), {
    throwOnError: throwOnError ?? true,
    ...(options.limits ? { limits: options.limits } : {}),
  });
}

/** Compiles a `.agri` file from disk. */
export function compileAgriTaskFile(
  path: string,
  options: TaskContextOptions & { throwOnError?: boolean } = {},
): CompiledTask {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new PolicyError(
      POLICY_ERROR_CODES.taskSourceUnreadable,
      `cannot read task source ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return compileAgriTaskSource(source, options);
}

/**
 * Gate readiness for a compiled task: every capability it uses must be
 * available at the programme gate the release targets, and any capability that
 * needs a process owner must have one named.
 */
export function checkTaskGateReadiness(
  compiled: CompiledTask,
  release: {
    currentGate: string;
    processApprovalGranted: boolean;
    benchOrSimulationOnly?: boolean;
  },
  allowList: CapabilityAllowList = loadCapabilityAllowList(),
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const used = compiled.ir.statistics.capabilities;

  for (const id of used) {
    const entry = allowList.capabilities.find((capability) => capability.id === id);
    if (!entry) {
      reasons.push(`${id}: not in the installed allow-list`);
      continue;
    }
    if (!capabilityAvailableAtGate(entry, release.currentGate)) {
      reasons.push(
        `${id}: needs gate ${entry.minimumGate}, release targets ${release.currentGate}`,
      );
    }
    if (entry.processApprovalRequired && !release.processApprovalGranted) {
      reasons.push(`${id}: process approval is required and not recorded`);
    }
  }

  if (!compiled.ast.requires.processApproval && used.length > 0) {
    const needsApproval = used.some(
      (id) =>
        allowList.capabilities.find((capability) => capability.id === id)?.processApprovalRequired,
    );
    if (needsApproval) {
      reasons.push('the task does not name a process_approval reference in requires');
    }
  }

  return { ready: reasons.length === 0, reasons };
}
