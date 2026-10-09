import { defineEventHandler } from 'h3';

import { compileAgriTaskSource } from '@agrirobots/policy';

import { toCompiledSummary } from '../utils/compiled-summary';
import { toLabError } from '../utils/errors';
import { LAB_TASKS, readLabTaskSource } from '../utils/lab-tasks';

/**
 * The task shelf: every committed `agri.task/v1` example, compiled with the same
 * compiler core CI uses, with its hashes and statistics.
 */
export default defineEventHandler(() => {
  return {
    tasks: LAB_TASKS.map((task) => {
      const source = readLabTaskSource(task);
      try {
        return { task, compiled: toCompiledSummary(compileAgriTaskSource(source)), error: null };
      } catch (error) {
        return { task, compiled: null, error: toLabError(error) };
      }
    }),
  };
});
