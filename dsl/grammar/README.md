# AgriScript grammar — `agri.task/v1`

Formal BNF for the task language executed by the AgriBots engine, plus the
conformance rules that tie the grammar to the YAML recipes, the capability
registry and the safety case.

| File | Content |
| --- | --- |
| [`agri.task.v1.bnf`](agri.task.v1.bnf) | The grammar: document structure, statements, expressions, identifiers, lexical rules, reserved and deliberately absent constructs |
| [`../examples/poultry-evening-feed.agri`](../examples/poultry-evening-feed.agri) | Textual twin of the feed YAML recipe |
| [`../examples/guarded-early-weeding.agri`](../examples/guarded-early-weeding.agri) | Exercises `observe`/`abstain_if`, `guard`, `with_permit`, `degrade_to` |
| [`../../docs/09_DSL_AND_EXECUTION_ENGINE.md`](../../docs/09_DSL_AND_EXECUTION_ENGINE.md) | The execution engine derived from this grammar |

The engine design follows the grammar, not the other way round: every production
names a statement class, every statement class names a runtime behaviour, and
every refusal the engine can make is traceable to a production or a numbered
semantic rule (`S1`–`S11`) in the grammar file.

## Lineage

The engine is the robotics sibling of the Sapo DSL execution engine
([`rhyolite-prime/SapoEngine`](https://github.com/rhyolite-prime/SapoEngine)),
which standardised USSD service construction in place of hand-written `if/else`
session managers. From Sapo this grammar keeps:

- a node/statement graph with explicit ids and jumps, statically validated
  before execution (`BlueprintValidator` → `TaskValidator`);
- expressions compiled once at parse time into immutable programs (SEL → `agri.expr/v1`);
- capability calls by dotted name resolved against a registry, where an unknown
  capability is a **parse-time** refusal with no shell fallback;
- durable suspension instead of parked threads (`SuspendRequest` → `await`);
- mandatory error handling and a deterministic CLI (`sapoc` → `agric`).

What a physical machine forces to change:

| Sapo (information work) | AgriScript (physical work) |
| --- | --- |
| Timeouts optional per node | `within <duration>` **mandatory** on every motion and actuation |
| Result of a call is its return value | Result must be proven by `verify { … }` post-conditions on observable state |
| `loop` with a collection | `for_each … at_most N`, `repeat N times` — no unbounded loop production exists |
| `retry` block, freely repeatable | Retry requires an `idempotency_key`; a physical action is never blindly repeated |
| `script` node with `expr` code | No script/exec production at all |
| `command http.post` | No network, filesystem or raw-actuator production |
| Failure ends a session | Failure must reach `on_fault`, which is a required clause |
| State is a JSON context | State roots are a closed, read-only list with staleness bounds |
| Concurrency is a throughput feature | `parallel` branches declare a `<resource-spec>` (class or instance, e.g. `tool[hand_3]`); exclusive claims are arbitrated statically (S11) and at run time |
| — | `with_permit` / `request_permit`: hazardous energy is requested, never granted by the task |
| — | `guard … @ within … every …`: a continuous invariant over a whole block |

## Safety properties enforced by syntax

These are grammar facts, not conventions. If a construct is not derivable, it
cannot be signed or executed.

| Property | Mechanism in the grammar |
| --- | --- |
| Every actuation is time-bounded | `"within" <duration>` is part of `<actuate-stmt>` |
| Every actuation is verified against the world | `"verify" "{" <postcondition>+ "}"` is part of `<actuate-stmt>` |
| No infinite iteration | Only `for_each … at_most <integer>` and `repeat <integer> times` exist |
| No blind retry of a physical action | `<retry-spec>` requires `idempotency_key` |
| Fault handling is not optional | `<fault-clause>` is required inside `<task-body>` |
| Hazardous energy needs permission | `<permit-stmt>` plus semantic rule S4 (lexical enclosure) |
| Invariants hold continuously, not just at entry | `<guard-block>` with freshness bound and `every <duration>` |
| Safety-relevant reads cannot be stale | `<freshness>` production plus semantic rule S5 |
| Dimensions cannot be mixed silently | `<quantity> ::= <number> <unit>` plus semantic rule S9 |
| No arbitrary code, network, filesystem or motor access | Listed as deliberately absent in §6 of the grammar |
| No authority over the safety controller | No `grant`/`clear`/`override`/`raise_limit` production; `safety.*` is read-only |
| No nondeterminism | No `random`, `now` or `today`; time comes from the injected engine clock |
| No general mutation | Variables are bound only by `observe … into` and `await operator … reply` |
| Evidence retention is declared, not implied | `<evidence-clause>` is required inside `<task-body>` |

## Surface forms and the single IR

One task, three serialisations, one compiled artifact:

```text
.agri text  ─┐
             ├─► AST (grammar productions) ─► semantic checks S1–S11
agri.script/v1 YAML ─┘                              │
                                                    ▼
                                  agri.bt-ir/v0 — canonical, byte-stable,
                                  hashable, signable, the only thing the
                                  engine executes
```

- **`.agri` text** is the authoring and review surface: it reads like the
  operation it describes and makes deadlines, bounds, permits and verification
  visible on the page.
- **`agri.script/v1` YAML** ([`../schema`](../schema/agri.script.v1.schema.json))
  remains the interchange form already used by the four draft recipes and by
  `@agrirobots/compiler-core` tests.
- **JSON blueprint** (Sapo-style node array) is the machine-to-machine form the
  editor, simulator and fleet registry exchange.

The equivalence requirement is testable and mandatory: for every example,
`.agri` → IR and YAML → IR must produce the same canonical bytes, or the
difference must be an explicit, reviewed mapping decision recorded in the table
below and covered by a golden test.

### Production → YAML → engine mapping

| Grammar production | `agri.script/v1` YAML | Engine statement class |
| --- | --- | --- |
| `task <name>@<version>` | `metadata.name`, `metadata.version` | `TaskBlueprint` |
| `<meta-clause>` | `metadata.owner`, `metadata.changeTicket` | blueprint metadata |
| `<requires-clause>` | `spec.requires` | `RequirementSet` |
| `<limits-clause>` | `spec.limits` | `LimitSet` |
| `<preflight-clause>` | `spec.preflight` | `PreconditionList` |
| `move along … at … within` | `navigate` | `MotionStatement` |
| `dock at … tolerance … within` | `dock` | `MotionStatement` |
| `return_to … within` | `return_to` | `MotionStatement` |
| `actuate <cap>(…) within … verify {…}` | `dispense_mass`, `apply_volume`, `collect_egg`, `mechanical_weed` | `ToolStatement` |
| `observe <cap>(…) into $x abstain_if …` | `inspect`, `scan_row` | `SenseStatement` |
| `await … within …` | step `timeout_s` fields | `AwaitStatement` (suspends) |
| `with_permit` / `request_permit` | implied by safety mode | `PermitStatement` |
| `guard … every … on_breach` | partly `preflight` | `InvariantFrame` |
| `for_each $x in … at_most N` | `for_each` + `maximum_iterations` | `LoopFrame` |
| `repeat N times` | not present in YAML v1 | `LoopFrame` |
| `when … otherwise …` | `when` | `BranchFrame` |
| `parallel { branch <resource-spec> … } join` | not present in YAML v1 | `ParallelFrame` + resource arbitrator |
| `actuate … using <resource-spec>` / `with_permit … on <resource-spec>` | not present in YAML v1 | extra claim / permit lease scope |
| `record <event> { … }` | `record` | `JournalStatement` |
| `safe_stop` / `park_tool` / `degrade_to` / `notify` | `safe_stop`, `park_tool`, `notify` | `SafetyRequestStatement` |
| `run_task … depth_at_most N` | not present in YAML v1 | `SubtaskStatement` |
| `finish success|failed|aborted` | end of `steps` | `TerminateStatement` |
| `<fault-clause>` | `spec.on_fault` | `FaultHandler` |
| `<evidence-clause>` | `spec.evidence.retain` | `EvidencePolicy` |
| `<expr>` (`agri.expr/v1`) | `preflight` strings, `${…}` interpolation | compiled expression program |

Where YAML v1 has no equivalent (`repeat`, `parallel`, `run_task`, explicit
`await`, `guard`), the YAML form is the restricted subset: it may express less,
never more. Adding those to YAML requires a schema revision, not a workaround.

## Reserved for later versions

Using these in v1 is a compile-time error, so that a future grammar revision
cannot silently change the meaning of an existing task:

`swarm`, `handover`, `follow`, `convoy`, `learned_policy`, `policy_network`,
`remote_command`, `teleoperate`.

## Changing the grammar

A grammar change is a configuration-control event:

1. Edit [`agri.task.v1.bnf`](agri.task.v1.bnf) and the semantic rules together.
2. Update the mapping table above and the JSON Schema / TS types it feeds.
3. Add or update `.agri` and YAML examples, plus golden IR fixtures.
4. Run `npm run check:grammar` (undefined nonterminals, required safety
   productions, forbidden productions, example/grammar agreement) and
   `npm run verify`.
5. Record the change against `VVT-DSL-*` evidence and the affected gate.

A construct may only be **added** with a hazard analysis, a capability registry
entry, a policy allow-list entry and a verification plan. Nothing in the
"deliberately absent" list may be added by a grammar edit alone.
