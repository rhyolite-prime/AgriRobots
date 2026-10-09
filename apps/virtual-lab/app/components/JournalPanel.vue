<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { JournalLine } from '../shared/lab-types';
import { NOISY_KINDS } from '../shared/journal-lines';
import type { Lab } from '../composables/useLab';
import type { Playback } from '../composables/usePlayback';
import { useRunTimeline } from '../composables/useRunTimeline';

const props = defineProps<{ lab: Lab; playback: Playback }>();

const { journal, newestLine } = useRunTimeline(props.lab, props.playback);

const query = ref('');
const hideNoisy = ref(true);
const follow = ref(true);
const selected = ref<number | null>(null);
const list = ref<HTMLElement | null>(null);

const KIND_TONES: Record<string, string> = {
  'mission.completed': 'kind-ok',
  'action.verified': 'kind-ok',
  'permit.granted': 'kind-ok',
  'guard.disarmed': 'kind-ok',
  'mission.failed': 'kind-danger',
  'mission.inhibited': 'kind-danger',
  'safety.inhibited': 'kind-danger',
  'permit.denied': 'kind-danger',
  'resource.denied': 'kind-danger',
  'guard.breached': 'kind-danger',
  'fault.entered': 'kind-danger',
  'action.mismatch': 'kind-danger',
  'deadline.exceeded': 'kind-danger',
  'mission.aborted': 'kind-warn',
  'observation.abstained': 'kind-warn',
  'action.retry': 'kind-warn',
  'branch.cancelled': 'kind-warn',
  'safety.state_changed': 'kind-warn',
  'mode.degraded': 'kind-warn',
};

const rows = computed<JournalLine[]>(() => {
  const needle = query.value.trim().toLowerCase();
  return journal.value.filter((line) => {
    if (hideNoisy.value && NOISY_KINDS.includes(line.kind)) return false;
    if (needle === '') return true;
    return (
      line.kind.toLowerCase().includes(needle) ||
      line.summary.toLowerCase().includes(needle) ||
      (line.statementId ?? '').toLowerCase().includes(needle)
    );
  });
});

const counts = computed(() => {
  const tally = new Map<string, number>();
  for (const line of journal.value) tally.set(line.kind, (tally.get(line.kind) ?? 0) + 1);
  return [...tally.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
});

const selectedLine = computed(
  () => journal.value.find((line) => line.sequence === selected.value) ?? null,
);

function rowClass(line: JournalLine): Record<string, boolean> {
  const now = props.playback.t;
  return {
    past: line.t < now,
    current: newestLine.value?.sequence === line.sequence,
    selected: selected.value === line.sequence,
    [KIND_TONES[line.kind] ?? '']: true,
  };
}

function toggleKind(kind: string): void {
  query.value = query.value === kind ? '' : kind;
}

watch(
  () => props.playback.t,
  async () => {
    if (!follow.value || !list.value) return;
    await nextTick();
    const current = list.value.querySelector<HTMLElement>('.journal-row.current');
    if (current) {
      const box = list.value.getBoundingClientRect();
      const row = current.getBoundingClientRect();
      if (row.bottom > box.bottom || row.top < box.top) {
        list.value.scrollTop += row.top - box.top - box.height / 2;
      }
    }
  },
);
</script>

<template>
  <section class="panel" style="flex: 1; min-height: 260px">
    <div class="panel-head">
      <h2>Journal · {{ journal.length }} events</h2>
      <span class="pill pill-muted">hash {{ lab.run?.run.journalHash.slice(0, 10) ?? '—' }}…</span>
    </div>

    <div class="panel-body" style="gap: 7px">
      <div class="filter-row">
        <input
          v-model="query"
          type="search"
          placeholder="filter by kind, statement or text"
          style="flex: 1"
        />
        <label class="checkbox"
          ><input v-model="hideNoisy" type="checkbox" /> hide {{ NOISY_KINDS.length }} noisy
          kinds</label
        >
        <label class="checkbox"><input v-model="follow" type="checkbox" /> follow</label>
      </div>
      <div class="filter-row">
        <button
          v-for="[kind, count] in counts"
          :key="kind"
          class="chip"
          :class="{ active: query === kind }"
          type="button"
          @click="toggleKind(kind)"
        >
          {{ kind }} · {{ count }}
        </button>
      </div>
    </div>

    <div ref="list" class="panel-body scroll" style="flex: 1; padding-top: 4px">
      <div v-if="journal.length === 0" class="empty">No journal yet — run the round.</div>
      <div v-else-if="rows.length === 0" class="empty">Nothing matches “{{ query }}”.</div>
      <div v-else class="journal">
        <div
          v-for="line in rows"
          :key="line.sequence"
          class="journal-row"
          :class="rowClass(line)"
          :title="line.timestamp"
          @click="selected = selected === line.sequence ? null : line.sequence"
        >
          <span class="journal-t">{{ (line.t / 1000).toFixed(2) }}</span>
          <span class="journal-kind">{{ line.kind }}</span>
          <span class="journal-summary">{{ line.summary }}</span>
        </div>
      </div>

      <pre v-if="selectedLine" class="source" style="max-height: 220px">{{
        JSON.stringify(selectedLine.payload, null, 2)
      }}</pre>
    </div>

    <div class="panel-foot">
      Sequence is strictly increasing and the hash covers every event: a gap is data loss, and the
      hash is the identity of the run.
    </div>
  </section>
</template>
