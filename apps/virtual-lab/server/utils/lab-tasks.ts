import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DSL_EXAMPLES_DIR, repoFile } from '@agrirobots/compiler-core';

import type { LabTaskSummary } from '../../shared/lab-types';

/**
 * The tasks the lab may load, and the only ones it may load.
 *
 * Paths never come from the browser: a request names an id, and the id resolves
 * against this list. `worlds` says which world model can execute the task — a
 * task with no world can still be compiled, reviewed and hashed here, but it
 * cannot be run, because running it would need a machine the repository has not
 * modelled yet.
 */
export const LAB_TASKS: readonly LabTaskSummary[] = [
  {
    id: 'aracnid-egg-collection',
    file: 'aracnid-egg-collection.agri',
    title: 'ARACNID egg-collection round',
    robot: 'AR-01 rover + EG-08 eight-hand cassette',
    summary:
      'Scan the nest bank, fan eight picks out in parallel under a quorum join, then serialise placement into the six-tray magazine. The reference task for the kinematic twin.',
    worlds: ['aracnid'],
  },
  {
    id: 'guarded-early-weeding',
    file: 'guarded-early-weeding.agri',
    title: 'Guarded early weeding',
    robot: 'WD-01 (sensing-only until the actuation gate)',
    summary:
      'Row loop with a plant-inspection guard and a gated mechanical weed action. Shown as a compiled artifact: no WD-01 world model exists yet.',
    worlds: [],
  },
  {
    id: 'poultry-evening-feed',
    file: 'poultry-evening-feed.agri',
    title: 'Evening feed round',
    robot: 'AP-01 + FD-01 feeder cassette',
    summary:
      'Load-cell verified dosing along a commissioned route, with retry and idempotency keys per station. Shown as a compiled artifact: no FD-01 world model exists yet.',
    worlds: [],
  },
];

export function findLabTask(id: unknown): LabTaskSummary | undefined {
  if (typeof id !== 'string') return undefined;
  return LAB_TASKS.find((task) => task.id === id);
}

/** Reads a task source from the committed example set — never from user input. */
export function readLabTaskSource(task: LabTaskSummary): string {
  return readFileSync(path.join(repoFile(DSL_EXAMPLES_DIR), task.file), 'utf8');
}
