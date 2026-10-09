# 09 — AgriScript grammar and execution engine

**Document:** AGR-DSL-090 · **Revision:** A · **Status:** design baseline for implementation  
**Grammar:** [`dsl/grammar/agri.task.v1.bnf`](../dsl/grammar/agri.task.v1.bnf) (`agri.task/v1`)  
**Engine:** `agri-engine` — the robotics sibling of the [Sapo DSL execution engine](https://github.com/rhyolite-prime/SapoEngine)  
**Depends on:** [`02_CONTROLS_SOFTWARE_AND_DSL.md`](02_CONTROLS_SOFTWARE_AND_DSL.md), [`05_SAFETY_AND_COMPLIANCE.md`](05_SAFETY_AND_COMPLIANCE.md), [`08_IMPLEMENTATION_PLAN.md`](08_IMPLEMENTATION_PLAN.md) §4 WS-C

## 1. Purpose

The Sapo Engine standardised USSD service construction: a declarative blueprint
replaced hand-written `if/else` session managers, so flows became reviewable,
validatable before deployment, and hostable predictably. This document applies
the same discipline to a physical machine, where the equivalent of a mis-routed
menu is an unverified actuation next to an animal, a worker or a crop.

It specifies:

1. how the `agri.task/v1` grammar is derived into an execution engine, production
   by production;
2. what is reused from SapoEngine and what must differ;
3. the runtime model — statements, signals, suspension, deadlines, permits,
   guards, verification, journaling;
4. the safety boundary the engine may not cross;
5. the compile → sign → deploy → execute path that makes robot task deployment as
   predictable as a USSD release;
6. the conformance and verification plan, and the work packages.

The grammar is authoritative. If a behaviour cannot be derived from `<program>`,
it cannot be compiled, signed or executed — and if the engine needs a construct
the grammar lacks, the grammar changes first, with a hazard review.

## 2. Lineage: what SapoEngine contributes

SapoEngine's architecture (C++23, `nlohmann/json`, exprtk, Catch2, Drogon host
integration, `sapoc` CLI, Redis/file state store) maps onto this engine almost
component for component. The valuable transfer is not code volume; it is the set
of decisions already proven in production:

| SapoEngine decision | Why it matters here |
| --- | --- |
| Blueprint is data, parsed once into an AST with expressions compiled at parse time | A robot task is reviewed and hashed as an artifact, not interpreted from text during motion |
| `BlueprintValidator` checks unique ids, jump targets, reachability, cycles, capability registration and unused fields before execution | Turns "engine failed at node 47" into a compile-time message naming the node and field |
| `CapabilityRegistry` is the single source of truth for "does this name exist"; unknown capability is refused at parse time with no shell fallback | The exact mechanism the AgriScript allow-list needs; no dynamic escape hatch |
| `ControlSignal` variant (`Continue`, `JumpTo`, `SuspendRequest`, `Terminate`, `LoopBreak`, `LoopContinue`) as the interpreter's only signalling mechanism | No magic context keys, no exceptions for routing — auditable control flow |
| Suspension is data in a `SessionCheckpoint`, never a parked thread; timers and events wake sessions | A robot waiting for a 90 s dispense or an operator confirmation must not hold a thread, and must survive an executor restart |
| Interpreter frame stack drives loop/try/parallel bodies | Guard and permit scopes need exactly this: a frame that owns an invariant and a lease |
| Deterministic injected `Clock` with `tick()` / `tickUntil()` | Deadlines and watchdogs must be testable without wall-clock sleeps |
| `sapoc validate --strict --json` with meaningful exit codes | The same CI-gated, machine-readable release gate for robot tasks |
| Engine shipped as a static library embedded in a high-concurrency host (`libsapo_core.a` in a Drogon service) | The engine embeds in a ROS 2 executor node; the host owns transport and concurrency |

### 2.1 Component mapping

