# AgriScript — an auditable task DSL for modular farm robots

**Status:** architecture draft (`agri.script/v1`), not an implementation/runtime release.

AgriScript is a deliberately small, **Sapo-style declarative layer** for calling approved robot capabilities. A recipe says *what approved operation should occur*; it does not contain raw motor commands, arbitrary program execution, safety logic, or credentials.

Its execution engine is the robotics sibling of the **Sapo Engine** ([`rhyolite-prime/SapoEngine`](https://github.com/rhyolite-prime/SapoEngine)), a DSL-driven execution engine that standardised USSD service construction in place of hand-written `if/else` session managers and made USSD deployment and hosting predictable. AgriScript reuses that proven architecture — blueprint parsed once into an AST, expressions compiled at parse time, capability calls resolved against a registry where an unknown name is refused statically, durable suspension instead of parked threads, static graph validation before execution, and a deterministic CLI — and changes what a physical machine forces to change: mandatory deadlines and world-verified post-conditions on every actuation, syntactically bounded loops, explicit safety-permit requests, continuous invariant guards, unit-bearing quantities, staleness bounds on state reads, and no production at all for scripting, network, filesystem or raw actuator access.

The engine is built as a **separate library in the Sapo lineage**, not by embedding the USSD engine in a robot: the safety-relevant binary must not contain HTTP, script or filesystem capabilities at all, because their absence is part of the assurance argument. The formal grammar and the full engine design are in [`grammar/agri.task.v1.bnf`](grammar/agri.task.v1.bnf) and [`../docs/09_DSL_AND_EXECUTION_ENGINE.md`](../docs/09_DSL_AND_EXECUTION_ENGINE.md).

## Runtime pipeline

```text
recipe YAML → YAML parser with duplicate-key rejection → JSON Schema validation
          → capability / module-manifest check → policy & route-zone check
          → bounded behavior-tree IR → operator approval → execution journal
          → ROS 2 actions (bounded) → module MCU → physical safety-permit gate
```

Three serialisations describe one task — `.agri` text for authoring and review, `agri.script/v1` YAML as the interchange form, and a JSON blueprint for machine exchange — and all three compile to the same canonical `agri.bt-ir/v0` bytes. That IR, not the source text, is what gets signed and executed.

A recipe must be signed after validation. At runtime, the executor verifies the recipe hash, schema version, map/zone revision, cassette serial/manifest, calibration/model versions, operator policy and safety-controller mode. It then writes an append-only event for every transition/action/fault.

## Trust and safety contract

- Only action names in the installed **allow-list** compile. No inline shell, Python, network request, arbitrary ROS topic publish, or dynamic library loading.
- All loops are finite and all actuator/motion actions have deadlines, maximum values and idempotency/event semantics.
- A recipe can request `safe_stop` and `park_tool`; it cannot cancel an e-stop, expand a protective field, raise a speed cap, or energize a tool without the physical permit path.
- Capability claims come from a signed, inspected cassette manifest. A string such as `mechanical_weed.v1` does not itself make a tool safe.
- Conditions may read only timestamped, typed state registered in the expression allow-list. Compiler rejects stale/unknown/ambiguous state.
- The final compiler target should be a reviewed behavior-tree IR with an explicit `on_fault` subtree, not direct string interpretation during motion.

## Repository contents

| Path | Content |
| --- | --- |
| [`grammar/agri.task.v1.bnf`](grammar/agri.task.v1.bnf) | Formal BNF for the textual task language: statements, expressions, identifiers, reserved and deliberately absent constructs |
| [`grammar/README.md`](grammar/README.md) | Grammar conformance rules, Sapo lineage, safety properties enforced by syntax, and the production → YAML → engine mapping |
| [`schema/agri.script.v1.schema.json`](schema/agri.script.v1.schema.json) | Structural JSON Schema for the interchange form (semantic/policy checks are separate) |
| [`examples/poultry-evening-feed.yaml`](examples/poultry-evening-feed.yaml) | Calibrated feed route with bounded dispensing |
| [`examples/egg-collection-round.yaml`](examples/egg-collection-round.yaml) | Traceable egg collection; deliberately no shell treatment action |
| [`examples/controlled-sanitation.yaml`](examples/controlled-sanitation.yaml) | Approved-zone wet sanitation with process-record fields |
| [`examples/guarded-early-weeding.yaml`](examples/guarded-early-weeding.yaml) | Crop-protective actuation gate and abstention action |
| [`examples/poultry-evening-feed.agri`](examples/poultry-evening-feed.agri) | Textual `agri.task/v1` twin of the feed recipe |
| [`examples/guarded-early-weeding.agri`](examples/guarded-early-weeding.agri) | Textual twin exercising `observe`/`abstain_if`, `guard`, `with_permit`, `degrade_to` |

## Implementation work package

1. Define Protobuf/JSON state/action contracts and the grammar's formal semantics.
2. Implement duplicate-key-safe YAML parse, JSON Schema validation, semantic validator and deterministic IR compiler.
3. Implement a policy service for RBAC, zones, chemical/food approvals, cassette/manifests, speed/tool limits and model approval.
4. Compile to a tested behavior-tree runtime with cancellation, rollback/compensation, resume rules and durable event journal.
5. Add simulator and HIL conformance tests for every allow-listed capability/fault state.
6. Build a review UI that displays the compiled task graph, capability/ODD limits and exact evidence record before signing.

The JSON Schema is intentionally permissive inside `steps`: it catches structural errors but cannot prove a route is commissioned, an operator is authorized, or a chemical is allowed. Those are mandatory semantic/runtime checks.
