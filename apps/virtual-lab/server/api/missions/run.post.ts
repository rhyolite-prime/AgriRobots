import { createError, defineEventHandler, readBody } from 'h3';

import {
  ARACNID,
  AracnidWorld,
  DEFAULT_MISSION_EPOCH_MS,
  runMission,
  type AracnidFault,
  type AracnidScenario,
} from '@agrirobots/engine';
import { compileAgriTaskSource } from '@agrirobots/policy';

import { toJournalLine } from '../../../app/shared/journal-lines';
import type { LabFaultRequest, RunRequest, RunResponse } from '../../../app/shared/lab-types';
import { ARACNID_FAULT_KINDS, isFaultKind, isScenario } from '../../../app/shared/scenarios';
import { toCompiledSummary } from '../../utils/compiled-summary';
import { labError } from '../../utils/errors';
import { findLabTask, readLabTaskSource } from '../../utils/lab-tasks';

const DEFAULT_SEED = 20261009;

function refuse(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, statusMessage: code, message });
}

function positiveInteger(value: unknown, fallback: number, ceiling: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(ceiling, Math.max(1, Math.trunc(value)));
}

function toFaults(input: unknown): AracnidFault[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input))
    refuse(400, 'E_LAB_FAULTS', 'faults must be an array of injected faults');
  return input.map((entry, index): AracnidFault => {
    const fault = entry as Partial<LabFaultRequest>;
    const kind = typeof fault.kind === 'string' ? fault.kind : '';
    if (!isFaultKind(kind)) {
      refuse(
        400,
        'E_LAB_FAULT_KIND',
        `faults[${String(index)}].kind "${kind}" is not modelled by the ARACNID world`,
      );
    }
    const atMs =
      typeof fault.atMs === 'number' && Number.isFinite(fault.atMs)
        ? Math.max(0, Math.trunc(fault.atMs))
        : 0;
    const takesHand =
      ARACNID_FAULT_KINDS.find((candidate) => candidate.id === kind)?.takesHand ?? false;
    const hand = typeof fault.hand === 'number' ? Math.trunc(fault.hand) : undefined;
    if (takesHand && (hand === undefined || hand < 1 || hand > ARACNID.handCount)) {
      refuse(
        400,
        'E_LAB_FAULT_HAND',
        `faults[${String(index)}] needs a hand between 1 and ${String(ARACNID.handCount)}`,
      );
    }
    return { atMs, kind: kind as AracnidFault['kind'], ...(hand === undefined ? {} : { hand }) };
  });
}

/**
 * Compiles the named task and executes it against the ARACNID kinematic twin.
 *
 * Everything physical happens here, in Node, in the same `@agrirobots/engine`
 * that CI tests. The browser receives a journal, twin frames and a summary — it
 * never executes a capability and never decides a safety question.
 */
export default defineEventHandler(async (event): Promise<RunResponse> => {
  const body = (await readBody<Partial<RunRequest>>(event)) ?? {};

  const task = findLabTask(body.taskId);
  if (!task)
    refuse(404, 'E_LAB_TASK_UNKNOWN', `no task "${String(body.taskId ?? '')}" on the lab shelf`);
  if (!task.worlds.includes('aracnid')) {
    refuse(
      422,
      'E_LAB_NO_WORLD',
      `${task.id} can be compiled and reviewed here, but this repository has no world model to execute it against`,
    );
  }

  // The world is a property of the task, not of the request: this lab implements
  // one world model, so anything else is refused rather than silently substituted.
  const worldId = body.world ?? 'aracnid';
  if (worldId !== 'aracnid') {
    refuse(
      422,
      'E_LAB_WORLD_UNSUPPORTED',
      `this lab executes the "aracnid" world; "${worldId}" has no world model in this repository`,
    );
  }
  if (!task.worlds.includes(worldId)) {
    refuse(422, 'E_LAB_WORLD_MISMATCH', `${task.id} is not written for the "${worldId}" world`);
  }

  const scenario = typeof body.scenario === 'string' ? body.scenario : 'nominal';
  if (!isScenario(scenario))
    refuse(400, 'E_LAB_SCENARIO_UNKNOWN', `scenario "${scenario}" is not modelled`);

  const nestLayout = body.nestLayout ?? 'arc';
  if (nestLayout !== 'arc' && nestLayout !== 'straight') {
    refuse(400, 'E_LAB_LAYOUT_UNKNOWN', `nestLayout must be "arc" or "straight"`);
  }

  const seed = positiveInteger(body.seed, DEFAULT_SEED, Number.MAX_SAFE_INTEGER);
  const faults = toFaults(body.faults);
  const maxVisits =
    body.maxVisits === undefined ? undefined : positiveInteger(body.maxVisits, 5000, 100_000);
  const eggsInBank =
    body.eggsInBank === undefined ? undefined : positiveInteger(body.eggsInBank, 16, 240);

  const source = readLabTaskSource(task);
  let compiled;
  try {
    compiled = compileAgriTaskSource(source);
  } catch (error) {
    throw labError(422, error);
  }

  // A stable run id keeps the journal hash a function of the inputs alone, so
  // running the same configuration twice proves determinism instead of hiding it.
  const runId = `lab-${task.id}-${scenario}-${String(seed)}-${nestLayout}`;
  const world = new AracnidWorld({
    scenario: scenario as AracnidScenario,
    seed,
    nestLayout,
    faults,
    ...(eggsInBank === undefined ? {} : { eggsInBank }),
  });

  const startedAt = process.hrtime.bigint();
  let result;
  try {
    result = runMission({
      compiled,
      world,
      runId,
      epochMs: DEFAULT_MISSION_EPOCH_MS,
      ...(maxVisits === undefined ? {} : { maxVisits }),
      ...(body.preflight === false ? { preflight: false } : {}),
    });
  } catch (error) {
    throw labError(500, error);
  }
  const wallMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return {
    wallMs: Number(wallMs.toFixed(2)),
    run: {
      runId: result.runId,
      status: result.status,
      exitCode: result.exitCode,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.message ? { message: result.message } : {}),
      elapsedMs: result.elapsedMs,
      visits: result.visits,
      tally: { ...result.tally },
      safety: {
        state: result.safety.state,
        tripped: [...result.safety.tripped],
        inhibited: result.safety.inhibited,
        reasons: [...result.safety.reasons],
      },
      journalHash: result.journalHash,
      ...(result.suspended ? { suspended: result.suspended } : {}),
    },
    compiled: toCompiledSummary(compiled),
    source,
    journal: result.journal.map((entry) => toJournalLine(entry, DEFAULT_MISSION_EPOCH_MS)),
    frames: result.twinFrames,
    world: {
      id: 'aracnid',
      scenario,
      seed,
      nestLayout,
      describe: world.describe(),
      geometry: { ...ARACNID },
    },
    checkpoint: {
      version: result.checkpoint.version,
      status: result.checkpoint.status,
      cursor: {
        statementId: result.checkpoint.cursor.statementId,
        path: [...result.checkpoint.cursor.path],
      },
      clockMs: result.checkpoint.clockMs,
      visits: result.checkpoint.visits,
      safetyStop: result.checkpoint.safetyStop,
      completedKeys: [...result.checkpoint.completedKeys],
      variables: result.checkpoint.variables as Record<string, unknown>,
    },
    epochMs: DEFAULT_MISSION_EPOCH_MS,
  };
});
