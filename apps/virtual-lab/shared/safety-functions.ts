/**
 * The ARACNID safety-function table, transcribed from
 * `docs/10_ARACNID_AR01_DESIGN_BASIS.md` section 6 so the lab can name a
 * tripped function instead of only showing its id.
 *
 * This is display data. The functions themselves are assessed by
 * `IndependentSafetyModel` in `@agrirobots/engine`, on the server, from state —
 * never by the browser.
 */
export interface SafetyFunctionRow {
  id: string;
  name: string;
  physical: string;
  software: string;
}

export const SAFETY_FUNCTIONS: readonly SafetyFunctionRow[] = [
  {
    id: 'SF-AR-01',
    name: 'E-stop (4 corners + HMI)',
    physical: 'Traction torque removed, brakes applied, vacuum vented, arms held',
    software: 'Mission aborts; inspection/reset before re-arm; not auto-resumable',
  },
  {
    id: 'SF-AR-02',
    name: 'Arm-envelope scanner breach',
    physical: 'Affected arms stop and hold; traction inhibited',
    software: 'Guard breach → fault clause; journal records the arm and zone',
  },
  {
    id: 'SF-AR-03',
    name: 'Hand force over limit',
    physical: 'Hand MCU cuts suction and retracts',
    software: 'verify fails → on_mismatch fault; no retry without re-verification',
  },
  {
    id: 'SF-AR-04',
    name: 'Vacuum / seal loss',
    physical: 'Cup vents, hand opens',
    software: 'Recorded as slip/abstention; egg flagged, never re-squeezed',
  },
  {
    id: 'SF-AR-05',
    name: 'Cassette latch / ID mismatch',
    physical: 'Tool energy and travel inhibited',
    software: 'Manifest unload; physical inspection requested',
  },
  {
    id: 'SF-AR-06',
    name: 'Deployed-arm motion interlock',
    physical: 'Arms cannot deploy unless parked and permitted',
    software: 'Gate denial (exit code 4 class), journaled',
  },
  {
    id: 'SF-AR-07',
    name: 'Bird / worker presence in the working cell',
    physical: 'Arms hold, traction inhibited',
    software: 'Guard breach → degrade to sensing_only or fault',
  },
  {
    id: 'SF-AR-08',
    name: 'Tip-over / tilt beyond limit',
    physical: 'All energy removed, arms held',
    software: 'Fault; no automatic recovery',
  },
  {
    id: 'SF-AR-09',
    name: 'Heartbeat loss (engine, arm MCU, safety)',
    physical: 'Controlled stop, vacuum vented, arms held',
    software: 'Fault; no automatic resume',
  },
  {
    id: 'SF-AR-10',
    name: 'Magazine interlock',
    physical: 'Tray bay cannot index while a hand is inside it',
    software: 'Compile-time and gate-time refusal',
  },
] as const;

export const EXIT_CODE_MEANINGS: Readonly<Record<number, string>> = {
  0: 'Mission completed',
  1: 'Execution failed: the task faulted, a quorum was not met, or a post-condition never held',
  2: 'Usage, parse or validation error — nothing ran',
  3: 'Suspended, waiting for an operator, an event or a timer',
  4: 'Safety-inhibited: the machine refused (preflight, permit, guard, degradation)',
};
