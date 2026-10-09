/**
 * Tests for the Virtual Lab's own logic, run from the repository root by the
 * same `vitest` that tests the packages.
 *
 * What is worth testing here is not the Vue components — it is the code the
 * components trust: the journal → timeline mapping, the safety view derived from
 * a journal prefix, the closed task shelf, the compiled-task summary and the
 * scenario catalogue. All of it is pure TypeScript with no Nuxt and no `three`
 * import, so it runs in Node.
 *
 * The runs below are real: they compile `dsl/examples/aracnid-egg-collection.agri`
 * and execute it against `AracnidWorld` exactly as `POST /api/missions/run` does.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { repoFile } from '@agrirobots/compiler-core';
import {
  ARACNID,
  AracnidWorld,
  DEFAULT_MISSION_EPOCH_MS,
  EXIT_CODES,
  runMission,
  type AracnidScenario,
  type MissionResult,
} from '@agrirobots/engine';
import { compileAgriTaskSource } from '@agrirobots/policy';

import { renderAssertion, renderExpr } from '../app/shared/ir-render';
import {
  NOISY_KINDS,
  elapsedMsOf,
  inTimeOrder,
  summariseEvent,
  toJournalLine,
  type RawJournalEvent,
} from '../app/shared/journal-lines';
import type { CompiledSummary, JournalLine } from '../app/shared/lab-types';
import {
  ARACNID_FAULT_KINDS,
  ARACNID_SCENARIOS,
  NEST_LAYOUTS,
  isFaultKind,
  isScenario,
  scenarioById,
} from '../app/shared/scenarios';
import { EXIT_CODE_MEANINGS, SAFETY_FUNCTIONS } from '../app/shared/safety-functions';
import { deriveSafetyView, frameAt, visitedStatements } from '../app/shared/safety-view';
import { toCompiledSummary } from '../server/utils/compiled-summary';
import { LAB_TASKS, findLabTask, readLabTaskSource } from '../server/utils/lab-tasks';

const ARACNID_TASK_ID = 'aracnid-egg-collection';

/** The IR hash pinned by `packages/policy/test/agri-task-compile.test.ts`. */
const ARACNID_IR_HASH = '4f35636c61653393438b5e3532ff5306340a40677a4f6a10757be3be61fc498c';

interface LabRun {
  result: MissionResult;
  lines: readonly JournalLine[];
  summary: CompiledSummary;
}

/** Compiles and executes the ARACNID round the way the lab's API route does. */
function runLab(
  scenario: AracnidScenario,
  seed = 7,
  nestLayout: 'arc' | 'straight' = 'arc',
): LabRun {
  const task = findLabTask(ARACNID_TASK_ID);
  if (!task) throw new Error(`${ARACNID_TASK_ID} is not on the lab shelf`);
  const compiled = compileAgriTaskSource(readLabTaskSource(task));
  const world = new AracnidWorld({ scenario, seed, nestLayout });
  const result = runMission({
    compiled,
    world,
    runId: `test-${scenario}-${String(seed)}-${nestLayout}`,
    epochMs: DEFAULT_MISSION_EPOCH_MS,
  });
  return {
    result,
    lines: result.journal.map((entry) => toJournalLine(entry, DEFAULT_MISSION_EPOCH_MS)),
    summary: toCompiledSummary(compiled),
  };
}

function lastFrame(run: LabRun) {
  return run.result.twinFrames.length > 0
    ? (run.result.twinFrames[run.result.twinFrames.length - 1] ?? null)
    : null;
}

describe('the lab shelf is closed', () => {
  it('lists the ARACNID task and only resolves ids it lists', () => {
    const ids = LAB_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(ARACNID_TASK_ID);
    expect(findLabTask(ARACNID_TASK_ID)?.file).toBe('aracnid-egg-collection.agri');
  });

  it('refuses anything that is not a listed id, including paths', () => {
    for (const attempt of [
      '../../dsl/examples/aracnid-egg-collection.agri',
      '/etc/passwd',
      'aracnid-egg-collection.agri',
      'ARACNID-EGG-COLLECTION',
      '',
    ]) {
      expect(findLabTask(attempt), attempt).toBeUndefined();
    }
  });

  it('reads exactly the committed bytes of the example', () => {
    const task = findLabTask(ARACNID_TASK_ID);
    if (!task) throw new Error('missing task');
    const committed = readFileSync(repoFile(`dsl/examples/${task.file}`), 'utf8');
    expect(readLabTaskSource(task)).toBe(committed);
    expect(committed).toContain('agri.task/v1');
  });

  it('says which tasks have a world model that can execute them', () => {
    const aracnid = findLabTask(ARACNID_TASK_ID);
    expect(aracnid?.worlds).toContain('aracnid');
    // A task with no world may still be compiled and reviewed, never executed.
    for (const task of LAB_TASKS) {
      expect(task.worlds.every((world) => world === 'aracnid' || world === 'bench')).toBe(true);
    }
  });
});

