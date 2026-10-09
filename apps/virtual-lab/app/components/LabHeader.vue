<script setup lang="ts">
import { computed } from 'vue';

import { EXIT_CODE_MEANINGS } from '../shared/safety-functions';
import type { Lab } from '../composables/useLab';

const props = defineProps<{ lab: Lab }>();

const run = computed(() => props.lab.run);

const statusTone = computed(() => {
  switch (run.value?.run.status) {
    case 'completed':
      return 'pill-ok';
    case 'inhibited':
      return 'pill-danger';
    case 'failed':
      return 'pill-danger';
    case 'aborted':
      return 'pill-warn';
    case 'suspended':
      return 'pill-accent';
    default:
      return 'pill-muted';
  }
});

const exitMeaning = computed(() => {
  const code = run.value?.run.exitCode;
  return code === undefined ? 'no run yet' : (EXIT_CODE_MEANINGS[code] ?? 'unknown exit code');
});

function shortHash(hash: string | undefined): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}
</script>

<template>
  <header class="lab-header">
    <div class="brand">
      <strong>AgriRobots Virtual Lab</strong>
      <span>agri.task/v1 · compiled on the server · executed against a kinematic twin</span>
    </div>

    <div class="spacer" />

    <div class="header-facts">
      <div class="fact">
        <span class="label">Task</span>
        <span class="value"
          >{{ run?.compiled.taskName ?? lab.taskId }}@{{ run?.compiled.taskVersion ?? '—' }}</span
        >
      </div>
      <div class="fact">
        <span class="label">IR hash</span>
        <span class="value" :title="run?.compiled.irHash">{{
          shortHash(run?.compiled.irHash)
        }}</span>
      </div>
      <div class="fact">
        <span class="label">Journal hash</span>
        <span class="value" :title="run?.run.journalHash">{{
          shortHash(run?.run.journalHash)
        }}</span>
      </div>
      <div class="fact">
        <span class="label">Determinism</span>
        <span class="value">
          <span
            v-if="lab.determinism"
            class="pill"
            :class="lab.determinism === 'identical' ? 'pill-ok' : 'pill-danger'"
          >
            {{ lab.determinism === 'identical' ? 'same inputs → same hash' : 'hash diverged' }}
          </span>
          <span v-else class="pill pill-muted">run twice to compare</span>
        </span>
      </div>
      <div class="fact">
        <span class="label">Outcome</span>
        <span class="value">
          <span class="pill" :class="statusTone" :title="exitMeaning">
            <i class="dot" />
            {{ run?.run.status ?? 'idle' }} · exit {{ run?.run.exitCode ?? '—' }}
          </span>
        </span>
      </div>
    </div>
  </header>
</template>