| SapoEngine | `agri-engine` | Change required for physical execution |
| --- | --- | --- |
| `WorkflowParser` | `TaskParser` | Textual `.agri` front end plus the JSON/YAML interchange forms |
| `AstNodes.hpp` (`TaskType`) | `StatementNodes.hpp` (`StatementKind`) | Adds `Actuate`, `Observe`, `Permit`, `Guard`, `AwaitPhysical`, `Degrade` |
| `BlueprintValidator` | `TaskValidator` | Adds semantic rules S1–S10: deadlines, verify clauses, loop bounds, permit enclosure, freshness, units, evidence |
| `SEL` expression language | `agri.expr/v1` | Unit-bearing quantities, staleness bounds, closed state-root vocabulary, no side effects |
| `ExpressionEvaluator` + `IResolver` | `StateResolver` | Resolves against typed robot state with quality and age, not a JSON context |
| `CapabilityRegistry` / `ICapabilityProvider` | `CapabilityRegistry` | Descriptors carry hazard class, permit requirement, gate, cassette type, units, verification source |
| `ITask` / `TaskRegistry` / `ExecutionContext` | `IStatement` / `StatementRegistry` / `ActivationContext` | Every physical statement passes a `SafetyGate` before dispatch |
| `Interpreter` / `RunState` | `Interpreter` / `RunState` | Adds guard frames, permit leases, resource arbitration, verification windows |
| `ControlFlow.hpp` | `ControlFlow.hpp` | Adds `RequestSafeStop`, `RequestDegrade`, `PermitDenied` signals |
| `StateStore` / `SessionCheckpoint` | `MissionStore` / `MissionCheckpoint` | Checkpoint carries a physical-state assertion; resume re-verifies the world |
| `Scheduler` / `Clock` / timers | `DeadlineScheduler` / `Clock` | Statement deadlines, task deadline, watchdog heartbeats |
| `EventBus` | `EventBus` + ROS bridge | Typed ROS events in, journal events out |
| `RedisStateStore` | File/SQLite store on the robot, Redis only off-robot | A robot with no network must still checkpoint locally |
| `sapoc` CLI | `agric` CLI | Adds `sign`, `diff`, `capabilities`, and exit code 4 (safety-inhibited) |
| `Logger` / `Metrics` / `traceFor` | `Journal` / `Metrics` / `traceFor` | Journal is append-only evidence with configuration ids |

### 2.2 What is deliberately **not** reused

- **`script` node / exprtk escape hatch.** Sapo allows `{"type":"script","language":"expr","code":…}`. `agri.task/v1` has no script production; expressions are a closed grammar with a fixed built-in list.
- **`command http.post` and the HTTP transport.** A task has no network production. Fleet communication is a service concern outside the task.
- **General assignment into an arbitrary context.** Sapo's `transform`/`assign` writes any key. Here variables are bound only by `observe … into $x` and `await operator … reply $x`; there is no statement that writes `safety.*` or `carrier.*`.
- **Retry as a default.** Sapo's `RetryPolicy` retries transport errors. A physical action retries only with an explicit `idempotency_key`, and only after its `verify` post-conditions are re-evaluated.

Recommendation: keep `agri-engine` a **separate library** in the Sapo lineage
rather than embedding SapoEngine itself. The safety-relevant binary must not
contain HTTP, script or filesystem capabilities at all — their absence is an
assurance argument, not a configuration choice. Shared, genuinely generic pieces
(SEL core, clock/scheduler, checkpoint store, validator harness, CLI scaffolding)
may be extracted later into a common `sapo-core` library once both engines have
stabilised; do not block this project on that extraction.

## 3. Deriving the engine from the grammar

Each production names a statement class; each statement class names one runtime
behaviour and one failure mode. Nothing in the runtime exists without a
production behind it.

| Grammar production | Statement class | Runtime behaviour | Failure mode |
| --- | --- | --- | --- |
| `<task>`, `<meta-clause>` | `TaskBlueprint` | Identity, version, owner, change ticket; content-hashed | Version/identity mismatch inhibits arming |
| `<requires-clause>` | `RequirementSet` | Cassette, capability, operator policy, zones, map, model, calibration, process approval resolved against the manifest and registry | Any mismatch = compile-time or arm-time refusal |
| `<limits-clause>` | `LimitSet` | Numeric envelope enforced by the interpreter **and** the module controller | A command outside limits is clipped and journaled, or refused |
| `<preflight-clause>` | `PreconditionList` | Evaluated once before arming, with freshness bounds | Any false or stale precondition = no start |
| `<motion-stmt>` | `MotionStatement` | Bounded `NavigateToPose` / `Dock` goal with speed cap from `min(task, manifest, zone)` | Timeout → fault; geofence breach → fault |
| `<actuate-stmt>` | `ToolStatement` | Permit check → dispatch bounded action → suspend → verify post-conditions | Verify mismatch → `on_mismatch fault` or bounded retry |
| `<observe-stmt>` | `SenseStatement` | Bounded sensing call, binds `$var` with uncertainty; `abstain_if` yields an abstention record | Timeout/abstention → recorded, never silently retried |
| `<await-stmt>` | `AwaitStatement` | Durable suspension on event, physical completion, condition or operator reply | Timeout → `on_timeout` path |
| `<permit-stmt>` | `PermitStatement` / `PermitLease` | Requests a mode or tool-energy lease from the safety controller for `for <duration>` | Denial or expiry → `on_denied` or fault; never self-granted |
| `<guard-block>` | `InvariantFrame` | Re-evaluates the condition every `<duration>` and on relevant events for the whole block | Breach → `on_breach` or fault, block unwinds |
| `<for-each-stmt>`, `<repeat-stmt>` | `LoopFrame` | Bounded iteration; `at_most` / `N times` are hard ceilings | Bound exceeded → `on_exhausted` or fault |
| `<when-stmt>` | `BranchFrame` | Condition with optional freshness bound | Stale read is inhibiting |
| `<parallel-stmt>`, `<branch>` | `ParallelFrame` | Concurrent branches with declared `resource-class`; exclusive resources arbitrated | Resource conflict = compile-time error |
| `<sequence-stmt>` | `SequenceFrame` | Explicit block with implicit sibling order | — |
| `<record-stmt>` | `JournalStatement` | Append-only `JournalEvent` with configuration ids | Journal write failure is visible and inhibiting |
| `<safety-stmt>` | `SafetyRequestStatement` | Requests `safe_stop`, `park_tool`, `degrade_to`, or notifies a role | Request only; the safety controller acts |
| `<subtask-stmt>` | `SubtaskStatement` | Calls another **signed** task with `depth_at_most` | Depth or signature failure = refusal |
| `<terminate-stmt>` | `TerminateStatement` | Ends with `success`, `failed <ERROR_CODE>` or `aborted` | — |
| `<fault-clause>` | `FaultHandler` | The single unwind target for every fault in the task | Unreachable fault clause = compile-time error |
| `<evidence-clause>` | `EvidencePolicy` | Retention list, privacy class, retention days | Missing evidence sink = no start |
| `<expr>` | `ExpressionProgram` | Compiled once, immutable, side-effect free | Unresolved state root = compile-time error |

