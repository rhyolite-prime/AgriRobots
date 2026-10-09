import { computed } from 'vue';

import { inTimeOrder } from '../shared/journal-lines';
import type { JournalLine, TwinFrameData } from '../shared/lab-types';
import {
  deriveSafetyView,
  frameAt,
  visitedStatements,
  type SafetyView,
} from '../shared/safety-view';
import type { Lab } from './useLab';
import type { Playback } from './usePlayback';

/**
 * One derivation of "where the mission is now", shared by every panel so the
 * viewport, the safety view and the journal cannot disagree about the instant
 * they are showing.
 */
export function useRunTimeline(lab: Lab, playback: Playback) {
  /** Twin frames, ordered by mission time by `runMission`. */
  const frames = computed<TwinFrameData[]>(() => lab.run?.frames ?? []);
  /** The journal as the engine wrote it: causal order, the audit record. */
  const journal = computed<JournalLine[]>(() => lab.run?.journal ?? []);
  /** The same rows in mission-time order, for everything that scrubs by time. */
  const timeline = computed<JournalLine[]>(() => inTimeOrder(journal.value));
  const duration = computed(() => lab.run?.run.elapsedMs ?? 0);

  const currentFrame = computed<TwinFrameData | null>(
    () => frameAt(frames.value, playback.t).frame,
  );

  const safety = computed<SafetyView>(() =>
    deriveSafetyView(journal.value, playback.t, currentFrame.value),
  );

  /** Journal up to the playhead: what had happened by then, and only that. */
  const linesUpTo = computed<JournalLine[]>(() =>
    timeline.value.filter((line) => line.t <= playback.t),
  );

  /** The statement being executed at the playhead, in the order the interpreter entered them. */
  const currentStatement = computed<{ id: string; kind: string } | null>(() => {
    let found: { id: string; kind: string } | null = null;
    for (const line of journal.value) {
      if (line.t > playback.t) continue;
      if (line.kind === 'statement.entered' && line.statementId) {
        found = { id: line.statementId, kind: String(line.payload['kind'] ?? '') };
      }
    }
    return found;
  });

  const visited = computed<string[]>(() => visitedStatements(journal.value, playback.t));

  const newestLine = computed<JournalLine | null>(() => {
    const lines = linesUpTo.value;
    return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
  });

  return {
    frames,
    journal,
    timeline,
    duration,
    currentFrame,
    safety,
    linesUpTo,
    currentStatement,
    visited,
    newestLine,
  };
}

export type RunTimeline = ReturnType<typeof useRunTimeline>;
