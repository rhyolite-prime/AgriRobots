<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Lab } from '../composables/useLab';
import type { Playback } from '../composables/usePlayback';
import { useRunTimeline } from '../composables/useRunTimeline';

const props = defineProps<{ lab: Lab; playback: Playback }>();

const { visited } = useRunTimeline(props.lab, props.playback);

const TABS = ['overview', 'statements', 'limits', 'source'] as const;
type Tab = (typeof TABS)[number];
const tab = ref<Tab>('overview');

const compiled = computed(() => props.lab.compiled);
const source = computed(() => props.lab.source);

const statistics = computed(() => {
  const stats = compiled.value?.statistics;
  if (!stats) return [];
  return [
    { label: 'statements', value: String(stats.statementCount) },
    { label: 'actuating', value: String(stats.actuatingStatements) },
    { label: 'permit scopes', value: String(stats.permitScopes) },
    { label: 'guards', value: String(stats.guards) },
    { label: 'parallel branches', value: String(stats.parallelBranches) },
    { label: 'widest join', value: String(stats.maxParallelWidth) },
    { label: 'loop bound', value: String(stats.maxLoopBound) },
    { label: 'retries', value: String(stats.maxRetryAttempts) },
    {
      label: 'task deadline',
      value:
        stats.taskDeadlineMs === null ? 'none' : `${(stats.taskDeadlineMs / 60000).toFixed(0)} min`,
    },
    { label: 'canonical IR', value: `${String(compiled.value?.canonicalBytes ?? 0)} B` },
  ];
});

const sourceLines = computed(() => (source.value || '').split('\n'));
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>Compiled task</h2>
      <div class="tabs">
        <button
          v-for="name in TABS"
          :key="name"
          class="btn btn-small"
          :class="{ 'btn-primary': tab === name }"
          type="button"
          @click="tab = name"
        >
          {{ name }}
        </button>
      </div>
    </div>

    <div class="panel-body scroll" style="max-height: 380px">
      <div v-if="!compiled" class="empty">Nothing compiled yet.</div>

      <template v-else>
        <template v-if="tab === 'overview'">
          <dl class="kv">
            <dt>Task</dt>
            <dd>{{ compiled.taskName }}@{{ compiled.taskVersion }}</dd>
            <dt>IR hash</dt>
            <dd :title="compiled.irHash">{{ compiled.irHash }}</dd>
            <dt>Source hash</dt>
            <dd :title="compiled.sourceHash">{{ compiled.sourceHash }}</dd>
            <dt>Capabilities</dt>
            <dd>{{ compiled.statistics.capabilities.join(', ') || 'none' }}</dd>
            <dt>Resource claims</dt>
            <dd>{{ compiled.statistics.resourceClaims.join(', ') || 'none' }}</dd>
          </dl>
          <div class="tally">
            <div v-for="cell in statistics" :key="cell.label" class="tally-cell">
              <span class="tally-label">{{ cell.label }}</span>
              <span class="tally-value" style="font-size: 15px">{{ cell.value }}</span>
            </div>
          </div>
          <p class="hint" style="margin: 0">
            The hash covers the canonical IR: what the browser shows is byte-for-byte what the edge
            would verify before running.
          </p>
        </template>

        <template v-else-if="tab === 'statements'">
          <table class="table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Kind</th>
                <th>Capability</th>
                <th>Permits / resources</th>
                <th>Inside</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="statement in compiled.statements"
                :key="statement.id"
                :style="visited.includes(statement.id) ? 'background: rgba(78,161,255,0.10)' : ''"
              >
                <td class="mono">{{ statement.id }}</td>
                <td>
                  {{ statement.kind }}
                  <span v-if="statement.label" class="hint">({{ statement.label }})</span>
                </td>
                <td class="mono">{{ statement.capability ?? '—' }}</td>
                <td class="mono">
                  {{
                    [...(statement.permits ?? []), ...(statement.resources ?? [])].join(', ') || '—'
                  }}
                </td>
                <td class="mono hint">{{ statement.parents.join(' / ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint" style="margin: 0">
            Highlighted rows are the statements this run had reached by
            {{ (playback.t / 1000).toFixed(2) }} s.
          </p>
        </template>

        <template v-else-if="tab === 'limits'">
          <div class="stack">
            <span class="field-label">Limits</span>
            <table class="table">
              <tbody>
                <tr v-for="limit in compiled.limits" :key="limit.key">
                  <td class="mono">{{ limit.key }}</td>
                  <td class="num">{{ limit.value }} {{ limit.unit }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="stack">
            <span class="field-label">Preflight conditions</span>
            <ol style="margin: 0; padding-left: 18px; color: var(--text-dim); font-size: 12.5px">
              <li v-for="(condition, index) in compiled.preflight" :key="index" class="mono">
                {{ condition }}
              </li>
            </ol>
            <p class="hint" style="margin: 0">
              Each is read from the world with its own freshness bound before the mission arms. A
              stale read is a refusal, not a guess.
            </p>
          </div>
        </template>

        <template v-else>
          <pre
            class="source"
            style="max-height: 320px"
          ><span v-for="(line, index) in sourceLines" :key="index">{{ String(index + 1).padStart(3, ' ') }}  {{ line }}
</span></pre>
        </template>
      </template>
    </div>
  </section>
</template>