## 4. Architecture

```text
                        author / Virtual Lab / fleet registry
                                        │
                     .agri text  ·  agri.script/v1 YAML  ·  JSON blueprint
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ agric CLI / compile pipeline (CI, Virtual Lab WASM, edge deploy tool)           │
│  Lexer → Parser → AST → TaskValidator (S1–S10, capability registry, manifest)   │
│        → agri.bt-ir/v0 canonical IR → hash → sign → task bundle                 │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    │ signed bundle (verified on the robot)
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ agri-engine (static library inside the ROS 2 executor node)                     │
│                                                                                 │
│  MissionRegistry ── Interpreter ── StatementRegistry (IStatement)               │
│        │                 │                    │                                 │
│        │            frame stack:              ├── CapabilityRegistry            │
│        │            loop / branch /           ├── StateResolver (typed, aged)   │
│        │            parallel / guard /        ├── ExpressionPrograms            │
│        │            permit / try              ├── DeadlineScheduler + Clock     │
│        │                 │                    └── Journal (append-only)         │
│        │                 ▼                                                      │
│        │        ┌────────────────────┐   request only                           │
│        │        │     SafetyGate     │ ─────────────►  independent safety       │
│        │        │ pre-dispatch check │ ◄─────────────  controller (PLC/MCU)     │
│        │        └─────────┬──────────┘   mode / permit / interlock               │
│        │                  ▼                                                     │
│        │        PhysicalActionBridge ── ROS 2 action clients, feedback→events   │
│        ▼                  │              heartbeats, watchdogs                  │
│  MissionStore             ▼                                                     │
│  (checkpoint,      agri_base · agri_nav · agri_module_manager · agri_<module>   │
│   no auto-resume)                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

Two hard lines in that diagram:

- everything above `SafetyGate` is **requesting**; everything below the safety
  controller is **deciding**;
- the compile pipeline is one implementation used by CI, the Virtual Lab and the
  edge deploy tool, so a reviewed task is byte-for-byte the deployed task.

## 5. Component specifications

### 5.1 `agric` CLI

| Command | Purpose | Notes |
| --- | --- | --- |
| `agric validate <path…>` | Static validation only | `--strict` promotes warnings; `--json` for CI |
| `agric compile <task.agri>` | Emit canonical IR + content hash | Deterministic: same input, same bytes |
| `agric diff <a> <b>` | Semantic diff of two tasks/IRs | Review aid; clause-by-clause |
| `agric sign <ir> --key <id>` | Produce `agri.artifact/v1` envelope | Gate and approver recorded |
| `agric capabilities` | Print the installed capability registry | The "what may this robot do" answer |
| `agric describe` | Engine version, registry hashes, limits, providers | Deployment fingerprint |
| `agric run <bundle> --sim` | Execute against simulator/replay | Never against hardware from a dev machine |
| `agric resume <mission-id>` | Resume a suspended mission | Re-verifies physical preconditions first |
| `agric missions` / `agric mission <id>` | List / inspect checkpoints | Includes cursor, frames, pending, permits |
| `agric cancel <mission-id>` | Cancel with reason | Journaled |
| `agric emit <event.name>` | Inject an event | Testing and bench use |
| `agric tick [--until <t>]` | Advance the injected clock | Deterministic deadline tests |
| `agric metrics` | Counters, latencies, abstentions, faults | — |

Exit codes: `0` success · `1` execution failed · `2` usage/parse/validation ·
`3` suspended or awaiting · **`4` safety-inhibited** (the SafetyGate or the
safety controller refused; this is not an execution failure and must never be
retried automatically).

### 5.2 Parser and AST

- Hand-written lexer plus recursive-descent or Pratt parser over the BNF; the
  grammar is small, closed and has no macro or template expansion, so a parser
  generator is optional rather than required.
- Expressions compile to immutable `ExpressionProgram` values at parse time and
  are memoised per content hash — evaluation never recompiles.
- Every AST node carries `id` (synthesised when omitted but then recorded),
  source span, and its own `next` / handler links, so validator messages name the
  node and field.
- The parser is **strict**: unknown keywords, unused fields and unexpected tokens
  are errors, not warnings. An unrecognised field is how an unreviewed behaviour
  enters a system.

### 5.3 `TaskValidator`

Static checks, all before any execution:

1. Structural: unique ids, every jump/handler target exists, everything reachable
   from the entry, no unintended cycles, fault clause reachable from every
   actuating statement.
2. Semantic rules S1–S10 from the grammar (capability resolution, deadlines,
   verify clauses, loop bounds, permit enclosure, freshness, reachability,
   subtask depth, unit dimensionality, determinism).
3. Registry checks: capability exists, belongs to the declared cassette type,
   hazard class matches the statement kind (`sensing_only` may only appear in
   `observe`), minimum gate reached, process approval present where required.
4. Manifest checks: mass/CG, power, speed, grade, zone class and calibration
   bundle agree with the signed `agri.module/v1` manifest for the *specific
   cassette serial* this task will run on.
5. Zone/route checks: zones exist, are commissioned, and are approved for this
   operator policy.
6. Evidence checks: the retention list covers every statement class that can
   produce evidence, and a sink exists.

Output is a list of `ValidationIssue { level, node_id, message }` — collect-all,
never fail-fast — so a reviewer fixes a task in one pass.

### 5.4 Canonical IR — `agri.bt-ir/v0`

- Node graph with explicit frames; no textual sugar; all expressions pre-compiled
  and referenced by content hash.
- Canonical serialisation: sorted keys, fixed number formatting, explicit units
  normalised to SI base plus a unit tag, no timestamps, no absolute paths.
- Content hash (`sha256`) over the canonical bytes is the identity used by the
  signature, the journal, the fleet registry and the replay matcher.
- Same source text compiled by the TypeScript and C++ implementations must yield
  identical bytes; that equality is a CI test, not a hope.

### 5.5 Interpreter and control signals

The interpreter walks the IR with a frame stack and returns one `ControlSignal`
per activation. Sapo's set, extended:

| Signal | Meaning | Robotics note |
| --- | --- | --- |
| `Continue` | normal successor | — |
| `JumpTo{target}` | explicit jump | Must stay inside the enclosing frame unless it is a documented escape |
| `Suspend{reason}` | persist and wait | `reason ∈ {physical_completion, timer, event, operator_reply, permit_decision}` |
| `Terminate{status,…}` | end the mission | `status ∈ {success, failed, aborted}` |
| `LoopBreak` / `LoopContinue` | loop control | Bound-checked against `at_most` |
| **`RequestSafeStop{reason}`** | ask the safety controller to stop | Engine may request; only the controller acts; mission is not resumable automatically |
| **`RequestDegrade{mode}`** | ask to enter a degraded mode | `sensing_only`, `shadow`, `reduced_speed`, `hold_position`, `return_to_dock` |
| **`PermitDenied{kind, reason}`** | a requested lease was refused | Routes to `on_denied` or the fault clause |

Rules: no exceptions for routing, no magic context keys, no thread parked per
activation. A suspended mission is a checkpoint plus armed timers/subscriptions.

### 5.6 `IStatement` and `ActivationContext`

```cpp
struct ActivationContext {           // what one activation may see
  const StatementNode& node;
  MissionContext&      mission;      // typed state view, locals, loop bindings
  const Services&      services;     // registry, gate, bridge, clock, journal
  std::string_view     mission_id, execution_id, task_id;
  size_t               depth, node_visits;
  PermitScope          permits;      // leases currently held
  ResourceScope        resources;    // resources held by this branch

