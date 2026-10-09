/**
 * Canonical hardware and evidence identifiers.
 *
 * These strings appear in drawings, manifests, recipes, journals and test
 * records. Validating them in one place keeps a typo in a recipe from silently
 * selecting the wrong cassette or evidence class.
 */

export const CARRIER_ID = 'AP-01';

/** ARACNID rover carrier; see docs/10 and drawings AGR-120/130. */
export const ARACNID_CARRIER_ID = 'AR-01';
export const PAYLOAD_INTERFACE_ID = 'UCI-01';

export const CASSETTE_IDS = ['EG-01', 'EG-08', 'FD-01', 'CS-01', 'WD-01'] as const;

export type CassetteId = (typeof CASSETTE_IDS)[number];

/** Cassette type names used by `agri.module/v1` manifests and recipes. */
export const CASSETTE_TYPES = ['egg_collection', 'feed', 'cleaning_sanitation', 'weeding'] as const;

export type CassetteType = (typeof CASSETTE_TYPES)[number];

export const CASSETTE_TYPE_BY_ID: Readonly<Record<CassetteId, CassetteType>> = Object.freeze({
  'EG-01': 'egg_collection',
  'EG-08': 'egg_collection',
  'FD-01': 'feed',
  'CS-01': 'cleaning_sanitation',
  'WD-01': 'weeding',
});

/** Evidence classes used by the verification matrix (see `docs/03`). */
export const EVIDENCE_DOMAINS = [
  'CFG',
  'CS',
  'DSL',
  'EE',
  'EG',
  'EXE',
  'FD',
  'NAV',
  'SAF',
  'SIM',
  'STB',
  'STR',
  'UCI',
  'VL',
  'WD',
] as const;

export type EvidenceDomain = (typeof EVIDENCE_DOMAINS)[number];

const DRAWING_ID = /^AGR-[0-9]{3}_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
const EVIDENCE_ID = /^VVT-[A-Z]{2,4}-[0-9]{3,}$/;
const RECIPE_NAME = /^[a-z0-9][a-z0-9-]{2,62}$/;
const ZONE_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const MODULE_SERIAL = /^(EG|FD|CS|WD)-[0-9]{2}-[0-9]{4}$/;
const GATE_ID = /^G[0-9]{1,2}$/;

export function isDrawingId(value: unknown): value is string {
  return typeof value === 'string' && DRAWING_ID.test(value);
}

export function isEvidenceId(value: unknown): value is string {
  return typeof value === 'string' && EVIDENCE_ID.test(value);
}

export function isRecipeName(value: unknown): value is string {
  return typeof value === 'string' && RECIPE_NAME.test(value);
}

export function isZoneId(value: unknown): value is string {
  return typeof value === 'string' && ZONE_ID.test(value);
}

export function isModuleSerial(value: unknown): value is string {
  if (typeof value !== 'string' || !MODULE_SERIAL.test(value)) {
    return false;
  }
  // The five leading characters are a cassette id; rejecting unknown ids here
  // keeps a typo from selecting a cassette that does not exist (e.g. EG-03).
  return isCassetteId(value.slice(0, 5));
}

export function isGateId(value: unknown): value is string {
  return typeof value === 'string' && GATE_ID.test(value);
}

export function isCassetteId(value: unknown): value is CassetteId {
  return typeof value === 'string' && (CASSETTE_IDS as readonly string[]).includes(value);
}

export function isCassetteType(value: unknown): value is CassetteType {
  return typeof value === 'string' && (CASSETTE_TYPES as readonly string[]).includes(value);
}

export function isEvidenceDomain(value: unknown): value is EvidenceDomain {
  return typeof value === 'string' && (EVIDENCE_DOMAINS as readonly string[]).includes(value);
}

/**
 * Evidence domain for an ID such as `VVT-FD-014`. Returns `undefined` for a
 * well-formed ID whose domain is not in the controlled list.
 */
export function evidenceDomainOf(evidenceId: string): EvidenceDomain | undefined {
  if (!isEvidenceId(evidenceId)) return undefined;
  const domain = evidenceId.slice(4, evidenceId.lastIndexOf('-')) as EvidenceDomain;
  return isEvidenceDomain(domain) ? domain : undefined;
}
