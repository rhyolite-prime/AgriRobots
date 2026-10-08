import { describe, expect, it } from 'vitest';

import {
  ALLOWED_ACTIONS,
  AgriScriptError,
  IR_VERSION,
  assertAllowedAction,
  compileToIr,
  isAllowedAction,
} from '../src/index.ts';

describe('behaviour-tree IR contract', () => {
  it('exposes the seeded action allow-list', () => {
    expect(IR_VERSION).toBe('agri.bt-ir/v0');
    expect(ALLOWED_ACTIONS).toContain('dispense_mass');
    expect(ALLOWED_ACTIONS).toContain('safe_stop');
    expect(isAllowedAction('dispense_mass')).toBe(true);
    expect(isAllowedAction('run_shell')).toBe(false);
    expect(isAllowedAction('publish_ros_topic')).toBe(false);
  });

  it('refuses actions outside the allow-list', () => {
    expect(() => assertAllowedAction('evaluate_python')).toThrowError(AgriScriptError);
    expect(() => assertAllowedAction('navigate')).not.toThrow();
  });

  it('reports compilation as explicitly unimplemented with a plan reference', () => {
    expect(() => compileToIr({})).toThrowError(/not implemented yet/);
    expect(() => compileToIr({})).toThrowError(/WS-C/);
  });
});