  Value eval(const ExpressionProgram&) const;      // strict: unresolved = error
  bool  evalBool(const ExpressionProgram&) const;
  StateRead read(StatePath, Freshness) const;      // value + quality + age
  void  journal(EventKind, Fields) const;          // append-only
};

class IStatement {
 public:
  virtual StatementKind handles() const = 0;
  virtual ControlSignal activate(ActivationContext&) const = 0;
};
```

Statements are stateless and synchronous in the Sapo sense: they compute,
dispatch, and return a signal. Anything that takes physical time returns
`Suspend{physical_completion}` and is woken by the bridge — never by blocking.

### 5.7 `CapabilityRegistry`

Descriptor per capability (extends Sapo's `CapabilityDescriptor`):

| Field | Example |
| --- | --- |
| `name` | `dispense_mass.v1` |
| `provider` | `agri_fd` |
| `cassette_type` | `feed` |
| `hazard_class` | `conditional_task` |
| `minimum_gate` | `G5` |
| `process_approval_required` | `false` |
| `requires_permit` | `tool_energy` |
| `statement_kind` | `actuate` (or `observe` for sensing) |
| `input_schema` / `output_schema` | JSON Schema with units |
| `verification_source` | `tool.dispensed_mass`, `tool.scale_traceable` |
| `deadline_default` / `deadline_max` | `90 s` / `180 s` |
| `idempotent` | `true` with key fields |
| `resource_class` | `tool`, `traction`, `fluid`, `sensing`, `logging` |
| `status` | `implemented` / `deferred` (declared but refused loudly at runtime) |

The registry is populated from the signed cassette manifest plus the installed
module firmware — not from a config file the task author controls. An unknown or
`deferred` capability is refused at compile time, exactly as in Sapo.

### 5.8 `SafetyGate` (the component Sapo does not need)

A pre-dispatch interceptor between the interpreter and every physical effect.

```text
activate(ToolStatement)
  → gate.check({capability, cassette serial, permits held, safety mode,
                zone, limits, freshness of every input state, watchdog health})
  → ALLOW   → bridge.dispatch(bounded goal, deadline, idempotency key)
  → DENY    → PermitDenied / RequestSafeStop, journaled with the reason
  → UNKNOWN → DENY (fail closed)
