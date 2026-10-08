import { AgriScriptError, ERROR_CODES, NotImplementedError } from './errors.ts';

/** Version of the bounded intermediate representation the executor consumes. */
export const IR_VERSION = 'agri.bt-ir/v0';

/**
 * Action names that may appear in a compiled recipe. This is the seed of the
 * installation allow-list: only these actions compile, and adding one requires a
 * capability, hazard and verification review before it is executable.
 *
 * Control-flow constructs (`for_each`, `when`) are compiled to graph nodes and
 * are not capabilities. `safe_stop`, `park_tool` and `notify` are the only
 * actions a recipe may use to reduce energy or request help; none of them can
 * cancel an e-stop, widen a protective field or raise a speed cap.
 */
export const ALLOWED_ACTIONS = [
  'navigate',
  'dock',
  'return_to',
  'dispense_mass',
  'collect_egg',
  'apply_volume',
  'inspect',
  'scan_row',
  'mechanical_weed',
  'record',
  'park_tool',
  'safe_stop',
  'notify',
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export const CONTROL_FLOW_CONSTRUCTS = ['for_each', 'when'] as const;

export type ControlFlowConstruct = (typeof CONTROL_FLOW_CONSTRUCTS)[number];

export function isAllowedAction(value: unknown): value is AllowedAction {
  return typeof value === 'string' && (ALLOWED_ACTIONS as readonly string[]).includes(value);
}

/**
 * Deterministic compilation target: a bounded behaviour-tree IR with an explicit
 * `on_fault` subtree. Not implemented yet.
 *
 * Required before implementation (see docs/08_IMPLEMENTATION_PLAN.md §4 WS-C):
 * semantic validation (finite loops, deadlines, retry bounds, idempotency,
 * capability/manifest agreement, zone and operator policy, model/calibration
 * approval), canonical byte-stable serialisation, and signing.
 */
export function compileToIr(_document: unknown): never {
  throw new NotImplementedError(
    'compileToIr (semantic validation and bounded behaviour-tree IR)',
    'docs/08_IMPLEMENTATION_PLAN.md §4 WS-C steps 3-5',
  );
}

/** Guard used by callers that must refuse an unsupported action name. */
export function assertAllowedAction(value: unknown): asserts value is AllowedAction {
  if (!isAllowedAction(value)) {
    throw new AgriScriptError(
      ERROR_CODES.semantic,
      `Action "${String(value)}" is not in the installed allow-list`,
      [...ALLOWED_ACTIONS],
    );
  }
}
