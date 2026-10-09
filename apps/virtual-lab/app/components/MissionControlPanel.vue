<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Lab } from '../composables/useLab';

const props = defineProps<{ lab: Lab }>();

const newFaultKind = ref('force_overrun');
const newFaultAtMs = ref(6000);
const newFaultHand = ref(4);

const scenario = computed(() => props.lab.activeScenario);
const takesHand = computed(
  () => props.lab.faultKinds.find((kind) => kind.id === newFaultKind.value)?.takesHand ?? false,
);
const layoutNote = computed(
  () => props.lab.layouts.find((layout) => layout.id === props.lab.nestLayout)?.note ?? '',
);

/** Blank means "whatever the scenario models", so the field stays nullable. */
const eggsModel = computed({
  get: () => props.lab.eggsInBank ?? '',
  set: (value: unknown) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    props.lab.eggsInBank = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  },
});

function faultTakesHand(kind: string): boolean {
  return props.lab.faultKinds.find((entry) => entry.id === kind)?.takesHand ?? false;
}

function numberFrom(event: Event): number {
  const target = event.target as HTMLInputElement | null;
  const parsed = Number.parseFloat(target?.value ?? '');
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function onFaultAt(index: number, event: Event): void {
  props.lab.updateFault(index, { atMs: Math.max(0, numberFrom(event)) });
}

function onFaultHand(index: number, event: Event): void {
  props.lab.updateFault(index, { hand: Math.min(8, Math.max(1, numberFrom(event))) });
}

function addFault(): void {
  props.lab.addFault(newFaultKind.value, Math.max(0, Math.trunc(newFaultAtMs.value)), newFaultHand.value);
}

function randomSeed(): void {
  props.lab.seed = Math.floor(Math.random() * 900_000) + 100_000;
}

async function run(): Promise<void> {
  await props.lab.execute();
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>Mission control</h2>
      <span class="pill pill-muted">executed on the server</span>
    </div>

    <div class="panel-body scroll">
      <div class="field">
        <label for="task">Task (compiled from dsl/examples)</label>
        <select id="task" v-model="lab.taskId">
          <option v-for="entry in lab.shelf" :key="entry.task.id" :value="entry.task.id">
            {{ entry.task.title }}
          </option>
        </select>
        <p v-if="lab.selectedTask" class="hint">
          {{ lab.selectedTask.robot }} — {{ lab.selectedTask.summary }}
        </p>
        <div v-if="lab.selectedTask && !lab.canRun" class="notice notice-warn">
          No world model exists for this task yet, so it can be compiled, hashed and reviewed here, but not executed.
        </div>
      </div>

      <div class="field">
        <label for="scenario">Scenario</label>
        <select id="scenario" v-model="lab.scenario">
          <option v-for="entry in lab.scenarios" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
        </select>
        <p v-if="scenario" class="hint">{{ scenario.description }}</p>
        <p v-if="scenario" class="hint"><strong>Expect:</strong> {{ scenario.expects }}</p>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="seed">Seed</label>
          <input id="seed" v-model.number="lab.seed" type="number" min="1" step="1" />
        </div>
        <div class="field">
          <label for="eggs">Eggs in bank</label>
          <input id="eggs" v-model="eggsModel" type="number" min="1" max="240" placeholder="scenario default" />
        </div>
      </div>
      <div class="row">
        <button class="btn btn-small" type="button" @click="randomSeed">random seed</button>
        <button class="btn btn-small" type="button" @click="lab.seed = 20261009">default seed</button>
      </div>

      <div class="field">
        <span class="field-label">Nest bank geometry</span>
        <div class="row">
          <label v-for="layout in lab.layouts" :key="layout.id" class="checkbox">
            <input v-model="lab.nestLayout" type="radio" :value="layout.id" />
            {{ layout.label }}
          </label>
        </div>
        <p class="hint">{{ layoutNote }} — still an open assumption in docs/10 §9.</p>
      </div>

      <div class="field">
        <span class="field-label">Injected faults</span>
        <div v-if="lab.faults.length === 0" class="empty">None — the scenario's own faults still apply.</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Kind</th>
              <th class="num">At (ms)</th>
              <th class="num">Hand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(fault, index) in lab.faults" :key="`${fault.kind}-${index}`">
              <td class="mono">{{ fault.kind }}</td>
              <td class="num">
                <input
                  :value="fault.atMs"
                  type="number"
                  min="0"
                  step="500"
                  style="width: 78px"
                  @change="onFaultAt(index, $event)"
                />
              </td>
              <td class="num">
                <input
                  v-if="faultTakesHand(fault.kind)"
                  :value="fault.hand ?? 1"
                  type="number"
                  min="1"
                  max="8"
                  style="width: 54px"
                  @change="onFaultHand(index, $event)"
                />
                <span v-else class="hint">—</span>
              </td>
              <td>
                <button class="btn btn-small btn-ghost" type="button" @click="lab.removeFault(index)">remove</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="row">
          <select v-model="newFaultKind" style="flex: 2">
            <option v-for="kind in lab.faultKinds" :key="kind.id" :value="kind.id">{{ kind.label }}</option>
          </select>
          <input
            v-model.number="newFaultAtMs"
            type="number"
            min="0"
            step="500"
            style="flex: 1"
            title="mission-relative milliseconds"
          />
          <input
            v-if="takesHand"
            v-model.number="newFaultHand"
            type="number"
            min="1"
            max="8"
            style="flex: 0.6"
            title="hand"
          />
          <button class="btn btn-small" type="button" @click="addFault">inject</button>
        </div>
      </div>

      <label class="checkbox">
        <input v-model="lab.preflight" type="checkbox" />
        Run the preflight clause before arming
      </label>

      <div v-if="lab.error" class="issue">
        <div class="code">{{ lab.issues.length > 0 ? 'refused by the toolchain' : 'request failed' }}</div>
        <div>{{ lab.error }}</div>
        <ul v-if="lab.issues.length > 0">
          <li v-for="(issue, index) in lab.issues" :key="index" class="mono">
            [{{ issue.code }}] {{ issue.message }}
          </li>
        </ul>
      </div>
    </div>

    <div class="panel-foot">
      <button
        class="btn btn-primary"
        type="button"
        style="width: 100%"
        :disabled="lab.busy || !lab.canRun"
        @click="run"
      >
        {{ lab.busy ? 'compiling and executing…' : 'Compile and run the round' }}
      </button>
      <p class="hint" style="margin: 7px 0 0">
        {{ lab.runsCompleted }} run{{ lab.runsCompleted === 1 ? '' : 's' }} this session. Same seed and scenario give
        the same journal hash.
      </p>
    </div>
  </section>
</template>
