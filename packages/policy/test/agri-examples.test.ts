import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkRecipeRequires,
  findCapability,
  gateNumber,
  loadCapabilityAllowList,
} from '../src/index.ts';

const EXAMPLES_DIR = path.join(process.cwd(), 'dsl', 'examples');

interface AgriRequires {
  file: string;
  cassetteType: string;
  capabilities: string[];
  operatorPolicy: string;
  zones: string[];
}

/** Cassette id -> `agri.module/v1` type, mirroring @agrirobots/domain-model. */
const TYPE_BY_CASSETTE: Record<string, string> = {
  'EG-01': 'egg_collection',
  'FD-01': 'feed',
  'CS-01': 'cleaning_sanitation',
  'WD-01': 'weeding',
};

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function readRequires(): AgriRequires[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith('.agri'))
    .sort()
    .map((name) => {
      const text = stripComments(readFileSync(path.join(EXAMPLES_DIR, name), 'utf8'));

      const cassette = /cassette\s+(EG-01|FD-01|CS-01|WD-01)\s+with\s+([^;]+);/.exec(text);
      const operator = /operator\s+([a-z_]+)\s*;/.exec(text);
      const zones = /zones\s+([^;]+);/.exec(text);

      expect(cassette, `${name}: no "cassette <id> with <capabilities>;" clause`).not.toBeNull();
      expect(operator, `${name}: no operator policy`).not.toBeNull();
      expect(zones, `${name}: no zones`).not.toBeNull();

      const [, cassetteId = '', capabilityText = ''] = cassette!;
      const [, operatorPolicy = ''] = operator!;
      const [, zoneText = ''] = zones!;
      const cassetteType = TYPE_BY_CASSETTE[cassetteId];
      expect(cassetteType, `${name}: unknown cassette id "${cassetteId}"`).toBeDefined();

      return {
        file: name,
        cassetteType: cassetteType ?? '',
        capabilities: capabilityText.split(',').map((capability) => capability.trim()),
        operatorPolicy,
        zones: zoneText.split(',').map((zone) => zone.trim()),
      };
    });
}

describe('.agri grammar examples against the capability allow-list', () => {
  const list = loadCapabilityAllowList();
  const examples = readRequires();

  it('found the textual examples', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it('declares only allow-listed capabilities on the right cassette type', () => {
    for (const example of examples) {
      for (const capability of example.capabilities) {
        const entry = findCapability(list, capability);
        expect(entry, `${example.file}: ${capability} not in allow-list`).toBeDefined();
        expect(entry!.cassetteType, `${example.file}: ${capability}`).toBe(example.cassetteType);
      }

      const result = checkRecipeRequires(list, {
        cassette: { type: example.cassetteType, capability: example.capabilities[0] },
      });
      expect(result.reasons, example.file).toEqual([]);
      expect(result.allowed, example.file).toBe(true);
    }
  });

  it('keeps every example supervised, matching the pilot operating rule', () => {
    for (const example of examples) {
      expect(example.operatorPolicy, example.file).toBe('supervisor_on_site');
      expect(example.zones.length, example.file).toBeGreaterThan(0);
    }
  });

  it('only claims an actuation-gated capability at or beyond its gate', () => {
    const weeding = examples.find((example) => example.capabilities.includes('mechanical_weed.v1'));
    expect(weeding).toBeDefined();

    const entry = findCapability(list, 'mechanical_weed.v1')!;
    expect(entry.hazardClass).toBe('actuation_gated');
    expect(gateNumber(entry.minimumGate)).toBe(7);
    // The example is a bench/simulation/guarded-plot artifact, never a release.
    expect(readFileSync(path.join(EXAMPLES_DIR, weeding!.file), 'utf8')).toContain(
      'actuation-gated at G7',
    );
  });
});
