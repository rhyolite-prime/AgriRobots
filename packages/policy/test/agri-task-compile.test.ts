import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { DSL_EXAMPLES_DIR, repoFile, TaskValidationError } from '@agrirobots/compiler-core';
import type { ValidationIssue } from '@agrirobots/compiler-core';
import { describe, expect, it } from 'vitest';

import {
  capabilityDescriptors,
  checkTaskGateReadiness,
  compileAgriTaskSource,
  loadCapabilityAllowList,
  taskValidationContext,
} from '../src/index.ts';

const EXAMPLES = repoFile(DSL_EXAMPLES_DIR);

function source(name: string): string {
  return readFileSync(path.join(EXAMPLES, name), 'utf8');
}

function exampleNames(): string[] {
  return readdirSync(EXAMPLES)
    .filter((name) => name.endsWith('.agri'))
    .sort();
}

/**
 * Golden IR hashes. These are the artifact identities a signature covers, so any
 * change to the grammar, the parser, the validator or the canonicaliser shows up
 * here and must be a deliberate, reviewed act.
 */
const GOLDEN_IR_HASHES: Record<string, string> = {
  'aracnid-egg-collection.agri': '4f35636c61653393438b5e3532ff5306340a40677a4f6a10757be3be61fc498c',
  'guarded-early-weeding.agri': '8f828afa99739562ebcd4b19df5930a1cf964d2c627063aa1651202efa66f355',
  'poultry-evening-feed.agri': '1fc79b28ea8ffcb03320b53bc0281de9e45da3fc91db08e807204e2e6be354e7',
};

function skeleton(steps: string): string {
  return `task probe@1.0.0 {
  requires {
    cassette EG-08 with scan_nest.v1, pick_egg.v1, place_egg.v1;
    operator supervisor_on_site;
    zones lay-house-3;
    process_approval EGG-08-001;
  }
  limits { travel_speed = 0.15 m/s; task_deadline = 40 min; }
  preflight { safety.mode == #READY @ within 500 ms; }
  steps {
    ${steps}
  }
  on_fault { halt: safe_stop; stop: finish failed PROBE_FAULT; }
  evidence { retain journal; }
}`;
}

function issuesOf(src: string): ValidationIssue[] {
  return compileAgriTaskSource(src, { throwOnError: false }).issues;
}

function codes(src: string): string[] {
  return issuesOf(src).map((issue) => issue.code);
}

