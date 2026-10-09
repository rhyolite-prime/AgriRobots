import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { JournalEvent } from '@agrirobots/contracts';
import { DSL_EXAMPLES_DIR, repoFile } from '@agrirobots/compiler-core';
import type { CompiledTask } from '@agrirobots/compiler-core';
import { TaskValidationError } from '@agrirobots/compiler-core';
import { compileAgriTaskSource } from '@agrirobots/policy';
import { describe, expect, it } from 'vitest';

import {
  AracnidWorld,
  EXIT_CODES,
  MissionError,
  resumeMission,
  runMission,
  ScriptedWorld,
  type AracnidScenario,
  type MissionResult,
  type RuntimeValue,
} from '../src/index.ts';

const ARACNID_SOURCE = readFileSync(
  path.join(repoFile(DSL_EXAMPLES_DIR), 'aracnid-egg-collection.agri'),
  'utf8',
);

const compiledAracnid: CompiledTask = compileAgriTaskSource(ARACNID_SOURCE);

function round(
  scenario: AracnidScenario = 'nominal',
  options: {
    seed?: number;
    nestLayout?: 'arc' | 'straight';
    faults?: Parameters<typeof AracnidWorld.prototype.inject>[0][];
  } = {},
): { result: MissionResult; world: AracnidWorld } {
  const world = new AracnidWorld({
    scenario,
    seed: options.seed ?? 7,
    ...(options.nestLayout ? { nestLayout: options.nestLayout } : {}),
    ...(options.faults ? { faults: options.faults } : {}),
  });
  return {
    result: runMission({ compiled: compiledAracnid, world, runId: `run-${scenario}` }),
    world,
  };
}

function payload(event: JournalEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function only(result: MissionResult, kind: string): JournalEvent {
  const events = result.journal.filter((event) => event.kind === kind);
  expect(events, `expected exactly one ${kind}`).toHaveLength(1);
  return events[0]!;
}

describe('ARACNID egg round — nominal', () => {
  const { result } = round('nominal');

  it('completes the round with every hand used and every egg placed', () => {
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.errorCode).toBeUndefined();
    expect(result.tally).toMatchObject({
      offered: 8,
      picked: 8,
      placed: 8,
      cracked: 0,
      abstained: 0,
    });
    // Seven eggs in the bank were already dirty, undersized or cracked: they are
    // rejected by the scan and never counted as damage caused by the robot.
    expect(result.tally.rejected).toBe(7);
    expect(result.safety.state).toBe('AUTO_TASK');
    expect(result.safety.tripped).toEqual([]);
  });

  it('runs the eight picks as one quorum join, not as a sequence', () => {
    const join = payload(only(result, 'join.completed'));
    expect(join).toMatchObject({
      id: 'picks',
      policy: 'quorum',
      required: 6,
      succeeded: 8,
      abstained: 0,
      failed: 0,
    });
    const lanes = join['laneMs'] as number[];
    expect(lanes).toHaveLength(8);
    // Wall time is the slowest lane, not the sum: the branches were concurrent.
    expect(result.elapsedMs).toBeLessThan(lanes.reduce((sum, ms) => sum + ms, 0));
    expect(result.journal.filter((event) => event.kind === 'branch.started')).toHaveLength(8);
    expect(result.journal.filter((event) => event.kind === 'branch.completed')).toHaveLength(8);
  });

  it('checks the preflight clause before arming, and journals each condition', () => {
    const checks = result.journal.filter((event) => event.kind === 'preflight.checked');
    expect(checks).toHaveLength(8);
    expect(checks.every((event) => payload(event)['holds'] === true)).toBe(true);
    expect(checks.every((event) => payload(event)['stale'] === false)).toBe(true);
    const firstStatement = result.journal.find((event) => event.kind === 'statement.entered')!;
    expect(checks[0]!.sequence).toBeLessThan(firstStatement.sequence);
    expect(checks[checks.length - 1]!.sequence).toBeLessThan(firstStatement.sequence);
  });

  it('writes a strictly ordered journal and a twin frame per statement', () => {
    const sequences = result.journal.map((event) => event.sequence);
    expect(sequences).toEqual(sequences.slice().sort((left, right) => left - right));
    expect(sequences[0]).toBe(1);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(result.journal.every((event) => event.runId === 'run-nominal')).toBe(true);
    expect(result.twinFrames.length).toBeGreaterThan(20);
    expect(result.twinFrames.every((frame) => frame.arms.length === 8)).toBe(true);
  });

  it('is deterministic: the same seed gives the same journal hash', () => {
    const again = round('nominal').result;
    expect(again.journalHash).toBe(result.journalHash);
    expect(again.journal).toHaveLength(result.journal.length);
    expect(again.twinFrames).toHaveLength(result.twinFrames.length);
    expect(again.elapsedMs).toBe(result.elapsedMs);
  });

  it('gives a different round for a different seed, but the same outcome class', () => {
    const other = round('nominal', { seed: 99 }).result;
    expect(other.journalHash).not.toBe(result.journalHash);
    expect(other.status).toBe('completed');
    expect(other.tally.picked).toBe(8);
  });
});

