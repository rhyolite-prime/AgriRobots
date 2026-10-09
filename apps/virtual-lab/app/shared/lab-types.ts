/**
 * Wire types between the Nitro server (which compiles and executes) and the
 * browser (which renders). The browser never imports the engine at runtime: it
 * imports these types and the JSON the server produced.
 */

export type LabWorldId = 'aracnid' | 'bench';

export interface LabTaskSummary {
  id: string;
  file: string;
  title: string;
  robot: string;
  summary: string;
  worlds: LabWorldId[];
}

export interface LabScenario {
  id: string;
  label: string;
  description: string;
  /** What the run is expected to demonstrate, shown before it is executed. */
  expects: string;
}

export interface LabFaultKind {
  id: string;
  label: string;
  takesHand: boolean;
}

export interface LabFaultRequest {
  atMs: number;
  kind: string;
  hand?: number;
}

export interface RunRequest {
  taskId: string;
  world: LabWorldId;
  scenario?: string;
  seed?: number;
  nestLayout?: 'arc' | 'straight';
  eggsInBank?: number;
  faults?: LabFaultRequest[];
  maxVisits?: number;
  preflight?: boolean;
}

/** One journal event, flattened for the timeline and given mission-relative time. */
export interface JournalLine {
  sequence: number;
  kind: string;
  /** Mission-relative milliseconds. */
  t: number;
  timestamp: string;
  source: string;
  safetyState: string;
  quality: string;
  statementId: string | null;
  summary: string;
  payload: Record<string, unknown>;
}

export interface CompiledStatementLine {
  id: string;
  kind: string;
  label?: string;
  capability?: string;
  permits?: string[];
  resources?: string[];
  parents: string[];
}

export interface CompiledSummary {
  taskName: string;
  taskVersion: string;
  irHash: string;
  sourceHash: string;
  canonicalBytes: number;
  statistics: {
    statementCount: number;
    actuatingStatements: number;
    capabilities: string[];
    resourceClaims: string[];
    permitScopes: number;
    guards: number;
    parallelBranches: number;
    maxParallelWidth: number;
    maxLoopBound: number;
    maxRetryAttempts: number;
    taskDeadlineMs: number | null;
    subtaskCalls: number;
  };
  limits: Array<{ key: string; value: number; unit: string }>;
  preflight: string[];
  statements: CompiledStatementLine[];
}

export interface RunSummary {
  runId: string;
  status: string;
  exitCode: number;
  errorCode?: string;
  message?: string;
  elapsedMs: number;
  visits: number;
  tally: Record<string, number>;
  safety: { state: string; tripped: string[]; inhibited: boolean; reasons: string[] };
  journalHash: string;
  suspended?: { reason: string; prompt?: string; choices?: string[]; statementId: string };
}

/**
 * Twin frames are plain JSON produced by `@agrirobots/engine`; the shape is
 * mirrored here so the browser does not import the engine to read it.
 */
export interface TwinArmFrame {
  id: string;
  shoulderYaw: number;
  elbowPitch: number;
  wristPitch: number;
  extension: number;
  suctionKpa: number;
  forceN: number;
  holding: string | null;
  state: 'stowed' | 'reaching' | 'sealing' | 'holding' | 'placing' | 'fault';
}

export interface TwinEggFrame {
  id: string;
  massG: number;
  grade: string;
  cracked: boolean;
}

export interface TwinNestSlotFrame {
  id: string;
  x: number;
  y: number;
  z: number;
  egg: TwinEggFrame | null;
  scanned: boolean;
  confidence: number;
}

export interface TwinFrameData {
  t: number;
  carrier: {
    x: number;
    y: number;
    heading: number;
    speed: number;
    parked: boolean;
    tilt: number;
    armsDeployed: boolean;
    battery: number;
  };
  arms: TwinArmFrame[];
  magazine: {
    trayIndex: number;
    trays: Array<{ index: number; filled: number; capacity: number }>;
    eggs: number;
    capacity: number;
  };
  nestBank: { id: string; x: number; y: number; slots: TwinNestSlotFrame[] };
  tally: Record<string, number>;
  safety: { state: string; tripped: string[] };
}

export interface WorldSummary {
  id: LabWorldId;
  scenario?: string;
  seed?: number;
  nestLayout?: 'arc' | 'straight';
  describe: Record<string, unknown>;
  geometry: Record<string, unknown>;
}

export interface CheckpointSummary {
  version: number;
  status: string;
  cursor: { statementId: string; path: string[] };
  clockMs: number;
  visits: number;
  safetyStop: boolean;
  completedKeys: string[];
  variables: Record<string, unknown>;
}

export interface RunResponse {
  /** Milliseconds of host CPU the execution took, against `run.elapsedMs` of mission time. */
  wallMs: number;
  run: RunSummary;
  compiled: CompiledSummary;
  source: string;
  journal: JournalLine[];
  frames: TwinFrameData[];
  world: WorldSummary;
  checkpoint: CheckpointSummary;
  epochMs: number;
}

export interface TaskResponse {
  task: LabTaskSummary;
  compiled: CompiledSummary;
  source: string;
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  issues?: Array<{ code: string; message: string; statementId?: string | null; severity?: string }>;
}