describe('the compiled summary the panels show', () => {
  const run = runLab('nominal');

  it('quotes the same IR hash the policy tests pin', () => {
    expect(run.summary.irHash).toBe(ARACNID_IR_HASH);
    expect(run.summary.taskName).toBe('aracnid-egg-collection');
    expect(run.summary.canonicalBytes).toBeGreaterThan(0);
  });

  it('carries the statistics the compiled-task panel prints', () => {
    expect(run.summary.statistics.statementCount).toBe(33);
    expect(run.summary.statistics.actuatingStatements).toBe(11);
    expect(run.summary.statistics.permitScopes).toBe(9);
    expect(run.summary.statistics.guards).toBe(1);
    expect(run.summary.statistics.parallelBranches).toBe(8);
    expect(run.summary.statistics.taskDeadlineMs).toBe(2_400_000);
    expect(run.summary.statistics.capabilities).toContain('pick_egg.v1');
    expect(run.summary.statistics.capabilities).toContain('place_egg.v1');
  });

  it('renders preflight conditions and the statement index as readable text', () => {
    expect(run.summary.preflight.length).toBeGreaterThan(0);
    for (const line of run.summary.preflight) {
      expect(line.length, line).toBeGreaterThan(0);
      expect(line).not.toContain('[object Object]');
      expect(line).not.toContain('undefined');
    }
    expect(run.summary.statements).toHaveLength(run.summary.statistics.statementCount);

    // One pick statement per hand, each nested inside the parallel fan-out.
    const picks = run.summary.statements.filter((entry) => entry.capability === 'pick_egg.v1');
    expect(picks).toHaveLength(ARACNID.handCount);
    for (const pick of picks) {
      expect(pick.parents.length, pick.id).toBeGreaterThan(0);
    }

    // The index and the statistics must agree about how many permit scopes exist.
    const permitStatements = run.summary.statements.filter(
      (entry) => (entry.permits?.length ?? 0) > 0,
    );
    expect(permitStatements).toHaveLength(run.summary.statistics.permitScopes);
  });

  it('lists the limits with their units, so the panel never shows a bare number', () => {
    const keys = run.summary.limits.map((limit) => limit.key);
    expect(keys).toContain('travel_speed');
    for (const limit of run.summary.limits) {
      expect(limit.unit.length, limit.key).toBeGreaterThan(0);
      expect(Number.isFinite(limit.value), limit.key).toBe(true);
    }
  });
});

