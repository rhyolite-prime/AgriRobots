import { describe, expect, it } from 'vitest';

import {
  CASSETTE_IDS,
  CASSETTE_TYPE_BY_ID,
  EVIDENCE_DOMAINS,
  evidenceDomainOf,
  isCassetteId,
  isCassetteType,
  isDrawingId,
  isEvidenceId,
  isGateId,
  isModuleSerial,
  isRecipeName,
  isZoneId,
} from '../src/index.ts';

describe('hardware identifiers', () => {
  it('accepts the four planned cassette serials', () => {
    for (const id of ['EG-01-0001', 'FD-01-0042', 'CS-01-0007', 'WD-01-0004']) {
      expect(isModuleSerial(id)).toBe(true);
    }
  });

  it('rejects malformed or unknown cassette serials', () => {
    expect(isModuleSerial('AP-01-0001')).toBe(false);
    expect(isModuleSerial('FD-02-0001')).toBe(false);
    expect(isModuleSerial('FD-01-42')).toBe(false);
    expect(isModuleSerial('')).toBe(false);
    expect(isModuleSerial(undefined)).toBe(false);
  });

  it('maps every cassette ID to a controlled type', () => {
    for (const id of CASSETTE_IDS) {
      expect(isCassetteId(id)).toBe(true);
      expect(isCassetteType(CASSETTE_TYPE_BY_ID[id])).toBe(true);
    }
    expect(isCassetteId('XX-01')).toBe(false);
  });
});

describe('document identifiers', () => {
  it('matches released drawing numbers', () => {
    expect(isDrawingId('AGR-100_AP01_CARRIER_GA')).toBe(true);
    expect(isDrawingId('AGR-350_CS01_CLEAN_SANITATION_MODULE')).toBe(true);
    expect(isDrawingId('AGR-10_AP01')).toBe(false);
    expect(isDrawingId('agr-100_ap01_carrier_ga')).toBe(false);
  });

  it('matches verification evidence identifiers', () => {
    expect(isEvidenceId('VVT-FD-014')).toBe(true);
    expect(isEvidenceId('VVT-SAF-001')).toBe(true);
    expect(isEvidenceId('VVT-FD-*')).toBe(false);
    expect(isEvidenceId('VVT-14')).toBe(false);
  });

  it('resolves evidence domains against the controlled list', () => {
    expect(evidenceDomainOf('VVT-WD-031')).toBe('WD');
    expect(evidenceDomainOf('VVT-CFG-002')).toBe('CFG');
    expect(evidenceDomainOf('VVT-XYZ-002')).toBeUndefined();
    expect(EVIDENCE_DOMAINS).toContain('SAF');
  });

  it('matches gate, recipe and zone identifiers', () => {
    expect(isGateId('G0')).toBe(true);
    expect(isGateId('G9')).toBe(true);
    expect(isGateId('G10x')).toBe(false);
    expect(isRecipeName('poultry-evening-feed')).toBe(true);
    expect(isRecipeName('Poultry_Feed')).toBe(false);
    expect(isZoneId('house-3-feed-lane')).toBe(true);
    expect(isZoneId('plot a')).toBe(false);
  });
});
