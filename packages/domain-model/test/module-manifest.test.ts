import { describe, expect, it } from 'vitest';

import {
  MODULE_MANIFEST_SCHEMA,
  manifestAllowsZoneClass,
  validateModuleManifest,
  type ModuleManifest,
} from '../src/index.ts';

const validManifest: ModuleManifest = {
  schema: MODULE_MANIFEST_SCHEMA,
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

describe('agri.module/v1 manifest validation', () => {
  it('accepts the reference manifest from docs/02', () => {
    const result = validateModuleManifest(validManifest);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.manifest?.module_id).toBe('WD-01-0042');
  });

  it('accepts an ARACNID EG-08 manifest with carrier requirements', () => {
    const result = validateModuleManifest({
      ...validManifest,
      module_id: 'EG-08-0001',
      type: 'egg_collection',
      capabilities: ['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1'],
      carrier_requirements: {
        carrier_id: 'AR-01',
        min_payload_rating_kg: 135,
        max_stowed_height_mm: 850,
        requires_uci: 'UCI-01',
        motion_during_tool_use: false,
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects carrier requirements without a payload rating', () => {
    const result = validateModuleManifest({
      ...validManifest,
      carrier_requirements: { carrier_id: 'AR-01' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('min_payload_rating_kg');
  });

  it('rejects a non-object payload', () => {
    expect(validateModuleManifest('WD-01-0042').valid).toBe(false);
    expect(validateModuleManifest(null).valid).toBe(false);
  });

  it('rejects a serial that disagrees with the cassette type', () => {
    const result = validateModuleManifest({ ...validManifest, module_id: 'FD-01-0042' });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('prefix does not match cassette type');
  });

  it('rejects missing measurements rather than defaulting them', () => {
    const { mass_kg: _mass, cg_mm: _cg, ...partial } = validManifest;
    const result = validateModuleManifest(partial);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('mass_kg');
    expect(result.errors.join('\n')).toContain('cg_mm');
  });

  it('rejects peak current below continuous current', () => {
    const result = validateModuleManifest({
      ...validManifest,
      power: { nominal_v: 48, continuous_a: 30, peak_a: 18 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('power.peak_a');
  });

  it('rejects an unsigned or uncalibrated manifest', () => {
    const result = validateModuleManifest({
      ...validManifest,
      calibration_bundle: 'todo',
      signature: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('calibration_bundle');
    expect(result.errors.join('\n')).toContain('signature');
  });

  it('authorises only the declared tool zone class', () => {
    expect(manifestAllowsZoneClass(validManifest, 'guarded_field')).toBe(true);
    expect(manifestAllowsZoneClass(validManifest, 'open_field')).toBe(false);
    expect(manifestAllowsZoneClass(validManifest, 'house-3-feed-lane')).toBe(false);
  });
});