```

Invariants:

- The gate consults the safety controller's authoritative mode; it never infers
  permission from task state, engine state or a recent successful action.
- Every input the gate evaluates carries an age; a stale read denies.
- The gate cannot be disabled by a task, a flag, a config value or a build
  option. Removing it is removing the engine.
- Denials are journaled as `safety.denied` events with the full reason set —
  these are the most valuable records in the system for tuning tasks.

### 5.9 `PhysicalActionBridge`

- Wraps ROS 2 action clients: `NavigateToPose`, `Dock`, `DispenseMass`,
  `PlaceEgg`, `ApplyVolume`, `InspectPlant`, `ActuateTool`.
- Sends goals with the deadline, limits and idempotency key from the IR; the
  module controller re-checks them independently (defence in depth: the bridge
  being wrong must not be sufficient to cause an over-limit action).
- Converts feedback and results into typed events; a `Suspend{physical_completion}`
  is resolved by the completion event, a deadline expiry, or a fault event —
  whichever arrives first.
- Maintains heartbeats: motion command heartbeat (50 Hz class), tool MCU
  heartbeat, safety status heartbeat. Loss produces the documented physical
  result and the engine's `RequestSafeStop` / fault path.
- Never re-sends a goal automatically. Retry is a statement-level, bounded,
  idempotency-keyed decision made by the interpreter after re-verification.

### 5.10 `MissionStore` and checkpoints

A `MissionCheckpoint` extends Sapo's `SessionCheckpoint` with the physical world:

| Sapo field | AgriBots field |
| --- | --- |
| `session_id`, `execution_id`, `blueprint_id`, `blueprint_version` | `mission_id`, `execution_id`, `task_id`, `task_version`, **`ir_hash`** |
| `status`, `cursor`, `context`, `frames`, `pending`, `timers`, `result`, `error` | same, plus **`permits`** (leases held, expiry) and **`resources`** |
| `version` (optimistic concurrency, store-assigned) | same |
| — | **`physical_assertion`**: carrier id, cassette serial, latch state, tool energy state, last known position estimate with covariance, safety mode, battery, calibration and model hashes |
| — | **`resumable`**: computed, not stored intent |

Resume protocol (the important difference):

1. Load the checkpoint and verify `ir_hash` against the installed signed bundle.
2. Re-run the preflight clause against **current** state.
3. Compare the `physical_assertion` with reality: same cassette serial, latch
   locked, tool de-energised, position estimate consistent within tolerance.
4. If the previous end state was a safety stop, a protective field trigger, an
   e-stop, a latch mismatch or an unexplained anomaly → **not resumable**. The
   mission requires the documented inspection/reset sequence and a new mission
   id.
5. Otherwise resume at the cursor with a journaled `mission.resumed` event that
   lists what was re-verified.

Storage is local (file/SQLite) on the robot; a network store is a fleet
convenience, never a dependency for safe behaviour.

### 5.11 Deadlines, timers, watchdogs

Three nested time budgets, all from the injected clock:

| Level | Source | Expiry behaviour |
| --- | --- | --- |
| Statement deadline | `within <duration>` (mandatory) | Cancel the goal, run `on_timeout` / `on_mismatch` / fault |
| Task deadline | `limits.task_deadline` | Unwind to the fault clause; park tool; no new actuation |
| Watchdog | Engine and module heartbeats | `RequestSafeStop`; safety controller removes energy independently |

`agric tick --until <t>` advances time deterministically so every deadline and
watchdog behaviour is a unit test, not a field surprise.

### 5.2 Guard frames and permit leases

- A `guard` frame re-evaluates its condition every `<duration>` **and** on any
  event that touches a state root the condition reads. Breach unwinds the block
  and routes to `on_breach` or the fault clause. A guard may not widen its own
  condition, extend its own freshness bound, or be re-entered to "clear" a breach.
- A `with_permit … for <duration>` frame holds a **lease**: it expires on time,
  on block exit, on mode change, on latch/manifest change, or on safety stop —
  whichever is first. Expiry inside the block is a fault, not a silent continue.
- Leases are recorded in the checkpoint, so a resumed mission cannot inherit a
  lease that the physical world no longer supports.

### 5.13 Parallel branches and resource arbitration

`parallel` branches declare a `resource-class`. The interpreter holds an
exclusivity table derived from the cassette manifest:

| Resource | Exclusivity |
| --- | --- |
| `traction` | exclusive — one branch may move the carrier |
| `tool` | exclusive — one branch may energise a tool |
| `fluid` | exclusive — one branch may open a fluid path |
| `sensing` | shared |
| `logging` | shared |
| `communication` | shared |

Two branches requesting the same exclusive resource is a **compile-time** error.
`join all` requires every branch to finish; `join first_success` cancels the
others through their documented compensation path (park, close valve, retract) —
cancellation of a physical branch is itself a bounded, verified action.

### 5.14 Journal

Append-only `JournalEvent` records (`agri.event/v1` from
[`packages/contracts`](../packages/contracts/README.md)) for: every activation
entry/exit with signal, every gate decision, every permit request/grant/deny/
expiry, every guard evaluation that changed truth value, every verification
result with measured values, every retry, every suspension and resume, every
operator interaction, and every safety event. Records carry configuration ids
(task, IR hash, cassette serial, firmware, map, calibration, model) so any line
can be reproduced. Journal write failure is visible to the operator and
inhibiting for further actuation — an unaudited action is not an acceptable
action.

## 6. Worked execution: `poultry-evening-feed.agri`

| # | Activation | Gate | Signal | Journal |
| --- | --- | --- | --- | --- |
| 1 | Validate bundle, `ir_hash`, manifest for `FD-01-00xx`, zones, operator policy | — | ready / refuse | `mission.armed` |
| 2 | `preflight` (6 assertions, each with freshness) | reads `safety.mode`, `cassette.latch` | `Continue` / fault | `preflight.evaluated` |
| 3 | `start_round: record task.started` | — | `Continue` | `task.started` |
| 4 | `to_lane: move along … at 0.40 m/s within 500 s` | zone + speed cap = min(task, manifest, zone) | `Suspend{physical_completion}` | `motion.goal_sent` |
| 5 | Nav feedback/timeout/result | watchdog healthy | `Continue` / fault | `motion.completed` |
| 6 | `feed_stops: for_each $stop … at_most 24` | bound ≤ policy | loop frame pushed | `loop.entered` |
| 7 | `at_station: dock at $stop.id tolerance 40 mm within 45 s` | station commissioned | `Suspend` → `Continue` | `dock.completed` |
| 8 | `dispense: actuate dispense_mass.v1 (…)` | permit `tool_energy`; mass ≤ manifest; idempotency key | `Suspend{physical_completion}` | `safety.permitted`, `tool.goal_sent` |
| 9 | Completion event with measured mass | — | evaluate `verify` | `tool.completed` |
| 10 | `verify { tool.dispensed_mass == $stop.mass @ within 2 s; … }` | freshness of each read | `Continue` / `on_mismatch` | `verify.passed` or `verify.failed` |
| 11 | `log_dose: record feed.delivered { … }` | — | `Continue` | `feed.delivered` |
| 12 | Next iteration or `on_exhausted fault` | — | loop | `loop.iteration` |
| 13 | `to_bay: return_to feed-service-bay within 500 s` | — | `Suspend` → `Continue` | `motion.completed` |
| 14 | `done: finish success` | — | `Terminate{success}` | `mission.completed` |
| 15 | Any fault above → `on_fault` | `safe_stop` request, `park_tool`, `notify stockperson` | `Terminate{failed TASK_FAULT}` | `task.faulted`, `safety.stop_requested` |

Step 10 is the one that makes this an engine for machines rather than for
messages: success is decided by a measurement of the world within a freshness
bound, not by the action's own report.

## 7. Determinism, conformance and two implementations

| Requirement | Mechanism |
| --- | --- |
| Same source → same bytes | Canonical IR serialisation, no timestamps, sorted keys, SI-normalised units |
| Same bytes → same behaviour | Interpreter decisions depend only on IR, resolved state and the injected clock |
| Testable time | `Clock` injection, `agric tick`, no wall-clock reads in the grammar |
| No hidden nondeterminism | No `random`, no iteration order dependence (collections are ordered), no float re-association |
| Two conforming implementations | TypeScript (`packages/compiler-core`, CI + Virtual Lab/WASM) and C++23 (`agri-engine`, edge) |
| Equivalence proven | Golden corpus: `.agri` source → canonical IR bytes → expected event trace; both implementations must match byte-for-byte and event-for-event |
| Regression by replay | Every field or bench failure becomes a recorded run plus a golden expectation |

Conformance corpus layout (planned):

```text
dsl/grammar/conformance/
  valid/<case>/task.agri            # source
  valid/<case>/ir.json              # canonical IR bytes (golden)
  valid/<case>/events.jsonl         # expected journal trace under a scripted world
  valid/<case>/world.json           # injected state timeline
  invalid/<case>/task.agri          # must be refused
  invalid/<case>/expected.json      # required error codes and node ids
