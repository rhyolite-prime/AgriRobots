import type { LabFaultKind, LabScenario } from './lab-types';

/**
 * The ARACNID scenario catalogue. One list serves the browser picker and the
 * server's validation, so the lab cannot offer a run the engine does not model.
 * Geometry and limits behind these scenarios are
 * `docs/10_ARACNID_AR01_DESIGN_BASIS.md`; the ring radius and the tilt trip are
 * still placeholders recorded in its section 9.
 */
export const ARACNID_SCENARIOS: readonly LabScenario[] = [
  {
    id: 'nominal',
    label: 'Nominal round',
    description: 'Sixteen eggs in the bank, eight saleable offers, magazine with room, no faults.',
    expects: 'Completes with exit 0: eight picks in parallel, quorum 6 satisfied, eight placed and trays verified.',
  },
  {
    id: 'low-confidence',
    label: 'Low-confidence scan',
    description: 'Nest perception returns 0.62 confidence against a 0.8 minimum.',
    expects: 'The scan abstains, the task takes its quiet-abort branch and no hand ever moves.',
  },
  {
    id: 'seal-loss',
    label: 'Seal loss (SF-AR-04)',
    description: 'One cup loses vacuum during the lift; the egg is vented back into the nest.',
    expects: 'One branch fails its post-conditions, the quorum still holds and the round completes with seven eggs.',
  },
  {
    id: 'cracked-egg',
    label: 'Cracked egg',
    description: 'The first offered egg has a shell tolerance below the nominal squeeze.',
    expects: 'The crack is counted against the robot, the branch faults, and the round continues.',
  },
  {
    id: 'worker-presence',
    label: 'Worker presence (SF-AR-07)',
    description: 'A stockperson walks into the cell while the picks are running.',
    expects: 'Every further permit is refused, the mission is safety-inhibited and exits 4.',
  },
  {
    id: 'tilt-breach',
    label: 'Tilt guard breach',
    description: 'Carrier tilt rises to 4.6 deg: past the task guard of 4 deg, under the 6 deg tip-over trip.',
    expects: 'The guard breaches first (defence in depth), the fault clause holds the arms and the exit code is 4.',
  },
  {
    id: 'magazine-full',
    label: 'Magazine full',
    description: 'All six trays are already full when placement starts.',
    expects: 'Placement is retried exactly once (max_retries = 1), then the round faults operationally with exit 1.',
  },
  {
    id: 'fewer-eggs-than-hands',
    label: 'Fewer eggs than hands',
    description: 'Five eggs in the bank for eight hands.',
    expects: 'Hands with nothing to take abstain; abstentions never satisfy the quorum, so the round faults.',
  },
] as const;

export const ARACNID_FAULT_KINDS: readonly LabFaultKind[] = [
  { id: 'seal_loss', label: 'Seal loss on a hand', takesHand: true },
  { id: 'vacuum_decay', label: 'Vacuum decay on a hand', takesHand: true },
  { id: 'force_overrun', label: 'Force over limit on a hand', takesHand: true },
  { id: 'presence', label: 'Worker or bird in the cell', takesHand: false },
  { id: 'tilt', label: 'Carrier tilt beyond the guard', takesHand: false },
  { id: 'heartbeat_gap', label: 'Safety telemetry goes stale', takesHand: false },
] as const;

export const NEST_LAYOUTS = [
  { id: 'arc', label: 'Perimeter arc', note: 'nest bank wraps the docked rover; all eight shoulders reach' },
  { id: 'straight', label: 'Straight run', note: 'one 1.2 m run; only the hands nearest it can work' },
] as const;

export function scenarioById(id: string | undefined): LabScenario | undefined {
  return ARACNID_SCENARIOS.find((scenario) => scenario.id === id);
}

export function isScenario(id: string): boolean {
  return ARACNID_SCENARIOS.some((scenario) => scenario.id === id);
}

export function isFaultKind(id: string): boolean {
  return ARACNID_FAULT_KINDS.some((kind) => kind.id === id);
}