describe('ARACNID egg round — reach, quorum and abstention', () => {
  it('meets the quorum on a reach-limited straight nest run, with abstentions', () => {
    const { result } = round('nominal', { nestLayout: 'straight' });
    expect(result.status).toBe('completed');
    const join = payload(only(result, 'join.completed'));
    // A single straight run puts two of the eight shoulders out of reach; the
    // global assignment still fills six hands, which is exactly the quorum.
    expect(join['succeeded']).toBe(6);
    expect(join['abstained']).toBe(2);
    expect(result.tally).toMatchObject({ offered: 6, picked: 6, placed: 6, abstained: 2 });
    // The abstaining hands said so, rather than reporting a pick they never made.
    expect(result.journal.filter((event) => event.kind === 'observation.abstained')).toHaveLength(
      2,
    );
  });

  it('refuses to call abstentions success when there are fewer eggs than hands', () => {
    const { result } = round('fewer-eggs-than-hands');
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(EXIT_CODES.executionFailed);
    const join = payload(only(result, 'join.completed'));
    expect(join['policy']).toBe('quorum');
    expect(join['required']).toBe(6);
    expect(join['succeeded']).toBeLessThan(6);
    // Counting abstentions would have made this join pass. It must not.
    expect(Number(join['succeeded']) + Number(join['abstained'])).toBeGreaterThanOrEqual(6);
    const fault = payload(only(result, 'fault.entered'));
    expect(fault['code']).toBe('E_QUORUM_UNMET');
    expect(fault['inhibited']).toBe(false);
    expect(result.errorCode).toBe('EGGS_ROUND_ABORTED');
  });

  it('aborts on a low-confidence scan before any hand moves', () => {
    const { result } = round('low-confidence');
    expect(result.status).toBe('aborted');
    expect(result.exitCode).toBe(EXIT_CODES.executionFailed);
    expect(result.errorCode).toBe('E_TASK_ABORTED');
    expect(result.tally.picked).toBe(0);
    const abstained = result.journal.filter((event) => event.kind === 'observation.abstained');
    expect(abstained.length).toBeGreaterThan(0);
    expect(
      result.journal.filter(
        (event) =>
          event.kind === 'action.dispatched' &&
          ['pick_egg.v1', 'place_egg.v1'].includes(String(payload(event)['capability'])),
      ),
    ).toHaveLength(0);
  });
});

