# @agrirobots/engine

The `agri.task/v1` execution engine: a deterministic interpreter for compiled
task IR, with a virtual clock, a freshness-aware state resolver, an independent
safety model, resource arbitration, permit leases and an append-only journal.
It is the TypeScript twin of the C++23 `agri-engine` described in
[`docs/09_DSL_AND_EXECUTION_ENGINE.md`](../../docs/09_DSL_AND_EXECUTION_ENGINE.md)
— same IR in, same event trace out, which is how the two are held equivalent.

**Status:** implemented and tested. Runs the ARACNID eight-hand egg round
end to end against the kinematic twin in `src/aracnid-world.ts`, in every
scenario that world models. Not implemented: durable checkpoint storage
(checkpoints are returned in memory, not persisted), the `agric` CLI, subtask
installation beyond an in-memory map, and any bridge to ROS 2.

## Pipeline position

```text
.agri source -> [@agrirobots/compiler-core] -> AST -> IR + irHash
             -> [@agrirobots/policy]          -> allow-list, gates, permits
             -> [x] preflight  -> [x] interpret -> [x] journal + twin frames
             -> [x] apps/virtual-lab (Nuxt 4: replays journal, safety, frames)
             -> [ ] checkpoint store (SQLite on the edge, in memory here)
             -> [ ] ROS 2 bridge (Jazzy) -> real AR-01
```

## Contents

| Path | Purpose |
| --- | --- |
| `src/clock.ts` | `VirtualClock`: mission time, per-branch lanes for `parallel`, ISO timestamps |
| `src/state.ts` | `StateSnapshot`, quantities, unit conversion inside a dimension, `StateResolver` with sample age |
| `src/expr.ts` | `agri.expr/v1` evaluator: closed built-in library, freshness predicates, dimension-checked comparison |
| `src/journal.ts` | Closed `JOURNAL_KINDS`, strictly increasing sequence, `hash()` as the identity of a run |
| `src/resources.ts` | `ResourceArbitrator`: exclusive instances, shared classes, all-or-nothing claims, lease expiry, `tool[$held.id]` resolution |
| `src/safety-model.ts` | `IndependentSafetyModel`: SF-AR-01 … SF-AR-10 assessed from state alone, never from the task's intentions |
| `src/safety-gate.ts` | Fail-closed `SafetyGate`: permits, safe stop, degradation, dispatch authorisation |
| `src/world.ts` | `WorldModel` contract and `ScriptedWorld` for deterministic tests |
| `src/aracnid-world.ts` | ARACNID kinematic twin: AR-01 rover, eight EG-08 arms, nest bank, magazine, scenarios and fault injection |
| `src/interpreter.ts` | Generator interpreter for every IR statement kind; faults, joins, guards, awaits, idempotent replay |
| `src/mission.ts` | `runMission`, `resumeMission`, preflight, checkpoints, exit codes |

## Semantics that tests pin down

- **Concurrency.** `parallel` wall time is the slowest lane, not the sum; each
  lane gets its own clock. A join counts only lanes that really succeeded: an
  abstention is neither a failure nor a success and can never satisfy a quorum.
- **Safety.** The safety model reads state, not intent. A permit is refused
  before the action, a guard breaches on stale or out-of-tolerance state, and a
  safe stop is irreversible without a deliberate re-arm. Guard breaches and
  refused permits are *inhibiting*: the mission exits `4`, not `1`.
- **Budgets.** Three nested time budgets (action, loop, task) plus a visit
  budget. `on_fault` is exempt from the budgets that caused the fault, or the
  recovery path could never run.
- **Idempotency.** A key that has already been dispatched is replayed, never
  re-executed; the post-conditions are still re-verified against the world. The
  key ledger travels in the checkpoint, so a restarted block does not dose twice.
- **Suspension.** `await` is data: the checkpoint carries the cursor, the clock
  and the variables, and the process may exit. Resume re-verifies the IR hash,
  re-runs preflight, refuses after a safe stop, and re-enters the statement that
  suspended so an operator reply is bound on the second pass.
- **Determinism.** Same seed, same world, same journal hash. That hash is the
  equivalence contract between this engine and the C++ one.
- **Trace ordering.** The journal is causal: `sequence` increases in the order
  the interpreter decided things, and at a parallel join branches are flushed in
  branch order, so mission time can step backwards across the join. The
  `twinFrames` a mission returns are a playback timeline and are sorted by `t`
  (stably, so equal timestamps keep emit order). A consumer that scrubs by time
  sorts the journal on (`elapsedMs`, `sequence`); `apps/virtual-lab` does exactly
  that in `app/shared/journal-lines.ts`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Mission completed |
| `1` | Execution failed (task faulted, quorum unmet, deadline, post-conditions) |
| `2` | Usage, parse or validation error — nothing ran |
| `3` | Suspended, waiting for an operator, an event or a timer |
| `4` | Safety-inhibited: the machine refused (preflight, permit, guard, degradation) |

## ARACNID scenarios

`new AracnidWorld({ scenario, seed, nestLayout, faults })` models
`nominal`, `low-confidence`, `seal-loss`, `cracked-egg`, `worker-presence`,
`tilt-breach`, `magazine-full` and `fewer-eggs-than-hands`, plus injectable
faults (`seal_loss`, `presence`, `tilt`, `force_overrun`, `vacuum_decay`,
`heartbeat_gap`). `nestLayout: 'arc'` puts the nest bank around the docked rover
so all eight shoulders reach; `'straight'` is a single run, which only six hands
can work — the geometry is still an open assumption in
[`docs/10_ARACNID_AR01_DESIGN_BASIS.md`](../../docs/10_ARACNID_AR01_DESIGN_BASIS.md)
section 9. Every number the world uses — nest bank, ring radius, arm envelope,
cup, force limits, speeds, the 6 deg tip-over trip, tray standard, battery — is a
placeholder, and section 9.1 of that document lists each one against the
measurement that closes it.

## Rules for the next implementation step

- Nothing may actuate without a granted permit that names its resources.
- No new journal kind without adding it to `JOURNAL_KINDS`: the list is closed
  so a trace can be replayed and hashed.
- No engine behaviour that is not derivable from
  [`dsl/grammar/agri.task.v1.bnf`](../../dsl/grammar/agri.task.v1.bnf). If the
  engine needs a construct, the grammar changes first, with a hazard review.
- The world is the only source of truth for verification; the interpreter never
  trusts its own record of what it commanded.