describe('journal entries become timeline rows', () => {
  const run = runLab('nominal');

  it('maps every entry, in causal order, with mission-relative time', () => {
    expect(run.lines).toHaveLength(run.result.journal.length);
    let previousSequence = -1;
    for (const [index, line] of run.lines.entries()) {
      const entry = run.result.journal[index] as RawJournalEvent;
      expect(line.sequence, `row ${String(index)}`).toBe(entry.sequence);
      expect(line.kind, `row ${String(index)}`).toBe(entry.kind);
      expect(line.sequence).toBeGreaterThan(previousSequence);
      expect(Number.isFinite(line.t), `row ${String(index)}`).toBe(true);
      expect(line.t, `row ${String(index)}`).toBeGreaterThanOrEqual(0);
      previousSequence = line.sequence;
    }
    expect(run.lines[0]?.kind).toBe('mission.started');
  });

  it('keeps the journal causal and offers a mission-time ordering for scrubbing', () => {
    // At a parallel join the interpreter flushes branches in branch order, so the
    // audit record is not in time order. Anything driven by the playhead sorts.
    const ordered = inTimeOrder(run.lines);
    expect(ordered).toHaveLength(run.lines.length);
    expect(new Set(ordered.map((line) => line.sequence)).size).toBe(run.lines.length);
    let previousT = -1;
    for (const line of ordered) {
      expect(line.t).toBeGreaterThanOrEqual(previousT);
      previousT = line.t;
    }
    expect(ordered[0]?.kind).toBe('mission.started');
  });

  it('anchors elapsed time to the mission epoch, not to the wall clock', () => {
    const entry = run.result.journal[0] as RawJournalEvent;
    expect(elapsedMsOf(entry, DEFAULT_MISSION_EPOCH_MS)).toBe(run.lines[0]?.t ?? Number.NaN);
    const shifted = elapsedMsOf(entry, DEFAULT_MISSION_EPOCH_MS + 1_000);
    expect(shifted).toBeCloseTo((run.lines[0]?.t ?? 0) - 1_000, 6);
  });

  it('gives every kind that actually occurs a one-line summary', () => {
    const kinds = new Set(run.lines.map((line) => line.kind));
    expect(kinds.size).toBeGreaterThan(20);
    for (const kind of kinds) {
      const line = run.lines.find((candidate) => candidate.kind === kind);
      const summary = line ? summariseEvent(line.kind, line.payload) : '';
      expect(summary.length, kind).toBeGreaterThan(0);
      expect(summary, kind).not.toContain('[object Object]');
      expect(summary, kind).not.toContain('undefined');
    }
  });

  it('never folds a safety-relevant kind into the noise filter', () => {
    const mustStayVisible = [
      'safety.state_changed',
      'safety.inhibited',
      'safety.function_tripped',
      'guard.breached',
      'fault.entered',
      'permit.denied',
      'resource.denied',
      'mode.degraded',
      'mode.speed_capped',
      'mission.suspended',
      'statement.interrupted',
    ];
    for (const kind of mustStayVisible) {
      expect(NOISY_KINDS, kind).not.toContain(kind);
    }
    // The folded kinds are the high-volume bookkeeping the timeline would drown in.
    expect(NOISY_KINDS).toContain('twin.frame');
    expect(NOISY_KINDS).toContain('permit.requested');
    // A grant is the moment a hand is allowed to move: it stays visible.
    expect(NOISY_KINDS).not.toContain('permit.granted');
  });

  it('folds the per-step twin frames, and nothing else, out of the visible rows', () => {
    const frameRows = run.lines.filter((line) => line.kind === 'twin.frame');
    expect(frameRows.length).toBe(run.result.twinFrames.length);
    expect(NOISY_KINDS).toContain('twin.frame');
    const visible = run.lines.filter((line) => !NOISY_KINDS.includes(line.kind));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(run.lines.length);
    expect(visible.map((line) => line.kind)).toContain('permit.granted');
  });
});

describe('the safety view is derived, never invented', () => {
  it('shows a clean round as clean', () => {
    const run = runLab('nominal');
    const view = deriveSafetyView(run.lines, Number.POSITIVE_INFINITY, lastFrame(run));
    expect(view.state).toBe('AUTO_TASK');
    expect(view.inhibited).toBe(false);
    expect(view.tripped).toEqual([]);
    expect(view.guardBreaches).toEqual([]);
    expect(view.denials).toEqual([]);
    expect(view.safeStop).toBeNull();
    expect(view.degraded).toBeNull();
    expect(run.result.exitCode).toBe(EXIT_CODES.success);
  });

  it('shows permits as outstanding only while they are held', () => {
    const run = runLab('nominal');
    const granted = run.lines.find((line) => line.kind === 'permit.granted');
    expect(granted, 'the round grants permits').toBeDefined();
    const during = deriveSafetyView(run.lines, granted?.t ?? 0, null);
    expect(during.permits.length).toBeGreaterThan(0);
    const after = deriveSafetyView(run.lines, Number.POSITIVE_INFINITY, null);
    expect(after.permits).toEqual([]);
    expect(after.claims).toEqual([]);
  });

  it('shows a guard breach as a guard breach, with the safe stop that followed', () => {
    const run = runLab('tilt-breach');
    const view = deriveSafetyView(run.lines, Number.POSITIVE_INFINITY, lastFrame(run));
    expect(run.result.exitCode).toBe(EXIT_CODES.safetyInhibited);
    expect(view.inhibited).toBe(true);
    expect(view.state).toBe('SAFE_STOP');
    expect(view.guardBreaches.length).toBeGreaterThan(0);
    expect(view.safeStop).not.toBeNull();
    // The inhibition arrives through the fault clause, so the panel has to be able
    // to say why: an unexplained inhibition is not a reviewable one.
    expect(view.reasons.join(' | ')).toContain('E_GUARD_BREACH');
  });

  it('shows a tripped safety function when a worker walks in', () => {
    const run = runLab('worker-presence');
    const view = deriveSafetyView(run.lines, Number.POSITIVE_INFINITY, lastFrame(run));
    expect(view.tripped).toContain('SF-AR-07');
    expect(view.inhibited).toBe(true);
    expect(run.result.exitCode).toBe(EXIT_CODES.safetyInhibited);
  });

  it('is scoped to the playback position, so scrubbing rewinds the panel', () => {
    const run = runLab('worker-presence');
    const full = deriveSafetyView(run.lines, Number.POSITIVE_INFINITY, lastFrame(run));
    const start = deriveSafetyView(run.lines, 0, null);
    expect(full.inhibited).toBe(true);
    expect(start.inhibited).toBe(false);
    expect(start.tripped).toEqual([]);
    expect(visitedStatements(run.lines, 0).length).toBeLessThan(
      visitedStatements(run.lines, Number.POSITIVE_INFINITY).length,
    );
  });

  it('traces only statements the run actually entered', () => {
    const run = runLab('nominal');
    const visited = visitedStatements(run.lines, Number.POSITIVE_INFINITY);
    const ids = new Set(run.summary.statements.map((entry) => entry.id));
    expect(visited.length).toBeGreaterThan(0);
    for (const id of visited) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(new Set(visited).size).toBe(visited.length);
  });
});

