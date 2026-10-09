<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import type { TwinFrameData } from '../shared/lab-types';
import { frameAt } from '../shared/safety-view';
import type { Lab } from '../composables/useLab';
import type { Playback } from '../composables/usePlayback';
import {
  ARM_STATE_COLOURS,
  AracnidTwinScene,
  blendFrames,
  GRADE_COLOURS,
  type TwinGeometry,
} from '../lib/twin-scene';

const props = defineProps<{ lab: Lab; playback: Playback }>();

const holder = shallowRef<HTMLElement | null>(null);
const scene = shallowRef<AracnidTwinScene | null>(null);

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** Legend colours come from the scene's own tables, so they cannot drift. */
const ARM_LEGEND = [
  { state: 'stowed', label: 'stowed' },
  { state: 'reaching', label: 'reaching' },
  { state: 'sealing', label: 'sealing' },
  { state: 'holding', label: 'holding an egg' },
  { state: 'placing', label: 'placing' },
  { state: 'fault', label: 'fault' },
].map((entry) => ({ ...entry, colour: hex(ARM_STATE_COLOURS[entry.state] ?? 0x616b78) }));

const GRADE_LEGEND = [
  { grade: 'saleable', label: 'saleable' },
  { grade: 'dirty', label: 'dirty (rejected)' },
  { grade: 'undersized', label: 'undersized (rejected)' },
  { grade: 'cracked', label: 'cracked' },
].map((entry) => ({ ...entry, colour: hex(GRADE_COLOURS[entry.grade] ?? 0x8d8d8d) }));

const frames = computed<TwinFrameData[]>(() => props.lab.run?.frames ?? []);

const geometry = computed<TwinGeometry | null>(() => {
  const source = props.lab.run?.world.geometry ?? props.lab.geometry;
  return source && typeof source === 'object' && 'handCount' in source
    ? (source as unknown as TwinGeometry)
    : null;
});

const current = computed<TwinFrameData | null>(() => {
  const found = frameAt(frames.value, props.playback.t);
  if (!found.frame) return null;
  return found.next ? blendFrames(found.frame, found.next, found.alpha) : found.frame;
});

const frameIndex = computed(() => {
  const now = props.playback.t;
  let index = -1;
  frames.value.forEach((frame, position) => {
    if (frame.t <= now) index = position;
  });
  return index;
});

const currentStatement = computed(() => {
  const lines = props.lab.run?.journal ?? [];
  const now = props.playback.t;
  let found: { id: string; kind: string } | null = null;
  for (const line of lines) {
    if (line.t > now) break;
    if (line.kind === 'statement.entered' && line.statementId) {
      found = { id: line.statementId, kind: String(line.payload['kind'] ?? '') };
    }
  }
  return found;
});

const holding = computed(
  () => (current.value?.arms ?? []).filter((arm) => arm.holding !== null).length,
);

function render(): void {
  const frame = current.value;
  if (!scene.value || !frame) return;
  scene.value.applyFrame(frame);
}

onMounted(() => {
  if (!import.meta.client || !holder.value || !geometry.value) return;
  scene.value = new AracnidTwinScene(holder.value, geometry.value);
  render();
});

onBeforeUnmount(() => {
  scene.value?.dispose();
  scene.value = null;
});

watch(current, render);
watch(frames, () => {
  // A new run may redraw the nest bank; the first frame repopulates it.
  if (frames.value.length > 0) props.playback.seek(0);
  render();
});
</script>

<template>
  <section class="panel" style="flex: 1; min-height: 0">
    <div class="panel-head">
      <h2>Kinematic twin — AR-01 / EG-08</h2>
      <div class="row">
        <span class="pill pill-muted">frame {{ frameIndex + 1 }} / {{ frames.length }}</span>
        <span
          class="pill"
          :class="current?.safety.state === 'AUTO_TASK' ? 'pill-ok' : 'pill-danger'"
        >
          <i class="dot" />
          {{ current?.safety.state ?? 'UNKNOWN' }}
        </span>
      </div>
    </div>

    <div class="viewport">
      <div ref="holder" class="viewport-canvas" />

      <div class="viewport-overlay">
        <span class="pill pill-accent">
          {{
            currentStatement
              ? `${currentStatement.id} · ${currentStatement.kind}`
              : 'awaiting first statement'
          }}
        </span>
        <span class="pill pill-muted">
          tilt {{ (current?.carrier.tilt ?? 0).toFixed(2) }}° · battery
          {{ (current?.carrier.battery ?? 0).toFixed(1) }}%
        </span>
        <span class="pill pill-muted">
          {{ holding }} of {{ current?.arms.length ?? 8 }} hands holding · magazine
          {{ current?.magazine.eggs ?? 0 }}/{{ current?.magazine.capacity ?? 180 }}
        </span>
        <span v-if="current?.safety.tripped.length" class="pill pill-danger">
          {{ current?.safety.tripped.join(', ') }}
        </span>
      </div>

      <div class="viewport-legend">
        <div v-for="entry in ARM_LEGEND" :key="entry.state" class="legend-row">
          <span class="legend-swatch" :style="{ background: entry.colour }" />
          {{ entry.label }}
        </div>
        <div v-for="entry in GRADE_LEGEND" :key="entry.grade" class="legend-row">
          <span class="legend-swatch" :style="{ background: entry.colour, borderRadius: '50%' }" />
          {{ entry.label }}
        </div>
      </div>

      <div v-if="frames.length === 0" class="viewport-empty">
        <strong>No run yet</strong>
        <span>
          Compile and run the ARACNID round to fill this viewport with twin frames. The robot below
          is drawn from the geometry the world model reports, not from a CAD import.
        </span>
      </div>
    </div>
  </section>
</template>
