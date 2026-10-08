/**
 * Canonical schema identifiers for the AMARS platform.
 *
 * Every artifact that crosses a process, machine or organisational boundary
 * (Virtual Lab -> simulator -> compiler -> edge runtime -> fleet service)
 * carries one of these identifiers so a consumer can refuse an unknown or
 * stale contract instead of guessing at its meaning.
 *
 * Adding a value here is a configuration-control event: it must be reviewed,
 * versioned and linked to a `VVT-*` evidence record.
 */
export const SCHEMA_VERSIONS = {
  /** AgriScript task recipe (see `dsl/schema/agri.script.v1.schema.json`). */
  agriScript: 'agri.script/v1',
  /** Signed cassette/carrier capability manifest (see `docs/02` section 4). */
  moduleManifest: 'agri.module/v1',
  /** Digital-twin specification exported by the Virtual Lab. */
  twinSpec: 'agri.twin-spec/v1',
  /** Signed deployment envelope wrapping a recipe, model or configuration. */
  artifact: 'agri.artifact/v1',
  /** Append-only execution/safety journal event. */
  event: 'agri.event/v1',
  /** Capability allow-list used by the policy service. */
  capabilityAllowList: 'agri.policy.capability-allow-list/v1',
} as const;

export type SchemaName = keyof typeof SCHEMA_VERSIONS;

export type SchemaVersion = (typeof SCHEMA_VERSIONS)[SchemaName];

export const SCHEMA_VERSION_VALUES: readonly string[] = Object.freeze(
  Object.values(SCHEMA_VERSIONS).map((value) => String(value)),
);

export function isSchemaVersion(value: unknown): value is SchemaVersion {
  return typeof value === 'string' && SCHEMA_VERSION_VALUES.includes(value);
}
