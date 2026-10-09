import { createError, defineEventHandler, getRouterParam } from 'h3';

import { compileAgriTaskSource } from '@agrirobots/policy';

import type { TaskResponse } from '../../../app/shared/lab-types';
import { toCompiledSummary } from '../../utils/compiled-summary';
import { labError } from '../../utils/errors';
import { findLabTask, readLabTaskSource } from '../../utils/lab-tasks';

/** Source plus compiled summary for one task on the shelf. */
export default defineEventHandler((event): TaskResponse => {
  const task = findLabTask(getRouterParam(event, 'id'));
  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: 'E_LAB_TASK_UNKNOWN',
      message: `no task "${String(getRouterParam(event, 'id'))}" on the lab shelf`,
    });
  }
  const source = readLabTaskSource(task);
  try {
    return { task, source, compiled: toCompiledSummary(compileAgriTaskSource(source)) };
  } catch (error) {
    throw labError(422, error);
  }
});