describe('agri.task/v1 compilation against the installed allow-list', () => {
  it('compiles every shipped example with no errors', () => {
    for (const name of exampleNames()) {
      const compiled = compileAgriTaskSource(source(name), { throwOnError: false });
      const errors = compiled.issues.filter((issue) => issue.severity === 'error');
      expect(errors, name).toEqual([]);
    }
  });

  it('produces stable, golden IR hashes', () => {
    for (const name of exampleNames()) {
      const first = compileAgriTaskSource(source(name));
      const second = compileAgriTaskSource(source(name));
      expect(first.irHash, name).toBe(second.irHash);
      expect(first.irHash, name).toBe(GOLDEN_IR_HASHES[name]);
      expect(first.irHash, name).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('canonicalises the IR deterministically', () => {
    const compiled = compileAgriTaskSource(source('aracnid-egg-collection.agri'));
    const parsed = JSON.parse(compiled.canonicalJson) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
    expect(compiled.canonicalJson).not.toMatch(/undefined/);
    expect(compiled.ir.format).toBe('agri.task-ir/v1');
  });

  it('indexes every statement with a stable id and its lexical parents', () => {
    const compiled = compileAgriTaskSource(source('aracnid-egg-collection.agri'));
    const ids = compiled.ir.index.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('approach');
    expect(ids).toContain('picks');
    expect(ids).toContain('vent');

    const pick = compiled.ir.index.find(
      (entry) => entry.capability === 'pick_egg.v1' && entry.parents.length > 2,
    );
    expect(pick).toBeDefined();
    // branch -> with_permit -> actuate
    expect(pick!.parents.length).toBeGreaterThanOrEqual(3);
  });

  it('summarises the ARACNID round in IR statistics', () => {
    const { ir } = compileAgriTaskSource(source('aracnid-egg-collection.agri'));
    expect(ir.statistics.capabilities).toEqual(['pick_egg.v1', 'place_egg.v1', 'scan_nest.v1']);
    expect(ir.statistics.maxParallelWidth).toBe(8);
    expect(ir.statistics.parallelBranches).toBe(8);
    expect(ir.statistics.permitScopes).toBe(9);
    expect(ir.statistics.guards).toBe(1);
    expect(ir.statistics.maxRetryAttempts).toBe(1);
    expect(ir.statistics.taskDeadlineMs).toBe(40 * 60 * 1000);
    expect(ir.statistics.resourceClaims).toEqual(
      expect.arrayContaining(['tool[hand_1]', 'tool[hand_8]', 'tool[magazine]']),
    );
    expect(ir.requires.cassette).toBe('EG-08');
    expect(ir.limits.find((limit) => limit.key === 'max_force')).toEqual({
      key: 'max_force',
      value: 6,
      unit: 'N',
    });
  });

  it('publishes the allow-list as compiler capability descriptors', () => {
    const allowList = loadCapabilityAllowList();
    const descriptors = capabilityDescriptors(allowList);
    expect(descriptors).toHaveLength(allowList.capabilities.length);
    const pick = descriptors.find((entry) => entry.id === 'pick_egg.v1');
    expect(pick).toMatchObject({
      type: 'egg_collection',
      hazardClass: 'conditional_task',
      gate: 'G6',
      requiresProcessApproval: true,
    });
  });

  it('refuses a capability that is not installed (S1)', () => {
    const allowList = loadCapabilityAllowList();
    const trimmed = {
      ...allowList,
      capabilities: allowList.capabilities.filter((entry) => entry.id !== 'pick_egg.v1'),
    };
    const issues = compileAgriTaskSource(source('aracnid-egg-collection.agri'), {
      allowList: trimmed,
      throwOnError: false,
    }).issues;
    expect(issues.map((issue) => issue.code)).toContain('E_CAPABILITY_UNKNOWN');
    expect(() =>
      compileAgriTaskSource(source('aracnid-egg-collection.agri'), { allowList: trimmed }),
    ).toThrowError(TaskValidationError);
  });

  it('refuses a capability the cassette manifest does not declare (S1)', () => {
    const issues = compileAgriTaskSource(source('aracnid-egg-collection.agri'), {
      manifest: { capabilities: ['scan_nest.v1'], motionDuringToolUse: false },
      throwOnError: false,
    }).issues;
    expect(issues.map((issue) => issue.code)).toContain('E_CAPABILITY_NOT_IN_MANIFEST');
  });

  it('refuses an unknown cassette id (S1)', () => {
    expect(
      codes(skeleton('done: finish success;').replace('cassette EG-08', 'cassette ZZ-99')),
    ).toContain('E_CASSETTE_UNKNOWN');
  });

  it('requires a permit scope around gated actuation (S4)', () => {
    const unpermitted = skeleton(`
      go: actuate pick_egg.v1 (hand = #hand_1)
          within 8 s
          verify { tool.hand_1.seal_quality == #good @ within 500 ms; }
          on_mismatch fault;
      done: finish success;`);
    expect(codes(unpermitted)).toContain('E_UNPERMITTED_ACTUATION');

    const permitted = skeleton(`
      go: with_permit tool_energy on tool[hand_1] for 30 s {
        pick: actuate pick_egg.v1 (hand = #hand_1)
              within 8 s
              verify { tool.hand_1.seal_quality == #good @ within 500 ms; }
              on_mismatch fault;
      };
      done: finish success;`);
    expect(codes(permitted).filter((code) => code === 'E_UNPERMITTED_ACTUATION')).toEqual([]);
  });

  it('requires observable post-conditions (S2)', () => {
    const bad = skeleton(`
      go: with_permit tool_energy on tool[hand_1] for 30 s {
        pick: actuate pick_egg.v1 (hand = #hand_1)
              within 8 s
              verify { $held.load_mass > 40 g @ within 1 s; }
              on_mismatch fault;
      };
      done: finish success;`);
    expect(codes(bad)).toContain('E_POSTCONDITION_UNOBSERVABLE');
  });

  it('requires freshness on safety-relevant reads (S5)', () => {
    const staleGuard = skeleton(`
      go: guard carrier.tilt < 4 deg every 500 ms {
        done: finish success;
      } on_breach fault;`);
    expect(codes(staleGuard)).toContain('E_STALE_STATE_READ');

    const freshGuard = skeleton(`
      go: guard carrier.tilt < 4 deg @ within 200 ms every 500 ms {
        done: finish success;
      } on_breach fault;`);
    expect(codes(freshGuard)).toEqual([]);
  });

  it('arbitrates resource claims (S11)', () => {
    const doubleClaim = skeleton(`
      go: parallel {
        a: branch tool[hand_1] { one: noop "a"; }
        b: branch tool[hand_1] { two: noop "b"; }
      } join all;
      done: finish success;`);
    expect(codes(doubleClaim)).toContain('E_RESOURCE_DOUBLE_CLAIM');

    const distinctClaims = skeleton(`
      go: parallel {
        a: branch tool[hand_1] { one: noop "a"; }
        b: branch tool[hand_2] { two: noop "b"; }
      } join all;
      done: finish success;`);
    expect(codes(distinctClaims)).toEqual([]);

    // EG-08 forbids motion while a tool is in use.
    const overlap = skeleton(`
      go: parallel {
        a: branch traction { one: move along lay-house-3 within 5 min; }
        b: branch tool[hand_1] { two: noop "b"; }
      } join all;
      done: finish success;`);
    expect(codes(overlap)).toContain('E_TRACTION_TOOL_OVERLAP');

    const approved = compileAgriTaskSource(overlap, {
      manifest: {
        capabilities: ['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1'],
        motionDuringToolUse: true,
      },
      throwOnError: false,
    });
    expect(approved.issues.map((issue) => issue.code)).not.toContain('E_TRACTION_TOOL_OVERLAP');
  });

  it('bounds loops and statement counts (S3, S8)', () => {
    const unbounded = skeleton(`
      go: for_each $held in tool.holding_hands at_most 500 { one: noop "x"; };
      done: finish success;`);
    expect(codes(unbounded)).toContain('E_LOOP_BOUND_EXCEEDED');

    const tight = compileAgriTaskSource(
      skeleton(`
      go: for_each $held in tool.holding_hands at_most 8 { one: noop "x"; };
      done: finish success;`),
      { throwOnError: false, limits: { maxLoopIterations: 4 } },
    );
    expect(tight.issues.map((issue) => issue.code)).toContain('E_LOOP_BOUND_EXCEEDED');
  });

  it('rejects duplicate ids, unknown jump targets and unreachable code (S6)', () => {
    const duplicate = skeleton(`
      go: noop "one";
      go: noop "two";
      done: finish success;`);
    expect(codes(duplicate)).toContain('E_DUPLICATE_STATEMENT_ID');

    const dangling = skeleton(`
      go: guard carrier.tilt < 4 deg @ within 200 ms every 500 ms {
        inner: noop "x";
      } on_breach nowhere;
      done: finish success;`);
    expect(codes(dangling)).toContain('E_UNKNOWN_JUMP_TARGET');

    const unreachable = skeleton(`
      done: finish success;
      after: noop "never runs";`);
    expect(codes(unreachable)).toContain('E_UNREACHABLE_STATEMENT');
  });

  it('refuses dimensionally inconsistent quantities (S9)', () => {
    // A commanded speed in the wrong dimension against the declared limit.
    expect(
      codes(
        skeleton(`
      go: move along lay-house-3 at 0.15 kPa within 5 min;
      done: finish success;`),
      ),
    ).toContain('E_UNIT_MISMATCH');

    // Two literal quantities of different dimensions may not be compared.
    expect(
      codes(
        skeleton(`
      go: when 40 g > 40 kPa @ within 1 s { inner: noop "x"; };
      done: finish success;`),
      ),
    ).toContain('E_UNIT_MISMATCH');

    // A quantity combined with a bare number loses its dimension.
    expect(
      codes(
        skeleton(`
      go: when 40 g < 4 @ within 1 s { inner: noop "x"; };
      done: finish success;`),
      ),
    ).toContain('E_UNIT_REQUIRED');
  });

  it('reports gate readiness for a compiled task', () => {
    const compiled = compileAgriTaskSource(source('aracnid-egg-collection.agri'));

    const atG6 = checkTaskGateReadiness(compiled, {
      currentGate: 'G6',
      processApprovalGranted: true,
    });
    expect(atG6).toEqual({ ready: true, reasons: [] });

    const atG2 = checkTaskGateReadiness(compiled, {
      currentGate: 'G2',
      processApprovalGranted: true,
    });
    expect(atG2.ready).toBe(false);
    expect(atG2.reasons.join('\n')).toMatch(/needs gate G6/);

    const noApproval = checkTaskGateReadiness(compiled, {
      currentGate: 'G6',
      processApprovalGranted: false,
    });
    expect(noApproval.ready).toBe(false);
    expect(noApproval.reasons.join('\n')).toMatch(/process approval/);
  });

  it('keeps the validation context injectable', () => {
    const context = taskValidationContext({
      manifest: { capabilities: ['scan_nest.v1'], motionDuringToolUse: false },
      knownTasks: ['aracnid-egg-collection@1.0.0'],
    });
    expect(context.capabilities.length).toBeGreaterThan(0);
    expect(context.knownCassettes).toContain('EG-08');
    expect(context.manifestCapabilities).toEqual(['scan_nest.v1']);
    expect(context.motionDuringToolUse).toBe(false);
  });
});
