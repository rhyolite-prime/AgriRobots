import { SCHEMA_VERSIONS } from '@agrirobots/contracts';

import { isCassetteType, isModuleSerial } from './identifiers.ts';

/**
 * Structural validation for the signed `agri.module/v1` cassette manifest
 * defined in `docs/02_CONTROLS_SOFTWARE_AND_DSL.md` section 4.
 *
 * A manifest is an engineering assertion issued after physical inspection,
 * mass/CG measurement, electrical test, firmware review and configuration
 * approval. This validator rejects malformed or incomplete manifests; it does
 * **not** make a manifest trustworthy and it never enables a tool by itself.
 */

export const MODULE_MANIFEST_SCHEMA = SCHEMA_VERSIONS.moduleManifest;

export const TOOL_ZONE_CLASSES = [
  'benign_indoor',
  'service_bay',
  'livestock_zone',
  'guarded_field',
  'open_field',
] as const;

export type ToolZoneClass = (typeof TOOL_ZONE_CLASSES)[number];

export interface ManifestPower {
  nominal_v: number;
  continuous_a: number;
  peak_a: number;
}

export interface ManifestCentreOfGravity {
  x: number;
  y: number;
  z: number;
}

export interface ManifestLimits {
  max_travel_mps: number;
  max_grade_pct: number;
  tool_zone_class: ToolZoneClass;
  requires_operator_present: boolean;
}

export interface ModuleManifest {
  schema: typeof MODULE_MANIFEST_SCHEMA;
  module_id: string;
  type: string;
  firmware: string;
  mass_kg: number;
  cg_mm: ManifestCentreOfGravity;
  power: ManifestPower;
  capabilities: string[];
  limits: ManifestLimits;
  calibration_bundle: string;
  signature: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: ModuleManifest;
}

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const HASH_REF = /^(sha256|ed25519):[A-Za-z0-9+/=_-]{8,}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an untrusted manifest payload without throwing. */
export function validateModuleManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ['manifest: expected an object'] };
  }

  if (input['schema'] !== MODULE_MANIFEST_SCHEMA) {
    errors.push(`schema: expected "${MODULE_MANIFEST_SCHEMA}"`);
  }
  if (!isModuleSerial(input['module_id'])) {
    errors.push('module_id: expected "<EG|FD|CS|WD>-01-<4 digits>"');
  }
  if (!isCassetteType(input['type'])) {
    errors.push('type: expected one of egg_collection, feed, cleaning_sanitation, weeding');
  }
  if (typeof input['firmware'] !== 'string' || !SEMVER.test(input['firmware'])) {
    errors.push('firmware: expected semantic version "x.y.z"');
  }
  if (!isFiniteNumber(input['mass_kg']) || input['mass_kg'] <= 0) {
    errors.push('mass_kg: expected a positive finite measured mass');
  }

  const serial = typeof input['module_id'] === 'string' ? input['module_id'] : '';
  const type = typeof input['type'] === 'string' ? input['type'] : '';
  if (serial.length > 0 && type.length > 0 && !serial.startsWith(typePrefixOf(type))) {
    errors.push(`module_id: prefix does not match cassette type "${type}"`);
  }

  const cg = input['cg_mm'];
  if (!isRecord(cg)) {
    errors.push('cg_mm: expected an object with measured x, y and z offsets in millimetres');
  } else {
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!isFiniteNumber(cg[axis])) {
        errors.push(`cg_mm.${axis}: expected a finite measured offset in millimetres`);
      }
    }
  }

  const power = input['power'];
  if (!isRecord(power)) {
    errors.push('power: expected an object with nominal_v, continuous_a and peak_a');
  } else {
    for (const field of ['nominal_v', 'continuous_a', 'peak_a'] as const) {
      if (!isFiniteNumber(power[field]) || power[field] <= 0) {
        errors.push(`power.${field}: expected a positive finite value`);
      }
    }
    if (
      isFiniteNumber(power['continuous_a']) &&
      isFiniteNumber(power['peak_a']) &&
      power['peak_a'] < power['continuous_a']
    ) {
      errors.push('power.peak_a: must not be lower than continuous_a');
    }
  }

  const capabilities = input['capabilities'];
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push('capabilities: expected a non-empty array of capability identifiers');
  } else if (!capabilities.every((capability) => typeof capability === 'string')) {
    errors.push('capabilities: every entry must be a string');
  }

  const limits = input['limits'];
  if (!isRecord(limits)) {
    errors.push('limits: expected an object');
  } else {
    if (!isFiniteNumber(limits['max_travel_mps']) || limits['max_travel_mps'] <= 0) {
      errors.push('limits.max_travel_mps: expected a positive finite speed limit');
    }
    if (!isFiniteNumber(limits['max_grade_pct'])) {
      errors.push('limits.max_grade_pct: expected a finite grade limit');
    }
    if (
      typeof limits['tool_zone_class'] !== 'string' ||
      !(TOOL_ZONE_CLASSES as readonly string[]).includes(limits['tool_zone_class'])
    ) {
      errors.push(`limits.tool_zone_class: expected one of ${TOOL_ZONE_CLASSES.join(', ')}`);
    }
    if (typeof limits['requires_operator_present'] !== 'boolean') {
      errors.push('limits.requires_operator_present: expected a boolean');
    }
  }

  for (const field of ['calibration_bundle', 'signature'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || !HASH_REF.test(value)) {
      errors.push(`${field}: expected "<algorithm>:<digest>" reference`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], manifest: input as unknown as ModuleManifest };
}

function typePrefixOf(type: string): string {
  switch (type) {
    case 'egg_collection':
      return 'EG-01';
    case 'feed':
      return 'FD-01';
    case 'cleaning_sanitation':
      return 'CS-01';
    case 'weeding':
      return 'WD-01';
    default:
      return '';
  }
}

export function isToolZoneClass(value: unknown): value is ToolZoneClass {
  return typeof value === 'string' && (TOOL_ZONE_CLASSES as readonly string[]).includes(value);
}

/**
 * True when the manifest authorises the requested tool zone class. Zone classes
 * are a controlled vocabulary; site zone identifiers such as
 * `house-3-feed-lane` are validated separately and are not interchangeable.
 */
export function manifestAllowsZoneClass(manifest: ModuleManifest, zoneClass: unknown): boolean {
  return isToolZoneClass(zoneClass) && manifest.limits.tool_zone_class === zoneClass;
}
