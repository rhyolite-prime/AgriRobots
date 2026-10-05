# AgriScript — an auditable task DSL for modular farm robots

**Status:** architecture draft (`agri.script/v1`), not an implementation/runtime release.

AgriScript is a deliberately small, **Sapo-style declarative layer** for calling approved robot capabilities. A recipe says *what approved operation should occur*; it does not contain raw motor commands, arbitrary program execution, safety logic, or credentials.

It is named independently because “Sapo DSL” in the project brief did not identify a public grammar/runtime to depend on. If a specific Sapo runtime is selected later, build an adapter that produces the same validated intermediate representation and retains the controls below.

## Runtime pipeline

```text
recipe YAML → YAML parser with duplicate-key rejection → JSON Schema validation
          → capability / module-manifest check → policy & route-zone check
          → bounded behavior-tree IR → operator approval → execution journal
          → ROS 2 actions (bounded) → module MCU → physical safety-permit gate
```

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
| [`schema/agri.script.v1.schema.json`](schema/agri.script.v1.schema.json) | Structural JSON Schema for the first draft (semantic/policy checks are separate) |
| [`examples/poultry-evening-feed.yaml`](examples/poultry-evening-feed.yaml) | Calibrated feed route with bounded dispensing |
| [`examples/egg-collection-round.yaml`](examples/egg-collection-round.yaml) | Traceable egg collection; deliberately no shell treatment action |
| [`examples/controlled-sanitation.yaml`](examples/controlled-sanitation.yaml) | Approved-zone wet sanitation with process-record fields |
| [`examples/guarded-early-weeding.yaml`](examples/guarded-early-weeding.yaml) | Crop-protective actuation gate and abstention action |

## Implementation work package

1. Define Protobuf/JSON state/action contracts and the grammar's formal semantics.
2. Implement duplicate-key-safe YAML parse, JSON Schema validation, semantic validator and deterministic IR compiler.
3. Implement a policy service for RBAC, zones, chemical/food approvals, cassette/manifests, speed/tool limits and model approval.
4. Compile to a tested behavior-tree runtime with cancellation, rollback/compensation, resume rules and durable event journal.
5. Add simulator and HIL conformance tests for every allow-listed capability/fault state.
6. Build a review UI that displays the compiled task graph, capability/ODD limits and exact evidence record before signing.

The JSON Schema is intentionally permissive inside `steps`: it catches structural errors but cannot prove a route is commissioned, an operator is authorized, or a chemical is allowed. Those are mandatory semantic/runtime checks.
