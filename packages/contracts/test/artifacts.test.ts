import { describe, expect, it } from 'vitest';

import { isSha256Hex, isMissionPermitting, MISSION_PERMITTING_STATES } from '../src/index.ts';

describe('artifact hash guard', () => {
  it('accepts lowercase hex sha256 only', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('sha256:' + 'a'.repeat(64))).toBe(false);
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(isSha256Hex(42)).toBe(false);
  });
});

describe('safety mode gating', () => {
  it('permits a mission only in the two autonomous modes', () => {
    expect(MISSION_PERMITTING_STATES).toEqual(['AUTO_TRAVEL', 'AUTO_TASK']);
    expect(isMissionPermitting('AUTO_TASK')).toBe(true);
    expect(isMissionPermitting('READY')).toBe(false);
    expect(isMissionPermitting('SERVICE')).toBe(false);
    expect(isMissionPermitting('UNKNOWN')).toBe(false);
    expect(isMissionPermitting('SAFE_STOP')).toBe(false);
  });
});