describe('ARACNID egg round — faults the round survives', () => {
  it('treats a lost seal as a mismatch, and the quorum carries the round', () => {
    const { result } = round('seal-loss');
    expect(result.status).toBe('completed');
    expect(result.tally).toMatchObject({ offered: 8, picked: 7, placed: 7 });
    const mismatch = payload(only(result, 'action.mismatch'));
    expect(String(mismatch['reason'])).toMatch(/vacuum/);
    const join = payload(only(result, 'join.completed'));
    expect(join['failed']).toBe(1);
    expect(join['succeeded']).toBe(7);
    // The egg was left in the nest, not dropped in the aisle.
    expect(result.safety.tripped).toEqual([]);
  });

  it('records a cracked egg against the robot and keeps going', () => {
    const { result } = round('cracked-egg');
    expect(result.status).toBe('completed');
    expect(result.tally.cracked).toBe(1);
    expect(result.tally.picked).toBe(7);
    expect(result.journal.filter((event) => event.kind === 'action.mismatch')).toHaveLength(1);
  });

  it('retries a full magazine exactly once, then faults', () => {
    const { result } = round('magazine-full');
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(EXIT_CODES.executionFailed);
    expect(result.errorCode).toBe('EGGS_ROUND_ABORTED');
    // max_retries = 1 count in the task: one dispatch plus one retry.
    expect(result.journal.filter((event) => event.kind === 'action.mismatch')).toHaveLength(2);
    expect(result.journal.filter((event) => event.kind === 'action.retry')).toHaveLength(1);
    expect(result.safety.state).toBe('SAFE_STOP');
  });
});

describe('ARACNID egg round — safety inhibition (exit 4)', () => {
  it('stops when a worker walks into the cell (SF-AR-07)', () => {
    const { result } = round('worker-presence');
    expect(result.status).toBe('inhibited');
    expect(result.exitCode).toBe(EXIT_CODES.safetyInhibited);
    expect(result.safety.state).toBe('SAFE_STOP');
    expect(result.safety.tripped).toContain('SF-AR-07');
    const inhibited = result.journal.filter((event) => event.kind === 'safety.inhibited');
    expect(inhibited.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload(inhibited[0]!))).toMatch(/SF-AR-07/);
    expect(result.checkpoint?.safetyStop).toBe(true);
  });

  it('breaches the task guard before the tip-over function trips (SF-AR-08)', () => {
    const { result } = round('tilt-breach');
    expect(result.status).toBe('inhibited');
    expect(result.exitCode).toBe(EXIT_CODES.safetyInhibited);
    expect(result.journal.filter((event) => event.kind === 'guard.breached')).toHaveLength(1);
    const fault = payload(only(result, 'fault.entered'));
    expect(fault['code']).toBe('E_GUARD_BREACH');
    expect(fault['inhibited']).toBe(true);
    // Defence in depth: the guard is set at 4 deg, the safety function at 6 deg.
    const tilt = Math.max(...result.twinFrames.map((frame) => frame.carrier.tilt));
    expect(tilt).toBeGreaterThanOrEqual(4);
    expect(tilt).toBeLessThan(6);
    expect(result.safety.tripped).not.toContain('SF-AR-08');
    // The fault clause still ran: arms held, tool energy removed, operator told.
    expect(result.journal.some((event) => payload(event)['capability'] === 'park_tool')).toBe(true);
    expect(result.journal.filter((event) => event.kind === 'notify.sent')).toHaveLength(1);
  });

  it('refuses to arm when the safety telemetry is stale (SF-AR-09)', () => {
    const { result } = round('nominal', { faults: [{ atMs: 0, kind: 'heartbeat_gap' }] });
    expect(result.status).toBe('inhibited');
    expect(result.exitCode).toBe(EXIT_CODES.safetyInhibited);
    expect(result.errorCode).toBe('E_PREFLIGHT_FAILED');
    expect(result.journal.filter((event) => event.kind === 'preflight.failed')).toHaveLength(1);
    expect(String(payload(only(result, 'preflight.failed'))['reason'])).toMatch(/stale/i);
    expect(result.journal.filter((event) => event.kind === 'statement.entered')).toHaveLength(0);
  });

  it('refuses a hand over the force limit at permit time, and the quorum absorbs it', () => {
    // The overrun lands while the eight picks are still running.
    const { result } = round('nominal', {
      faults: [{ atMs: 5000, kind: 'force_overrun', hand: 4 }],
    });
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(EXIT_CODES.success);
    const denied = result.journal.filter((event) => event.kind === 'permit.denied');
    expect(denied).toHaveLength(1);
    expect(payload(denied[0]!)['holder']).toBe('mission/picks/h4');
    expect(JSON.stringify(payload(denied[0]!))).toMatch(/SF-AR-03/);
    const join = payload(only(result, 'join.completed'));
    expect(join['succeeded']).toBe(7);
    expect(join['failed']).toBe(1);
    expect(result.tally.picked).toBe(7);
  });

  it('stops the round when the same overrun lands during placement', () => {
    // The egg is already in the hand, so the pick post-condition fails and the
    // placement permit is refused: an inhibiting fault, not a tolerated branch.
    const { result } = round('nominal', {
      faults: [{ atMs: 6500, kind: 'force_overrun', hand: 4 }],
    });
    expect(result.status).toBe('inhibited');
    expect(result.exitCode).toBe(EXIT_CODES.safetyInhibited);
    const fault = payload(only(result, 'fault.entered'));
    expect(fault['code']).toBe('E_PERMIT_DENIED');
    expect(fault['inhibited']).toBe(true);
    expect(result.tally['placed'] ?? 0).toBeLessThan(result.tally['picked'] ?? 0);
    expect(result.safety.state).toBe('SAFE_STOP');
  });
});