```

`invalid/` cases are the more valuable half: duplicate ids, unreachable fault
clause, capability not in the registry, capability of the wrong cassette type,
`actuate` outside a permit, guard without freshness, loop bound above policy,
retry without idempotency key, unit mismatch, stale preflight read, subtask depth
exceeded, unknown keyword, unused field.

Interim enforcement today: `npm run check:grammar` verifies the BNF itself
(defined, reachable, non-duplicated productions), that the safety productions
still exist, that no forbidden construct has been added, that the grammar and the
`ALLOWED_ACTIONS` / capability allow-list have not drifted, and that the `.agri`
examples satisfy the syntactic safety invariants. When the parser lands, these
become parser tests and the script keeps checking the grammar file.

## 8. The safety boundary

| The engine may | The engine may not |
| --- | --- |
| Request a mode, a permit lease, a bounded motion goal, a bounded tool action | Grant a permit, clear a stop, change a safety mode |
| Reduce energy: `park_tool`, `safe_stop`, `degrade_to` | Increase a limit, widen a zone, extend a protective field |
| Refuse to start or continue (fail closed) | Infer permission from its own state or a recent success |
| Record everything | Rewrite, truncate or reorder the journal |
| Resume after re-verifying the world | Auto-resume after a safety stop or an unexplained anomaly |
| Retry with an idempotency key after re-verification | Blindly re-send a physical goal |

The independent safety controller remains the authority for e-stop, protective
fields, latch/ID interlock, brakes, tool energy and mode transitions
([`05_SAFETY_AND_COMPLIANCE.md`](05_SAFETY_AND_COMPLIANCE.md)). A task, the
engine, ROS 2, a model and the fleet service are all requesters.

## 9. Predictable deployment (the Sapo property, applied to robots)

| Sapo/USSD practice | AgriBots equivalent |
| --- | --- |
| Blueprint validated in CI before deploy | `agric validate --strict --json` in CI; exit code 2 blocks merge |
| Versioned blueprint + provider config | Signed bundle: IR hash, task version, capability registry hash, manifest hashes, map revision, model and calibration hashes |
| `sapoc describe` shows what the host can do | `agric describe` shows the robot's installed capabilities, limits and gate status |
| Predictable hosting in a Drogon service | Engine embedded as a static library in the ROS 2 executor node; host owns transport and concurrency |
| Session state in Redis, resumable across restarts | Mission checkpoints on-robot, resumable only after physical re-verification |
| Rollout per USSD service | Staged rollout: bench → simulator → HIL → staging robot → supervised pilot robot, with a rollback bundle per stage |

A deployment is refused when: the bundle signature or any referenced hash does
not verify; the capability registry does not contain a required capability; the
installed cassette serial or manifest disagrees; the map/zone is not commissioned
for this task; the gate or process approval is missing; the journal sink is
unavailable; or the safety controller is not in a permitting mode. Refusal is
exit code 4 or 2 with the reason set, and it is journaled.

Connectivity loss changes nothing locally: the robot continues the current
bounded statement, completes or faults it, parks, and waits. Fleet coordination
is an optimisation, never a dependency.

## 10. Verification and evidence

| Test level | What it proves | Evidence |
| --- | --- | --- |
| Grammar checks (`check:grammar`) | BNF well-formed; safety productions present; forbidden constructs absent; no drift from allow-lists | `VVT-DSL-*` |
| Parser unit tests | Every production parses; every invalid case is refused with the right code and node id | `VVT-DSL-*` |
| Validator tests | S1–S10 enforced; registry/manifest/zone/evidence checks | `VVT-DSL-*` |
| IR golden tests | Canonical bytes identical across implementations and runs | `VVT-DSL-*`, `VVT-EXE-*` |
| Interpreter tests (injected clock/world) | Signals, frames, deadlines, retries, guards, permits, parallel arbitration, checkpoints | `VVT-EXE-*` |
| Conformance traces | Expected journal events for scripted worlds, including every fault path | `VVT-EXE-*` |
| Simulation | Nominal + fault scenarios in Gazebo with the same IR | `VVT-SIM-*` |
| Replay | Recorded field/bench failures reproduced and fixed | `VVT-SIM-*` |
| HIL | Real safety controller: stops, interlocks, heartbeat loss, reaction times | `VVT-SAF-*`, `VVT-EE-*` |
| Vehicle/cassette | Physical dose, force, clearance, stability, cleanability, crop protection | `VVT-FD-*`, `VVT-EG-*`, `VVT-CS-*`, `VVT-WD-*`, `VVT-STB-*` |

No level substitutes for the level below it. A green interpreter test is not
evidence that a dose was delivered.

## 11. Work packages

| WP | Content | Exit criterion | Plan link |
| --- | --- | --- | --- |
| E1 | Lexer + parser for `agri.task/v1`; AST with source spans | Both `.agri` examples parse; every invalid corpus case refused with code + node id | [08](08_IMPLEMENTATION_PLAN.md) §4 WS-C 1–2 |
| E2 | `agri.expr/v1` compiler (units, freshness, closed built-ins, state roots) | Expressions compile once, evaluate deterministically, reject unresolved roots and unit errors | WS-C 1, 3 |
| E3 | `TaskValidator` with S1–S10 + registry/manifest/zone/evidence checks | Validator collects all issues; the four YAML recipes and two `.agri` tasks pass; corpus failures are precise | WS-C 3 |
| E4 | Canonical IR `agri.bt-ir/v0` + hashing + signing envelope | Byte-stable across runs and implementations; `agric compile`/`sign`/`diff` work | WS-C 4–5 |
| E5 | Interpreter: frames, signals, deadlines, retries, guards, permits, parallel arbitration | Golden traces match for nominal and every fault scenario under an injected clock | WS-C 6–7 |
| E6 | `SafetyGate` + `CapabilityRegistry` + `PhysicalActionBridge` (ROS 2) | No physical dispatch without a gate ALLOW; denial and stale-input paths tested on HIL | WS-E 2–4 |
| E7 | `MissionStore`, checkpoints, resume protocol, journal | Restart mid-mission resumes only after re-verification; safety-stop missions are non-resumable | WS-E 5–6 |
| E8 | `agric` CLI + CI integration + conformance corpus | `agric validate --strict --json` gates merges; corpus is green in CI on both implementations | WS-C, WS-H 1–2 |
| E9 | Virtual Lab integration (WASM build of the same compiler core) | The browser shows the identical IR hash and validation issues as CI | WS-B |

Sequencing: E1 → E2 → E3 → E4 in that order; E5 needs E4; E6/E7 need E5 and the
hardware bring-up ladder; E8 runs continuously from E1; E9 after E4.

## 12. Open decisions

| Decision | Options | Recommendation |
| --- | --- | --- |
| Primary authoring surface | `.agri` text vs YAML | `.agri` for humans and review; YAML stays as the interchange for existing recipes and tooling; JSON blueprint for machine exchange. All three compile to one IR |
| Expression engine | Port SEL / write `agri.expr/v1` fresh | Write fresh with SEL's shape: units and freshness are load-bearing and absent from SEL; reuse SEL's compile-once and memoisation discipline |
| Edge language | C++23 (Sapo lineage) vs Rust | C++23 for consistency with SapoEngine, ROS 2 Jazzy and BehaviorTree.CPP; keep the TypeScript compiler core for CI/Virtual Lab and prove equivalence by golden tests |
| IR shape | BehaviourTree.CPP XML vs internal JSON IR | Internal canonical JSON IR as authority; emit BehaviorTree.CPP XML only as an adapter if that runtime is selected |
| Shared code with SapoEngine | Fork / depend / extract `sapo-core` | Start as a sibling library; extract shared SEL-core, clock/scheduler, checkpoint store and validator harness later, when both are stable |
| Mission store | File / SQLite / Redis | SQLite on-robot (transactional, no network dependency); Redis only for off-robot fleet views |
| Fleet trigger model | Event bus / cron / operator-initiated | Operator-initiated and schedule-triggered only in v1; `trigger`-style autonomous start is reserved until the pilot evidence exists |

## 13. Out of scope for `agri.task/v1`

Swarm and handover constructs, learned-policy invocation, teleoperation from a
task, network or filesystem access, arbitrary scripting, egg shell treatment,
chemical/herbicide application, unvalidated weed actuation outside a guarded
plot, and any unsupervised operating mode. Each is reserved in the grammar or
gated behind its own evidence and approval path
([`08_IMPLEMENTATION_PLAN.md`](08_IMPLEMENTATION_PLAN.md) §2.3, §8).
