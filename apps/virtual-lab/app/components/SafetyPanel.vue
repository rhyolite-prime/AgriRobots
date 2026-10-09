<script setup lang="ts">
import { computed } from 'vue';

import { SAFETY_FUNCTIONS } from '../shared/safety-functions';
import type { Lab } from '../composables/useLab';
import type { Playback } from '../composables/usePlayback';
import { useRunTimeline } from '../composables/useRunTimeline';

const props = defineProps<{ lab: Lab; playback: Playback }>();

// Destructured so the template's top-level bindings auto-unwrap.
const { safety } = useRunTimeline(props.lab, props.playback);

const rows = computed(() =>
  SAFETY_FUNCTIONS.map((fn) => ({ ...fn, tripped: safety.value.tripped.includes(fn.id) })),
);

const trippedCount = computed(() => rows.value.filter((row) => row.tripped).length);

const stateTone = computed(() => {
  switch (safety.value.state) {
    case 'AUTO_TASK':
    case 'AUTO_TRAVEL':
      return 'pill-ok';
    case 'READY':
    case 'MANUAL':
      return 'pill-accent';
    case 'SAFE_STOP':
      return 'pill-danger';
    default:
      return 'pill-warn';
  }
});
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>Safety at {{ (playback.t / 1000).toFixed(2) }} s</h2>
      <span class="pill" :class="stateTone">
        <i class="dot" />
        {{ safety.state }}
      </span>
    </div>

    <div class="panel-body scroll">
      <div v-if="safety.inhibited" class="notice notice-warn">
        <strong>Inhibited.</strong>
        <ul style="margin: 4px 0 0; padding-left: 18px">
          <li v-for="(reason, index) in safety.reasons" :key="index">{{ reason }}</li>
        </ul>
      </div>

      <div v-if="safety.safeStop" class="notice notice-warn">
        Safe stop latched at {{ (safety.safeStop.t / 1000).toFixed(2) }} s —
        {{ safety.safeStop.reason || 'no reason recorded' }}. Not auto-resumable.
      </div>

      <div class="stack">
        <span class="field-label">
          Safety functions (docs/10 §6) · {{ trippedCount }} tripped
        </span>
        <div v-for="row in rows" :key="row.id" class="sf-row" :class="{ tripped: row.tripped }">
          <span class="sf-id">{{ row.id }}</span>
          <span class="sf-name" :title="`${row.physical} — ${row.software}`">{{ row.name }}</span>
          <span class="pill" :class="row.tripped ? 'pill-danger' : 'pill-muted'">
            {{ row.tripped ? 'tripped' : 'ok' }}
          </span>
        </div>
      </div>

      <div class="stack">
        <span class="field-label">Permits held · {{ safety.permits.length }}</span>
        <div v-if="safety.permits.length === 0" class="empty">
          No permit is held at this instant.
        </div>
        <div v-for="permit in safety.permits" :key="permit.permitId" class="lease">
          <div>
            <div class="mono">{{ permit.kind }}</div>
            <div class="lease-holder">
              {{ permit.holder }} · {{ permit.resources.join(', ') || 'no resource' }}
            </div>
          </div>
          <span class="pill pill-ok">since {{ (permit.sinceT / 1000).toFixed(2) }} s</span>
        </div>
      </div>

      <div class="stack">
        <span class="field-label">Resources claimed · {{ safety.claims.length }}</span>
        <div v-if="safety.claims.length === 0" class="empty">Nothing is claimed.</div>
        <div v-for="claim in safety.claims" :key="claim.key" class="lease">
          <div>
            <div class="mono">{{ claim.key }}</div>
            <div class="lease-holder">{{ claim.exclusive ? 'exclusive' : 'shared' }}</div>
          </div>
          <span class="pill pill-muted">{{ claim.holder || '—' }}</span>
        </div>
      </div>

      <div v-if="safety.denials.length > 0" class="stack">
        <span class="field-label">Refusals · {{ safety.denials.length }}</span>
        <div v-for="(denial, index) in safety.denials" :key="index" class="lease">
          <div>
            <div class="mono">{{ denial.kind }}</div>
            <div class="lease-holder">{{ denial.reason }}</div>
          </div>
          <span class="pill pill-danger">{{ (denial.t / 1000).toFixed(2) }} s</span>
        </div>
      </div>

      <div v-if="safety.guardBreaches.length > 0" class="stack">
        <span class="field-label">Guard breaches</span>
        <div v-for="breach in safety.guardBreaches" :key="`${breach.id}-${breach.t}`" class="lease">
          <div class="mono">{{ breach.id }}</div>
          <span class="pill pill-danger">{{ (breach.t / 1000).toFixed(2) }} s</span>
        </div>
      </div>

      <div v-if="safety.degraded" class="notice">
        Degraded to <span class="mono">{{ safety.degraded }}</span
        >.
      </div>
    </div>

    <div class="panel-foot">
      Derived from the journal the server wrote. The browser replays the gate's decisions; it does
      not make them.
    </div>
  </section>
</template>
