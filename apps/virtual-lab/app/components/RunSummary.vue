<script setup lang="ts">
import { computed } from 'vue';

import { EXIT_CODE_MEANINGS } from '../shared/safety-functions';
import type { Lab } from '../composables/useLab';

const props = defineProps<{ lab: Lab }>();

const run = computed(() => props.lab.run?.run ?? null);
const world = computed(() => props.lab.run?.world ?? null);
const checkpoint = computed(() => props.lab.run?.checkpoint ?? null);

const TALLY_ORDER = ['offered', 'picked', 'placed', 'cracked', 'abstained', 'rejected'];

const tally = computed(() => {
  const values = run.value?.tally ?? {};
  const keys = [
    ...TALLY_ORDER.filter((key) => key in values),
    ...Object.keys(values).filter((key) => !TALLY_ORDER.includes(key)),
  ];
  return keys.map((key) => ({ key, value: values[key] ?? 0 }));
});

function tallyTone(key: string, value: number): string {
  if (value === 0) return '';
  if (key === 'cracked') return 'color: #f0a79e';
  if (key === 'rejected' || key === 'abstained') return 'color: #efd09a';
  if (key === 'placed' || key === 'picked') return 'color: #9fdcb4';
  return '';
}

const statusTone = computed(() => {
  switch (run.value?.status) {
    case 'completed':
      return 'pill-ok';
    case 'aborted':
    case 'suspended':
      return 'pill-warn';
    case 'failed':
    case 'inhibited':
      return 'pill-danger';
    default:
      return 'pill-muted';
  }
});

const worldFacts = computed(() => {
  const describe = world.value?.describe ?? {};
  return Object.entries(describe).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));
});
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>Run outcome</h2>
      <span v-if="run" class="pill" :class="statusTone">
        <i class="dot" />
        {{ run.status }} · exit {{ run.exitCode }}
      </span>
    </div>

    <div class="panel-body">
      <div v-if="!run" class="empty">Nothing has run yet.</div>

      <template v-else>
        <p class="hint" style="margin: 0">
          {{ EXIT_CODE_MEANINGS[run.exitCode] ?? 'unknown exit code' }}
        </p>

        <div
          v-if="run.errorCode || run.message"
          class="notice"
          :class="run.status === 'completed' ? '' : 'notice-warn'"
        >
          <strong v-if="run.errorCode" class="mono">{{ run.errorCode }}</strong>
          <span v-if="run.errorCode && run.message"> — </span>
          <span>{{ run.message }}</span>
        </div>

        <div v-if="run.suspended" class="notice">
          Suspended at <span class="mono">{{ run.suspended.statementId }}</span> waiting for
          {{ run.suspended.reason
          }}<span v-if="run.suspended.prompt">: “{{ run.suspended.prompt }}”</span>. The checkpoint
          carries the cursor, the clock and the variables — resume is a deliberate act, not a
          thread.
        </div>

        <div class="tally">
          <div v-for="cell in tally" :key="cell.key" class="tally-cell">
            <span class="tally-label">{{ cell.key }}</span>
            <span class="tally-value" :style="tallyTone(cell.key, cell.value)">{{
              cell.value
            }}</span>
          </div>
        </div>

        <dl class="kv">
          <dt>Mission clock</dt>
          <dd>{{ (run.elapsedMs / 1000).toFixed(2) }} s</dd>
          <dt>Host wall time</dt>
          <dd>{{ lab.run?.wallMs.toFixed(1) }} ms</dd>
          <dt>Statement visits</dt>
          <dd>{{ run.visits }}</dd>
          <dt>Journal events</dt>
          <dd>{{ lab.run?.journal.length ?? 0 }}</dd>
          <dt>Journal hash</dt>
          <dd :title="run.journalHash">{{ run.journalHash.slice(0, 16) }}…</dd>
          <dt>Safety state</dt>
          <dd>{{ run.safety.state }}</dd>
          <dt>Functions tripped</dt>
          <dd>{{ run.safety.tripped.length > 0 ? run.safety.tripped.join(', ') : 'none' }}</dd>
          <dt>Run id</dt>
          <dd>{{ run.runId }}</dd>
        </dl>

        <div v-if="checkpoint" class="stack">
          <span class="field-label">Checkpoint</span>
          <dl class="kv">
            <dt>Version / status</dt>
            <dd>v{{ checkpoint.version }} · {{ checkpoint.status }}</dd>
            <dt>Cursor</dt>
            <dd>{{ checkpoint.cursor.statementId || '—' }}</dd>
            <dt>Safe stop latched</dt>
            <dd>{{ checkpoint.safetyStop ? 'yes — no auto-resume' : 'no' }}</dd>
            <dt>Idempotency keys</dt>
            <dd>{{ checkpoint.completedKeys.length }}</dd>
          </dl>
        </div>

        <div v-if="worldFacts.length > 0" class="stack">
          <span class="field-label">World</span>
          <dl class="kv">
            <template v-for="fact in worldFacts" :key="fact.key">
              <dt>{{ fact.key }}</dt>
              <dd>{{ fact.value }}</dd>
            </template>
          </dl>
        </div>
      </template>
    </div>
  </section>
</template>
