import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_SCHEMAS_DIR,
  DSL_EXAMPLES_DIR,
  MODULE_MANIFEST_SCHEMA_PATH,
  loadRecipeFile,
  repoFile,
  validateAgainstSchema,
  validateRecipeDocument,
} from '../src/index.ts';

function exampleDocuments(): Array<{ name: string; document: unknown }> {
  const dir = repoFile(DSL_EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.yaml'))
    .sort()
    .map((fileName) => ({
      name: fileName,
      document: loadRecipeFile(path.join(dir, fileName)),
    }));
}

describe('agri.script/v1 schema validation', () => {
  it('accepts every shipped example', () => {
    for (const { name, document } of exampleDocuments()) {
      const result = validateRecipeDocument(document);
      expect(result.errors, name).toEqual([]);
      expect(result.valid, name).toBe(true);
    }
  });

  it('rejects a recipe with an unknown operator policy', () => {
    const { document } = exampleDocuments()[0]!;
    const mutated = structuredClone(document) as {
      spec: { requires: { operatorPolicy: string } };
    };
    mutated.spec.requires.operatorPolicy = 'fully_autonomous';

    const result = validateRecipeDocument(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('operatorPolicy');
  });

  it('rejects a recipe that drops its on_fault subtree', () => {
    const { document } = exampleDocuments()[0]!;
    const mutated = structuredClone(document) as { spec: Record<string, unknown> };
    delete mutated.spec['on_fault'];

    const result = validateRecipeDocument(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('on_fault');
  });

  it('rejects extra properties so unreviewed fields cannot ride along', () => {
    const { document } = exampleDocuments()[0]!;
    const mutated = structuredClone(document) as Record<string, unknown>;
    mutated['debugShell'] = 'rm -rf /';

    expect(validateRecipeDocument(mutated).valid).toBe(false);
  });

  it('rejects a wrong apiVersion', () => {
    const { document } = exampleDocuments()[0]!;
    const mutated = structuredClone(document) as Record<string, unknown>;
    mutated['apiVersion'] = 'agri.script/v2';

    expect(validateRecipeDocument(mutated).valid).toBe(false);
  });
});

describe('cross-package schemas', () => {
  it('compiles every published contract schema', () => {
    const dir = repoFile(CONTRACT_SCHEMAS_DIR);
    const schemas = readdirSync(dir).filter((name) => name.endsWith('.schema.json'));
    expect(schemas.length).toBeGreaterThanOrEqual(2);

    for (const schema of schemas) {
      const result = validateAgainstSchema(path.join(CONTRACT_SCHEMAS_DIR, schema), {
        schemaVersion: 'agri.event/v1',
      });
      // The instance is deliberately incomplete: compiling must succeed and the
      // instance must be rejected with reasons rather than crashing.
      expect(result.valid, schema).toBe(false);
      expect(result.errors.length, schema).toBeGreaterThan(0);
    }
  });

  it('validates the reference module manifest against agri.module/v1', () => {
    const manifest = {
      schema: 'agri.module/v1',
      module_id: 'WD-01-0042',
      type: 'weeding',
      firmware: '2.3.1',
      mass_kg: 72.4,
      cg_mm: { x: -35, y: 12, z: 340 },
      power: { nominal_v: 48, continuous_a: 18, peak_a: 35 },
      capabilities: ['inspect_plant.v1', 'mechanical_weed.v1'],
      limits: {
        max_travel_mps: 0.3,
        max_grade_pct: 5,
        tool_zone_class: 'guarded_field',
        requires_operator_present: true,
      },
      calibration_bundle: 'sha256:aaaaaaaaaaaaaaaa',
      signature: 'ed25519:bbbbbbbbbbbbbbbb',
    };

    const result = validateAgainstSchema(MODULE_MANIFEST_SCHEMA_PATH, manifest);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a manifest with an unmeasured mass', () => {
    const result = validateAgainstSchema(MODULE_MANIFEST_SCHEMA_PATH, {
      schema: 'agri.module/v1',
      module_id: 'FD-01-0001',
      type: 'feed',
      firmware: '1.0.0',
      mass_kg: 0,
      cg_mm: { x: 0, y: 0, z: 0 },
      power: { nominal_v: 48, continuous_a: 10, peak_a: 20 },
      capabilities: ['dispense_mass.v1'],
      limits: {
        max_travel_mps: 0.4,
        max_grade_pct: 4,
        tool_zone_class: 'livestock_zone',
        requires_operator_present: true,
      },
      calibration_bundle: 'sha256:aaaaaaaaaaaaaaaa',
      signature: 'ed25519:bbbbbbbbbbbbbbbb',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('mass_kg');
  });
});