// ---------------------------------------------------------------------------
// Suspension, resume and idempotency — the Sapo lineage's "suspension is data"
// property, on a small scripted task rather than on the eight-hand round.
// ---------------------------------------------------------------------------

const PROBE_TASK = `
meta {
  owner "livestock-systems";
  change_ticket "AGR-TEST-001";
  description "Suspension and resume probe for the engine test suite.";
  tags "test";
}

task resume-probe@1.0.0 {
  requires {
    cassette EG-08 with scan_nest.v1;
    operator supervisor_on_site;
    zones lay-house-3;
    route lay-house-3 commissioned;
    calibration sha256:b4b632b99fff2c8f1f0449da1dafa94d79ab5d6a92ecc477c9540cc5a12751c9;
  }

  limits {
    travel_speed  = 0.15 m/s;
    task_deadline = 10 min;
    max_retries   = 0 count;
  }

  preflight {
    cassette.id == "EG-08"    @ within 500 ms;
    cassette.latch == #LOCKED @ within 500 ms;
  }

  steps {
    look: observe scan_nest.v1 (bank = "nest_bank_3", min_confidence = 0.5) into $nest;
    ask:  await operator "continue the probe round?" reply $answer within 30 s on_timeout fault;
    note: record probe.answered { answer = $answer; };
    done: finish success message = "probe complete";
  }

  on_fault {
    stop: safe_stop reason = "probe faulted";
    end:  finish failed PROBE_FAULT message = "probe faulted";
  }

  evidence {
    retain journal;
    retention_days 30;
  }
}
`;

const DOSE_TASK = `
meta {
  owner "farm-ops";
  change_ticket "AGR-TEST-002";
  description "Idempotent replay probe: a half-finished loop restarts from its head.";
  tags "test";
}

task dose-probe@1.0.0 {
  requires {
    cassette FD-01 with dispense_mass.v1;
    operator supervisor_on_site;
    zones house-3-feed-lane;
    route house-3-feed-lane commissioned;
    calibration sha256:9fa67484ddac3e44bb36a36514f645612de0458a29968f594e9f00e5e8fd75ba;
  }

  limits {
    travel_speed  = 0.40 m/s;
    task_deadline = 10 min;
    max_retries   = 1 count;
  }

  preflight {
    cassette.id == "FD-01"    @ within 500 ms;
    cassette.latch == #LOCKED @ within 500 ms;
  }

  steps {
    doses: for_each $stop in route.house_3_feed_lane.stops at_most 4 {
      dose: with_permit tool_energy on tool[dispenser] for 60 s {
        pour: actuate dispense_mass.v1 (station = $stop.id, mass = $stop.mass, rate = 0.30 kg/s)
              within 30 s
              verify { tool.dispensed_mass >= 1 kg @ within 2 s; }
              on_mismatch fault
              idempotency_key task.run_id + ":" + $stop.id;
      };
      ask: await operator "next station?" reply $go within 20 s on_timeout fault;
    } on_exhausted fault;
    done: finish success message = "dosing complete";
  }

  on_fault {
    stop: safe_stop reason = "dose probe faulted";
    end:  finish failed DOSE_FAULT message = "dose probe faulted";
  }

  evidence {
    retain journal, scale_trace;
    retention_days 30;
  }
}
`;

