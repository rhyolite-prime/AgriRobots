import { readFileSync } from 'node:fs';

import { SCHEMA_VERSIONS } from '@agrirobots/contracts';
import { isCassetteType, isGateId, type CassetteType } from '@agrirobots/domain-model';
import { AgriScriptError, parseRecipeYaml, repoFile } from '@agrirobots/compiler-core';

import { POLICY_ERROR_CODES, PolicyError } from './errors.ts';

export const CAPABILITY_ALLOW_LIST_PATH = 'packages/policy/data/capability-allow-list.yaml';

/**
 * Consequence class of a capability. It drives how much independent evidence is
 * needed before the capability may be armed on a real machine.
 */
export const HAZARD_CLASSES = [
  'sensing_only',
  'benign_task',
  'conditional_task',
  'actuation_gated',
] as const;

export type HazardClass = (typeof HAZARD_CLASSES)[number];

export const ALLOW_LIST_STATUSES = ['draft', 'reviewed', 'released', 'suspended'] as const;

export type AllowListStatus = (typeof ALLOW_LIST_STATUSES)[number];

export interface CapabilityEntry {
  /** Capability identifier, e.g. `dispense_mass.v1`. */
  id: string;
  cassetteType: CassetteType;
  hazardClass: HazardClass;
  /** Earliest programme gate at which the capability may be enabled. */
  minimumGate: string;
  /** True when a named process/legal owner must approve before use. */
  processApprovalRequired: boolean;
  description: string;
}

export interface CapabilityAllowList {
  schemaVersion: string;
  revision: string;
  status: AllowListStatus;
  capabilities: CapabilityEntry[];
}

export interface PolicyCheckResult {
  allowed: boolean;
  reasons: string[];
}

/** Inputs describing where the programme currently stands. */
export interface ReleaseContext {
  /** Gate the release is being prepared for, e.g. `G5`. */
  currentGate: string;
  /** True when a named process/legal owner has approved this capability. */
  processApprovalGranted: boolean;
  /** True for bench, simulation and replay use; false for a physical machine. */
  benchOrSimulationOnly?: boolean;
}

const CAPABILITY_ID = /^[a-z][a-z0-9_]*\.v[0-9]+$/;

function deny(reasons: string[]): PolicyCheckResult {
  return { allowed: false, reasons };
}