describe('twin frame interpolation', () => {
  const run = runLab('nominal');
  const frames = run.result.twinFrames;

  it('clamps before the first frame and after the last', () => {
    const before = frameAt(frames, -1_000);
    expect(before.frame?.t).toBe(frames[0]?.t);
    expect(before.alpha).toBe(0);
    const after = frameAt(frames, Number.POSITIVE_INFINITY);
    expect(after.frame?.t).toBe(frames[frames.length - 1]?.t);
    expect(after.next).toBeNull();
    expect(after.alpha).toBe(1);
  });

  it('brackets a mid-run time and reports how far into the span it falls', () => {
    // Several statements share a timestamp, so pick a span that actually moves.
    const index = frames.findIndex((frame, next) => (frames[next + 1]?.t ?? 0) - frame.t >= 2);
    expect(index, 'the round has a frame span wider than 1 ms').toBeGreaterThanOrEqual(0);
    const current = frames[index];
    const following = frames[index + 1];
    expect(current).toBeDefined();
    expect(following).toBeDefined();
    const blend = frameAt(frames, (current?.t ?? 0) + 1);
    expect(blend.frame?.t).toBe(current?.t);
    expect(blend.next?.t).toBe(following?.t);
    expect(blend.alpha).toBeGreaterThan(0);
    expect(blend.alpha).toBeLessThan(1);
  });

  it('is in mission-time order even though the journal is not', () => {
    let previousT = -1;
    for (const frame of frames) {
      expect(frame.t).toBeGreaterThanOrEqual(previousT);
      previousT = frame.t;
    }
  });

  it('returns nothing to draw for an empty timeline instead of a stale frame', () => {
    expect(frameAt([], 12)).toEqual({ frame: null, next: null, alpha: 1 });
  });

  it('draws eight arms and a six-tray magazine, matching the machine', () => {
    const frame = lastFrame(run);
    expect(frame?.arms).toHaveLength(ARACNID.handCount);
    expect(frame?.magazine.trays).toHaveLength(ARACNID.trayCount);
    expect(frame?.magazine.capacity).toBe(ARACNID.trayEggCapacity);
    expect(frame?.nestBank.slots.length ?? 0).toBeGreaterThan(0);
    expect(frame?.safety.state).toBe(run.result.safety.state);
  });
});

