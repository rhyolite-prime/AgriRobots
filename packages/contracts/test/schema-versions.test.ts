import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSIONS, SCHEMA_VERSION_VALUES, isSchemaVersion } from '../src/index.ts';

describe('schema versions', () => {
  it('pins the contract identifiers other packages depend on', () => {
    expect(SCHEMA_VERSIONS.agriScript).toBe('agri.script/v1');
    expect(SCHEMA_VERSIONS.moduleManifest).toBe('agri.module/v1');
    expect(SCHEMA_VERSIONS.artifact).toBe('agri.artifact/v1');
    expect(SCHEMA_VERSIONS.event).toBe('agri.event/v1');
  });

  it('has no duplicate version strings', () => {
    expect(new Set(SCHEMA_VERSION_VALUES).size).toBe(SCHEMA_VERSION_VALUES.length);
  });

  it('recognises only known versions', () => {
    expect(isSchemaVersion('agri.script/v1')).toBe(true);
    expect(isSchemaVersion('agri.script/v2')).toBe(false);
    expect(isSchemaVersion(undefined)).toBe(false);
  });
});
