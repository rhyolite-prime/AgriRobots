import { computed, markRaw, ref, shallowRef, type Reactive } from 'vue';

import type {
  ApiError,
  CompiledSummary,
  LabFaultKind,
  LabFaultRequest,
  LabScenario,
  LabTaskSummary,
  RunRequest,
  RunResponse,
} from '../../shared/lab-types';
import { ARACNID_FAULT_KINDS, ARACNID_SCENARIOS, NEST_LAYOUTS } from '../../shared/scenarios';

export interface ShelfEntry {
  task: LabTaskSummary;
  compiled: CompiledSummary | null;
  error: ApiError | null;
}

interface Catalogue {
  scenarios: LabScenario[];
  faults: LabFaultKind[];
  layouts: Array<{ id: string; label: string; note: string }>;
  geometry: Record<string, unknown>;
}

interface FetchErrorShape {
  data?: { data?: ApiError; message?: string; statusMessage?: string };
  message?: string;
}

/**
 * Lab state: the task shelf, the run request, and the last run.
 *
 * Everything physical happened on the server before this state exists. The
 * browser holds a result to render, never a machine to drive.
 */
export function useLab() {
  const shelf = shallowRef<ShelfEntry[]>([]);
  const scenarios = shallowRef<LabScenario[]>([...ARACNID_SCENARIOS]);
  const faultKinds = shallowRef<LabFaultKind[]>([...ARACNID_FAULT_KINDS]);
  const layouts = shallowRef<Array<{ id: string; label: string; note: string }>>(
    NEST_LAYOUTS.map((layout) => ({ ...layout })),
  );
  const geometry = shallowRef<Record<string, unknown>>({});

  const taskId = ref('aracnid-egg-collection');
  const scenario = ref('nominal');
  const seed = ref(20261009);
  const nestLayout = ref<'arc' | 'straight'>('arc');
  const eggsInBank = ref<number | null>(null);
  const faults = ref<LabFaultRequest[]>([]);
  const preflight = ref(true);

  const run = shallowRef<RunResponse | null>(null);
  const previousRun = shallowRef<RunResponse | null>(null);
  const previousRequest = ref<string | null>(null);
  const busy = ref(false);
  const error = ref<string | null>(null);
  const issues = ref<Array<{ code: string; message: string; statementId?: string | null }>>([]);
  const runsCompleted = ref(0);
  const loaded = ref(false);

  const selectedEntry = computed(() => shelf.value.find((entry) => entry.task.id === taskId.value) ?? null);
  const selectedTask = computed(() => selectedEntry.value?.task ?? null);
  const compiled = computed(() => selectedEntry.value?.compiled ?? run.value?.compiled ?? null);
  const canRun = computed(() => (selectedTask.value?.worlds ?? []).includes('aracnid'));
  const activeScenario = computed(() => scenarios.value.find((entry) => entry.id === scenario.value) ?? null);

  const request = computed<RunRequest>(() => ({
    taskId: taskId.value,
    world: 'aracnid',
    scenario: scenario.value,
    seed: seed.value,
    nestLayout: nestLayout.value,
    faults: faults.value.map((fault) => ({ ...fault })),
    preflight: preflight.value,
    ...(eggsInBank.value === null ? {} : { eggsInBank: eggsInBank.value }),
  }));

  /** Did the same request produce the same journal hash? That is determinism. */
  const determinism = computed<'identical' | 'diverged' | null>(() => {
    if (!run.value || !previousRun.value || !previousRequest.value) return null;
    if (previousRequest.value !== JSON.stringify(request.value)) return null;
    return run.value.run.journalHash === previousRun.value.run.journalHash ? 'identical' : 'diverged';
  });

  async function load(): Promise<void> {
    try {
      const [tasks, catalogue] = await Promise.all([
        $fetch<{ tasks: ShelfEntry[] }>('/api/tasks'),
        $fetch<Catalogue>('/api/scenarios'),
      ]);
      shelf.value = tasks.tasks;
      scenarios.value = catalogue.scenarios;
      faultKinds.value = catalogue.faults;
      layouts.value = catalogue.layouts;
      geometry.value = catalogue.geometry;
      loaded.value = true;
      error.value = null;
    } catch (cause) {
      const shaped = cause as FetchErrorShape;
      error.value = shaped.data?.message ?? shaped.message ?? String(cause);
    }
  }

  async function execute(): Promise<RunResponse | null> {
    busy.value = true;
    error.value = null;
    issues.value = [];
    const key = JSON.stringify(request.value);
    try {
      const response = await $fetch<RunResponse>('/api/missions/run', {
        method: 'POST',
        body: request.value,
      });
      previousRun.value = run.value;
      previousRequest.value = run.value ? key : null;
      // Immutable result data: marked raw so a reactive lab never walks 300
      // journal events looking for something to track.
      run.value = markRaw(response);
      runsCompleted.value += 1;
      return response;
    } catch (cause) {
      const shaped = cause as FetchErrorShape;
      const body = shaped.data?.data;
      error.value = body?.message ?? shaped.data?.message ?? shaped.message ?? String(cause);
      issues.value = body?.issues ?? [];
      return null;
    } finally {
      busy.value = false;
    }
  }

  function addFault(kind: string, atMs: number, hand?: number): void {
    const takesHand = faultKinds.value.find((entry) => entry.id === kind)?.takesHand ?? false;
    faults.value = [
      ...faults.value,
      { atMs, kind, ...(takesHand ? { hand: hand ?? 1 } : {}) },
    ];
  }

  function updateFault(index: number, patch: Partial<LabFaultRequest>): void {
    faults.value = faults.value.map((fault, position) => (position === index ? { ...fault, ...patch } : fault));
  }

  function removeFault(index: number): void {
    faults.value = faults.value.filter((_fault, position) => position !== index);
  }

  function clearFaults(): void {
    faults.value = [];
  }

  return {
    // catalogue
    shelf,
    scenarios,
    faultKinds,
    layouts,
    geometry,
    loaded,
    // request
    taskId,
    scenario,
    seed,
    nestLayout,
    eggsInBank,
    faults,
    preflight,
    request,
    selectedTask,
    selectedEntry,
    compiled,
    canRun,
    activeScenario,
    // result
    run,
    previousRun,
    busy,
    error,
    issues,
    runsCompleted,
    determinism,
    // actions
    load,
    execute,
    addFault,
    updateFault,
    removeFault,
    clearFaults,
  };
}

export type LabState = ReturnType<typeof useLab>;

/** The lab as components see it: `reactive(useLab())`, with refs unwrapped. */
export type Lab = Reactive<LabState>;