function allow(): PolicyCheckResult {
  return { allowed: true, reasons: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses allow-list text with the strict loader (duplicate keys rejected). */
export function parseCapabilityAllowList(text: string): CapabilityAllowList {
  let document: unknown;
  try {
    document = parseRecipeYaml(text);
  } catch (cause) {
    const reasons = cause instanceof AgriScriptError ? [...cause.details] : [String(cause)];
    throw new PolicyError(
      POLICY_ERROR_CODES.allowListInvalid,
      `capability allow-list rejected: ${reasons[0] ?? 'unparseable YAML'}`,
      reasons,
    );
  }

  const reasons: string[] = [];

  if (!isRecord(document)) {
    throw new PolicyError(
      POLICY_ERROR_CODES.allowListInvalid,
      'capability allow-list must be a mapping',
    );
  }

  if (document['schemaVersion'] !== SCHEMA_VERSIONS.capabilityAllowList) {
    reasons.push(
      `schemaVersion: expected "${SCHEMA_VERSIONS.capabilityAllowList}", got "${String(document['schemaVersion'])}"`,
    );
  }
  if (typeof document['revision'] !== 'string' || document['revision'].length === 0) {
    reasons.push('revision: expected a non-empty string');
  }

  const status = document['status'];
  if (typeof status !== 'string' || !(ALLOW_LIST_STATUSES as readonly string[]).includes(status)) {
    reasons.push(`status: expected one of ${ALLOW_LIST_STATUSES.join(', ')}`);
  }

  const rawCapabilities = document['capabilities'];
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0) {
    reasons.push('capabilities: expected a non-empty list');
  }

  const capabilities: CapabilityEntry[] = [];
  const seen = new Set<string>();

  if (Array.isArray(rawCapabilities)) {
    rawCapabilities.forEach((raw, index) => {
      const at = `capabilities[${index}]`;
      const entryReasons: string[] = [];

      if (!isRecord(raw)) {
        reasons.push(`${at}: expected a mapping`);
        return;
      }

      const id = raw['id'];
      if (typeof id !== 'string' || !CAPABILITY_ID.test(id)) {
        entryReasons.push(`${at}.id: expected "<name>.v<n>"`);
      } else if (seen.has(id)) {
        entryReasons.push(`${at}.id: duplicate capability "${id}"`);
      }

      if (!isCassetteType(raw['cassetteType'])) {
        entryReasons.push(
          `${at}.cassetteType: unknown cassette type "${String(raw['cassetteType'])}"`,
        );
      }

      const hazardClass = raw['hazardClass'];
      if (
        typeof hazardClass !== 'string' ||
        !(HAZARD_CLASSES as readonly string[]).includes(hazardClass)
      ) {
        entryReasons.push(`${at}.hazardClass: expected one of ${HAZARD_CLASSES.join(', ')}`);
      }

      if (!isGateId(raw['minimumGate'])) {
        entryReasons.push(`${at}.minimumGate: expected "G<n>"`);
      }

      if (typeof raw['processApprovalRequired'] !== 'boolean') {
        entryReasons.push(`${at}.processApprovalRequired: expected a boolean`);
      }

      if (typeof raw['description'] !== 'string' || raw['description'].trim().length === 0) {
        entryReasons.push(`${at}.description: expected a non-empty description`);
      }

      if (entryReasons.length > 0) {
        reasons.push(...entryReasons);
        return;
      }

      if (typeof id === 'string') {
        seen.add(id);
      }

      capabilities.push({
        id: id as string,
        cassetteType: raw['cassetteType'] as CassetteType,
        hazardClass: hazardClass as HazardClass,
        minimumGate: raw['minimumGate'] as string,
        processApprovalRequired: raw['processApprovalRequired'] as boolean,
        description: raw['description'] as string,
      });
    });
  }

  if (reasons.length > 0) {
    throw new PolicyError(
      POLICY_ERROR_CODES.allowListInvalid,
      `capability allow-list rejected: ${reasons[0]}`,
      reasons,
    );
  }

  return {
    schemaVersion: String(document['schemaVersion']),
    revision: String(document['revision']),
    status: status as AllowListStatus,
    capabilities,
  };
}

/** Loads the repository allow-list. Fail-closed when it cannot be read. */
export function loadCapabilityAllowList(): CapabilityAllowList {
  let text: string;
  try {
    text = readFileSync(repoFile(CAPABILITY_ALLOW_LIST_PATH), 'utf8');
  } catch (cause) {
    throw new PolicyError(
      POLICY_ERROR_CODES.allowListUnreadable,
      `could not read capability allow-list at ${CAPABILITY_ALLOW_LIST_PATH}`,
      [String(cause)],
    );
  }
  return parseCapabilityAllowList(text);
}

export function findCapability(
  list: CapabilityAllowList,
  capabilityId: unknown,
): CapabilityEntry | undefined {
  if (typeof capabilityId !== 'string') return undefined;
  return list.capabilities.find((entry) => entry.id === capabilityId);
}

export function isCapabilityAllowed(list: CapabilityAllowList, capabilityId: unknown): boolean {
  return findCapability(list, capabilityId) !== undefined;
}

/** Numeric gate value, e.g. `G7` -> 7. Returns `undefined` for invalid input. */
export function gateNumber(gate: unknown): number | undefined {
  return isGateId(gate) ? Number((gate as string).slice(1)) : undefined;
}

/** True when `currentGate` has reached the capability's minimum gate. */
export function capabilityAvailableAtGate(entry: CapabilityEntry, currentGate: unknown): boolean {
  const required = gateNumber(entry.minimumGate);
  const current = gateNumber(currentGate);
  if (required === undefined || current === undefined) return false;
  return current >= required;
}

/**
 * Checks the `spec.requires.cassette` block of a recipe against the allow-list.
 * Fail-closed: an unknown capability, a cassette-type mismatch or malformed
 * input is refused with explicit reasons.
 */
export function checkRecipeRequires(
  list: CapabilityAllowList,
  requires: unknown,
): PolicyCheckResult {
  if (!isRecord(requires)) {
    return deny(['spec.requires: expected a mapping']);
  }

  const cassette = requires['cassette'];
  if (!isRecord(cassette)) {
    return deny(['spec.requires.cassette: expected a mapping with type and capability']);
  }

  const reasons: string[] = [];
  const capabilityId = cassette['capability'];
  const cassetteType = cassette['type'];

  if (!isCassetteType(cassetteType)) {
    reasons.push(`spec.requires.cassette.type: unknown cassette type "${String(cassetteType)}"`);
  }

  const entry = findCapability(list, capabilityId);
  if (!entry) {
    reasons.push(
      `spec.requires.cassette.capability: "${String(capabilityId)}" is not in the allow-list (revision ${list.revision})`,
    );
    return deny(reasons);
  }

  if (isCassetteType(cassetteType) && entry.cassetteType !== cassetteType) {
    reasons.push(
      `spec.requires.cassette: capability "${entry.id}" belongs to a "${entry.cassetteType}" cassette, not "${cassetteType}"`,
    );
  }

  return reasons.length > 0 ? deny(reasons) : allow();
}

/**
 * Checks whether a capability may be enabled for the intended use right now:
 * programme gate reached, process approval granted where required, and the
 * allow-list itself released for physical use.
 *
 * Bench, simulation and replay work is permitted against a draft allow-list so
 * that software development is not blocked by hardware release status.
 */
export function checkReleaseReadiness(
  list: CapabilityAllowList,
  entry: CapabilityEntry,
  context: ReleaseContext,
): PolicyCheckResult {
  const reasons: string[] = [];
  const benchOnly = context.benchOrSimulationOnly === true;

  if (!benchOnly && list.status !== 'released') {
    reasons.push(
      `allow-list revision ${list.revision} is "${list.status}"; a physical release requires status "released"`,
    );
  }

  if (!capabilityAvailableAtGate(entry, context.currentGate)) {
    reasons.push(
      `capability "${entry.id}" requires gate ${entry.minimumGate}; current gate is ${String(context.currentGate)}`,
    );
  }

  if (entry.processApprovalRequired && !context.processApprovalGranted) {
    reasons.push(`capability "${entry.id}" requires named process/legal owner approval before use`);
  }

  if (entry.hazardClass === 'actuation_gated' && !benchOnly && !context.processApprovalGranted) {
    reasons.push(
      `capability "${entry.id}" is actuation-gated and must stay in shadow or sensing mode until its guarded evidence passes`,
    );
  }

  return reasons.length > 0 ? deny(reasons) : allow();
}

/**
 * Checks every capability claimed by a signed module manifest. A manifest claim
 * is an engineering assertion; this confirms the claim is a known, approved
 * capability for that cassette type.
 */
export function checkManifestCapabilities(
  list: CapabilityAllowList,
  manifest: { type: string; capabilities: string[] },
): PolicyCheckResult {
  const reasons: string[] = [];

  for (const capabilityId of manifest.capabilities) {
    const entry = findCapability(list, capabilityId);
    if (!entry) {
      reasons.push(`manifest capability "${capabilityId}" is not in the allow-list`);
      continue;
    }
    if (entry.cassetteType !== manifest.type) {
      reasons.push(
        `manifest capability "${capabilityId}" is approved for "${entry.cassetteType}", not "${manifest.type}"`,
      );
    }
  }

  return reasons.length > 0 ? deny(reasons) : allow();
}