function scriptedWorld(cassetteId = 'EG-08'): ScriptedWorld {
  const world = new ScriptedWorld({
    carrierId: 'AR-01',
    cassetteId,
    capabilities: ['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1', 'dispense_mass.v1'],
    tree: {
      route: {
        house_3_feed_lane: {
          commissioned: true,
          stops: [
            { id: 'stop-1', mass: { value: 2, unit: 'kg' } },
            { id: 'stop-2', mass: { value: 3, unit: 'kg' } },
          ],
        },
      },
      tool: { dispensed_mass: { value: 2, unit: 'kg' } },
      operator: { present: true },
    } as Record<string, RuntimeValue>,
  });
  return world;
}

describe('suspension and resume', () => {
  const probe = compileAgriTaskSource(PROBE_TASK);

  it('suspends on an operator await and carries the cursor in the checkpoint', () => {
    const world = scriptedWorld();
    const result = runMission({
      compiled: probe,
      world,
      runId: 'run-probe',
      host: { operator: () => 'suspend' },
    });
    expect(result.status).toBe('suspended');
    expect(result.exitCode).toBe(EXIT_CODES.suspended);
    expect(result.checkpoint?.cursor.statementId).toBe('ask');
    expect(result.checkpoint?.status).toBe('suspended');
    expect(result.journal.filter((event) => event.kind === 'await.suspended')).toHaveLength(1);
    expect(result.journal.filter((event) => event.kind === 'checkpoint.saved')).toHaveLength(1);
  });

  it('resumes from the suspended statement and binds the operator reply', () => {
    const world = scriptedWorld();
    const first = runMission({
      compiled: probe,
      world,
      runId: 'run-probe',
      host: { operator: () => 'suspend' },
    });
    const resumed = resumeMission(first.checkpoint!, {
      compiled: probe,
      world,
      runId: 'run-probe',
      host: { operator: () => ({ reply: 'yes' }) },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.exitCode).toBe(EXIT_CODES.success);
    const record = payload(only(resumed, 'record.emitted'));
    expect((record['fields'] as Record<string, unknown>)['answer']).toBe('yes');
    // The suspended statement was re-entered, not skipped.
    expect(resumed.journal.filter((event) => event.kind === 'await.armed')).toHaveLength(1);
  });

  it('refuses to auto-resume after a safe stop', () => {
    const { result } = round('worker-presence');
    expect(result.checkpoint?.safetyStop).toBe(true);
    expect(() =>
      resumeMission(result.checkpoint!, {
        compiled: compiledAracnid,
        world: new AracnidWorld({ scenario: 'nominal', seed: 7 }),
        runId: 'run-nominal',
      }),
    ).toThrowError(MissionError);
    try {
      resumeMission(result.checkpoint!, {
        compiled: compiledAracnid,
        world: new AracnidWorld({ scenario: 'nominal', seed: 7 }),
        runId: 'run-nominal',
      });
      expect.unreachable('resume should have been refused');
    } catch (error) {
      expect((error as MissionError).code).toBe('E_RESUME_AFTER_SAFE_STOP');
    }
  });

  it('refuses to resume against a task that no longer compiles to the same IR', () => {
    const world = scriptedWorld();
    const first = runMission({
      compiled: probe,
      world,
      runId: 'run-probe',
      host: { operator: () => 'suspend' },
    });
    const tampered = { ...first.checkpoint!, irHash: 'sha256:' + '0'.repeat(64) };
    try {
      resumeMission(tampered, { compiled: probe, world, runId: 'run-probe' });
      expect.unreachable('resume should have been refused');
    } catch (error) {
      expect((error as MissionError).code).toBe('E_RESUME_IR_MISMATCH');
    }
  });

  it('re-runs the preflight on resume and refuses a machine that changed', () => {
    const world = scriptedWorld();
    const first = runMission({
      compiled: probe,
      world,
      runId: 'run-probe',
      host: { operator: () => 'suspend' },
    });
    // Someone swapped the cassette while the mission was suspended.
    world.set('cassette.id', 'FD-01');
    const resumed = resumeMission(first.checkpoint!, {
      compiled: probe,
      world,
      runId: 'run-probe',
    });
    expect(resumed.status).toBe('inhibited');
    expect(resumed.exitCode).toBe(EXIT_CODES.safetyInhibited);
    expect(resumed.errorCode).toBe('E_PREFLIGHT_FAILED');
  });
});

describe('idempotency across a restart of a half-finished block', () => {
  const dose = compileAgriTaskSource(DOSE_TASK);

  it('replays a keyed action instead of dosing twice', () => {
    const world = scriptedWorld('FD-01');
    let asks = 0;
    const first = runMission({
      compiled: dose,
      world,
      runId: 'run-dose',
      host: {
        operator: () => {
          asks += 1;
          return asks === 1 ? 'suspend' : { reply: 'go' };
        },
      },
    });
    expect(first.status).toBe('suspended');
    expect(
      first.journal.filter(
        (event) =>
          event.kind === 'action.dispatched' && payload(event)['capability'] === 'dispense_mass.v1',
      ),
    ).toHaveLength(1);

    const resumed = resumeMission(first.checkpoint!, {
      compiled: dose,
      world,
      runId: 'run-dose',
      host: { operator: () => ({ reply: 'go' }) },
    });
    expect(resumed.status).toBe('completed');
    // The for_each restarted from its head, so station one was re-entered —
    // and replayed from its idempotency key rather than dosed a second time.
    const replayed = resumed.journal.filter((event) => event.kind === 'action.idempotent_replay');
    expect(replayed).toHaveLength(1);
    expect(payload(replayed[0]!)['idempotencyKey']).toBe('run-dose:stop-1');
    const dispatched = resumed.journal.filter(
      (event) =>
        event.kind === 'action.dispatched' && payload(event)['capability'] === 'dispense_mass.v1',
    );
    expect(dispatched).toHaveLength(1);
    expect(resumed.journal.filter((event) => event.kind === 'action.verified')).toHaveLength(2);
  });
});

describe('time and visit budgets', () => {
  // A deadline shorter than one inner action budget does not compile at all:
  // the three nested time budgets are checked against each other up front.
  it('refuses a task deadline shorter than a statement budget', () => {
    expect(() =>
      compileAgriTaskSource(PROBE_TASK.replace('task_deadline = 10 min', 'task_deadline = 1 s')),
    ).toThrowError(TaskValidationError);
    expect(() =>
      compileAgriTaskSource(PROBE_TASK.replace('task_deadline = 10 min', 'task_deadline = 1 s')),
    ).toThrowError(/exceeds the task deadline/);
  });

  it('fails a round that runs past its task deadline, and still runs the fault clause', () => {
    const late = compileAgriTaskSource(
      PROBE_TASK.replace('task_deadline = 10 min', 'task_deadline = 35 s'),
    );
    expect(late.issues).toEqual([]);
    const world = new ScriptedWorld({
      capabilities: ['scan_nest.v1'],
      defaultDurationMs: 40_000,
      tree: { operator: { present: true } } as Record<string, RuntimeValue>,
    });
    const result = runMission({
      compiled: late,
      world,
      runId: 'run-late',
      host: { operator: () => ({ reply: 'go' }) },
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(EXIT_CODES.executionFailed);
    // The task's own fault clause named the outcome; the cause stays in the journal.
    expect(result.errorCode).toBe('PROBE_FAULT');
    expect(payload(only(result, 'fault.entered'))['code']).toBe('E_TASK_DEADLINE');
    expect(
      result.journal.filter((event) => event.kind === 'statement.entered').length,
    ).toBeGreaterThan(2);
  });

  it('stops after the visit budget rather than looping forever', () => {
    const world = scriptedWorld();
    const result = runMission({
      compiled: compileAgriTaskSource(PROBE_TASK),
      world,
      runId: 'run-budget',
      maxVisits: 2,
      host: { operator: () => ({ reply: 'go' }) },
    });
    expect(result.status).toBe('failed');
    expect(payload(only(result, 'fault.entered'))['code']).toBe('E_VISIT_BUDGET');
    expect(result.errorCode).toBe('PROBE_FAULT');
  });
});
