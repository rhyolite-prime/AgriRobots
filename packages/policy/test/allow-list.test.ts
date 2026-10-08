import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS } from '@agrirobots/contracts';
import { DSL_EXAMPLES_DIR, parseRecipeYaml, repoFile } from '@agrirobots/compiler-core';

import {
  CAPABILITY_ALLOW_LIST_PATH,
  HAZARD_CLASSES,
  PolicyError,
  capabilityAvailableAtGate,
  checkManifestCapabilities,
  checkRecipeRequires,
  checkReleaseReadiness,
  findCapability,
  gateNumber,
  isCapabilityAllowed,
  loadCapabilityAllowList,
  parseCapabilityAllowList,
} from '../src/index.ts';

interface RecipeRequires {
  spec: { requires: { cassette: { type: string; capability: string } } };
}

function exampleRequires(): Array<{ name: string; requires: RecipeRequires['spec']['requires'] }> {
  const dir = repoFile(DSL_EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const document = parseRecipeYaml(
        readFileSync(path.join(dir, name), 'utf8'),
      ) as RecipeRequires;
      return { name, requires: document.spec.requires };
    });
}

describe('capability allow-list data', () => {
  const list = loadCapabilityAllowList();

  it('declares the controlled schema version', () => {
    expect(list.schemaVersion).toBe(SCHEMA_VERSIONS.capabilityAllowList);
    expect(list.revision).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it('lists one entry per approved capability with complete metadata', () => {
    expect(list.capabilities.length).toBeGreaterThan(0);
    for (const entry of list.capabilities) {
      expect(HAZARD_CLASSES).toContain(entry.hazardClass);
      expect(gateNumber(entry.minimumGate)).toBeGreaterThan(0);
      expect(typeof entry.processApprovalRequired).toBe('boolean');
      expect(entry.description.length).toBeGreaterThan(20);
    }
  });

  it('contains no egg shell treatment, chemical or herbicide capability', () => {
    const forbidden = /treat|sanitis|sanitiz|wash|coat|herbicide|pesticide|chemical|spray/i;
    for (const entry of list.capabilities) {
      expect(entry.id, entry.id).not.toMatch(forbidden);
    }
  });

  it('keeps mechanical weeding actuation-gated at G7 with process approval', () => {
    const weeding = findCapability(list, 'mechanical_weed.v1');
    expect(weeding).toBeDefined();
    expect(weeding?.hazardClass).toBe('actuation_gated');
    expect(weeding?.minimumGate).toBe('G7');
    expect(weeding?.processApprovalRequired).toBe(true);
  });

  it('keeps plant inspection sensing-only', () => {
    expect(findCapability(list, 'inspect_plant.v1')?.hazardClass).toBe('sensing_only');
  });
});

describe('allow-list parsing is fail-closed', () => {
  const source = readFileSync(repoFile(CAPABILITY_ALLOW_LIST_PATH), 'utf8');

  it('rejects duplicate capability entries', () => {
    const duplicated = `${source}\n  - id: dispense_mass.v1\n    cassetteType: feed\n    hazardClass: conditional_task\n    minimumGate: G5\n    processApprovalRequired: false\n    description: duplicate entry used to prove rejection behaviour in tests.\n`;
    expect(() => parseCapabilityAllowList(duplicated)).toThrowError(PolicyError);
  });

  it('rejects duplicate YAML keys', () => {
    expect(() => parseCapabilityAllowList('schemaVersion: a\nschemaVersion: b\n')).toThrowError(
      PolicyError,
    );
  });

  it('rejects an unknown hazard class or gate', () => {
    const broken = source.replace('hazardClass: sensing_only', 'hazardClass: probably_fine');
    expect(() => parseCapabilityAllowList(broken)).toThrowError(/hazardClass/);

    const badGate = source.replace('minimumGate: G7', 'minimumGate: soon');
    expect(() => parseCapabilityAllowList(badGate)).toThrowError(/minimumGate/);
  });
});

describe('recipe capability checks', () => {
  const list = loadCapabilityAllowList();

  it('allows every shipped example recipe', () => {
    for (const { name, requires } of exampleRequires()) {
      const result = checkRecipeRequires(list, requires);
      expect(result.reasons, name).toEqual([]);
      expect(result.allowed, name).toBe(true);
      expect(isCapabilityAllowed(list, requires.cassette.capability), name).toBe(true);
    }
  });

  it('refuses a capability that is not in the allow-list', () => {
    const result = checkRecipeRequires(list, {
      cassette: { type: 'weeding', capability: 'spray_herbicide.v1' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join('\n')).toContain('not in the allow-list');
  });

  it('refuses a capability claimed by the wrong cassette type', () => {
    const result = checkRecipeRequires(list, {
      cassette: { type: 'feed', capability: 'mechanical_weed.v1' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join('\n')).toContain('belongs to a "weeding" cassette');
  });

  it('refuses malformed requires blocks', () => {
    expect(checkRecipeRequires(list, undefined).allowed).toBe(false);
    expect(checkRecipeRequires(list, { cassette: 'FD-01-0001' }).allowed).toBe(false);
    expect(checkRecipeRequires(list, { cassette: { type: 'hovercraft' } }).allowed).toBe(false);
  });
});

describe('release readiness gating', () => {
  const list = loadCapabilityAllowList();
  const weeding = findCapability(list, 'mechanical_weed.v1')!;
  const feed = findCapability(list, 'dispense_mass.v1')!;

  it('blocks a draft allow-list for physical use but allows bench work', () => {
    const physical = checkReleaseReadiness(list, feed, {
      currentGate: 'G5',
      processApprovalGranted: false,
    });
    expect(physical.allowed).toBe(false);
    expect(physical.reasons.join('\n')).toContain('"draft"');

    const bench = checkReleaseReadiness(list, feed, {
      currentGate: 'G5',
      processApprovalGranted: false,
      benchOrSimulationOnly: true,
    });
    expect(bench.allowed).toBe(true);
  });

  it('blocks weeding actuation before its gate and approval', () => {
    const early = checkReleaseReadiness(list, weeding, {
      currentGate: 'G5',
      processApprovalGranted: false,
    });
    expect(early.allowed).toBe(false);
    expect(early.reasons.join('\n')).toContain('requires gate G7');

    expect(capabilityAvailableAtGate(weeding, 'G6')).toBe(false);
    expect(capabilityAvailableAtGate(weeding, 'G7')).toBe(true);
    expect(capabilityAvailableAtGate(weeding, 'nonsense')).toBe(false);
  });

  it('allows a released list at the right gate with approval', () => {
    const released = { ...list, status: 'released' as const };
    const result = checkReleaseReadiness(released, weeding, {
      currentGate: 'G7',
      processApprovalGranted: true,
    });
    expect(result.reasons).toEqual([]);
    expect(result.allowed).toBe(true);
  });
});

describe('manifest capability checks', () => {
  const list = loadCapabilityAllowList();

  it('accepts the reference weeding manifest from docs/02', () => {
    const result = checkManifestCapabilities(list, {
      type: 'weeding',
      capabilities: ['inspect_plant.v1', 'mechanical_weed.v1'],
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects an unknown or mis-typed manifest claim', () => {
    expect(
      checkManifestCapabilities(list, { type: 'weeding', capabilities: ['laser_weed.v9'] }).allowed,
    ).toBe(false);
    expect(
      checkManifestCapabilities(list, { type: 'feed', capabilities: ['collect_egg.v1'] }).allowed,
    ).toBe(false);
  });
});
