<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue';

import { useLab, type Lab } from './composables/useLab';
import { usePlayback, type Playback } from './composables/usePlayback';

const lab: Lab = reactive(useLab());
const playback: Playback = reactive(usePlayback());

const frameCount = computed(() => lab.run?.frames.length ?? 0);

onMounted(async () => {
  await lab.load();
  // The lab opens on a running round: an empty viewport explains nothing.
  if (lab.canRun && !lab.run) await lab.execute();
});

watch(
  () => lab.run,
  (run) => {
    if (run) playback.reset(run.run.elapsedMs, true);
  },
);
</script>

<template>
  <div class="lab">
    <LabHeader :lab="lab" />

    <main class="lab-grid">
      <div class="lab-column">
        <MissionControlPanel :lab="lab" />
        <RunSummary :lab="lab" />
      </div>

      <div class="lab-column" style="overflow: hidden">
        <ClientOnly>
          <TwinViewport :lab="lab" :playback="playback" />
          <template #fallback>
            <section class="panel" style="flex: 1; min-height: 340px">
              <div class="panel-head"><h2>Kinematic twin — AR-01 / EG-08</h2></div>
              <div class="viewport-empty">Loading the WebGL twin…</div>
            </section>
          </template>
        </ClientOnly>

        <section class="panel">
          <PlaybackBar :playback="playback" :frame-count="frameCount" />
        </section>

        <CompiledTaskPanel :lab="lab" :playback="playback" />
      </div>

      <div class="lab-column lab-column-right">
        <SafetyPanel :lab="lab" :playback="playback" />
        <JournalPanel :lab="lab" :playback="playback" />
      </div>
    </main>
  </div>
</template>
