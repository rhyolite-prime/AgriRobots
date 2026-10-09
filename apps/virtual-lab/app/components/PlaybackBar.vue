<script setup lang="ts">
import { computed } from 'vue';

import type { Playback } from '../composables/usePlayback';

const props = defineProps<{ playback: Playback; frameCount: number }>();

const SPEEDS = [0.5, 1, 2, 4, 8];

const clock = computed(
  () =>
    `${(props.playback.t / 1000).toFixed(2)} s / ${(props.playback.duration / 1000).toFixed(2)} s`,
);

function onScrub(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  const parsed = Number.parseFloat(target?.value ?? '0');
  if (Number.isFinite(parsed)) props.playback.seek(parsed);
}

function step(event: Event, delta: number): void {
  event.preventDefault();
  props.playback.nudge(delta);
}
</script>

<template>
  <div class="playback">
    <button
      class="btn btn-small"
      type="button"
      :disabled="playback.duration <= 0"
      @click="playback.toggle"
    >
      {{ playback.playing ? 'pause' : 'play' }}
    </button>
    <button
      class="btn btn-small"
      type="button"
      :disabled="playback.duration <= 0"
      @click="playback.seek(0)"
    >
      restart
    </button>
    <button
      class="btn btn-small"
      type="button"
      :disabled="playback.duration <= 0"
      title="back one second"
      @click="step($event, -1000)"
    >
      −1 s
    </button>
    <button
      class="btn btn-small"
      type="button"
      :disabled="playback.duration <= 0"
      title="forward one second"
      @click="step($event, 1000)"
    >
      +1 s
    </button>

    <span class="playback-time">{{ clock }}</span>

    <input
      type="range"
      min="0"
      :max="playback.duration"
      step="10"
      :value="playback.t"
      :disabled="playback.duration <= 0"
      aria-label="mission time"
      @input="onScrub"
    />

    <div class="speed-group">
      <button
        v-for="value in SPEEDS"
        :key="value"
        class="btn"
        :class="{ active: playback.speed === value }"
        type="button"
        @click="playback.setSpeed(value)"
      >
        {{ value }}×
      </button>
    </div>

    <label class="checkbox" title="replay from the beginning when the mission clock ends">
      <input v-model="playback.loop" type="checkbox" />
      loop
    </label>

    <span class="pill pill-muted">{{ frameCount }} twin frames</span>
  </div>
</template>