describe('the scenario catalogue cannot offer what the engine does not model', () => {
  it('lists eight scenarios and agrees with its own predicates', () => {
    expect(ARACNID_SCENARIOS).toHaveLength(8);
    const ids = ARACNID_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isScenario(id), id).toBe(true);
      expect(scenarioById(id)?.label.length ?? 0, id).toBeGreaterThan(0);
    }
    expect(isScenario('teleport')).toBe(false);
    expect(scenarioById(undefined)).toBeUndefined();
  });

  it('describes each scenario and what it is expected to do', () => {
    for (const scenario of ARACNID_SCENARIOS) {
      expect(scenario.description.length, scenario.id).toBeGreaterThan(20);
      expect(scenario.expects.length, scenario.id).toBeGreaterThan(20);
    }
  });

  it('names fault kinds the ARACNID world accepts, and which need a hand', () => {
    const ids = ARACNID_FAULT_KINDS.map((kind) => kind.id);
    expect(ids).toContain('seal_loss');
    expect(ids).toContain('heartbeat_gap');
    for (const kind of ARACNID_FAULT_KINDS) {
      expect(isFaultKind(kind.id), kind.id).toBe(true);
      if (kind.takesHand) {
        expect(['seal_loss', 'vacuum_decay', 'force_overrun'], kind.id).toContain(kind.id);
      }
    }
    expect(isFaultKind('meteor')).toBe(false);
  });

  it('offers both nest geometries the world implements', () => {
    expect(NEST_LAYOUTS.map((layout) => layout.id)).toEqual(['arc', 'straight']);
  });

  it('runs every catalogued scenario to the outcome its description promises', () => {
    const expected: Record<string, { status: MissionResult['status']; exitCode: number }> = {
      nominal: { status: 'completed', exitCode: EXIT_CODES.success },
      'low-confidence': { status: 'aborted', exitCode: EXIT_CODES.executionFailed },
      'seal-loss': { status: 'completed', exitCode: EXIT_CODES.success },
      'cracked-egg': { status: 'completed', exitCode: EXIT_CODES.success },
      'worker-presence': { status: 'inhibited', exitCode: EXIT_CODES.safetyInhibited },
      'tilt-breach': { status: 'inhibited', exitCode: EXIT_CODES.safetyInhibited },
      'magazine-full': { status: 'failed', exitCode: EXIT_CODES.executionFailed },
      'fewer-eggs-than-hands': { status: 'failed', exitCode: EXIT_CODES.executionFailed },
    };
    expect(Object.keys(expected).sort()).toEqual(
      [...ARACNID_SCENARIOS.map((scenario) => scenario.id)].sort(),
    );
    for (const scenario of ARACNID_SCENARIOS) {
      const want = expected[scenario.id];
      expect(want, scenario.id).toBeDefined();
      const run = runLab(scenario.id as AracnidScenario);
      expect(run.result.status, scenario.id).toBe(want?.status);
      expect(run.result.exitCode, scenario.id).toBe(want?.exitCode);
    }
  });
});

describe('the safety table in the panel is the table in the design basis', () => {
  it('transcribes SF-AR-01 to SF-AR-10 in order', () => {
    expect(SAFETY_FUNCTIONS).toHaveLength(10);
    expect(SAFETY_FUNCTIONS.map((row) => row.id)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `SF-AR-${String(index + 1).padStart(2, '0')}`),
    );
    for (const row of SAFETY_FUNCTIONS) {
      expect(row.name.length, row.id).toBeGreaterThan(0);
      expect(row.physical.length, row.id).toBeGreaterThan(0);
      expect(row.software.length, row.id).toBeGreaterThan(0);
    }
  });

  it('explains every exit code the engine can return', () => {
    for (const code of Object.values(EXIT_CODES)) {
      expect(EXIT_CODE_MEANINGS[code], `exit ${String(code)}`).toBeTruthy();
    }
    expect(Object.keys(EXIT_CODE_MEANINGS)).toHaveLength(Object.keys(EXIT_CODES).length);
  });
});

describe('compiled expressions render back to readable conditions', () => {
  it('renders a state comparison with its path, operator and bound', () => {
    const rendered = renderExpr({
      kind: 'comparison',
      left: { kind: 'path', path: 'carrier.tilt_deg' },
      operator: '<=',
      right: { kind: 'number', value: 4 },
    });
    expect(rendered).toContain('carrier.tilt_deg');
    expect(rendered).toContain('<=');
    expect(rendered).toContain('4');
  });

  it('renders a freshness bound as the script wrote it', () => {
    const bare = renderAssertion({ condition: { kind: 'path', path: 'zone.current_id' } });
    const fresh = renderAssertion({
      condition: { kind: 'path', path: 'zone.current_id' },
      freshnessMs: 250,
    });
    expect(bare).toContain('zone.current_id');
    expect(fresh.length).toBeGreaterThan(bare.length);
    expect(fresh).toContain('250');
  });

  it('renders the preflight of the real task without placeholders', () => {
    const task = findLabTask(ARACNID_TASK_ID);
    if (!task) throw new Error('missing task');
    const compiled = compileAgriTaskSource(readLabTaskSource(task));
    for (const assertion of compiled.ir.preflight) {
      const rendered = renderAssertion(assertion);
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toMatch(/\[object Object\]|undefined|NaN/);
    }
  });
});
