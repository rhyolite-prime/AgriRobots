# @agrirobots/compiler-core

AgriScript front end. One implementation of the recipe pipeline must serve CI,
the Virtual Lab and the edge deployment tool, so that a recipe reviewed in the
browser is bit-for-bit the recipe the robot verifies.

**Status:** scaffold. YAML loading and JSON Schema validation are implemented and
tested. Semantic validation, the bounded behaviour-tree IR, canonical
serialisation and signing are **not** implemented; `compileToIr()` raises
`NotImplementedError` rather than returning an unsafe partial result.

## Pipeline position

```text
recipe YAML -> [x] duplicate-key-safe parse -> [x] agri.script/v1 schema check
            -> [ ] capability / manifest check (@agrirobots/policy)
            -> [ ] semantic + policy checks -> [ ] bounded behaviour-tree IR
            -> [ ] sign -> [ ] journal -> [ ] approved deployment
```

## Contents

| Path | Purpose |
| --- | --- |
| `src/errors.ts` | Stable `E_*` error codes shared by CI, UI and edge runtime |
| `src/repo-paths.ts` | Repository-root discovery so paths never depend on cwd |
| `src/loader.ts` | Strict YAML parse: duplicate keys and merge keys rejected, bounded aliases, no custom tags |
| `src/schema-validation.ts` | Ajv 2020-12 validation against `dsl/schema/agri.script.v1.schema.json` and package schemas |
| `src/ir.ts` | `IR_VERSION`, seeded action allow-list, unimplemented `compileToIr()` |

## Invariants enforced today

- The four recipes in [`dsl/examples`](../../dsl/README.md) parse and validate.
- Duplicate keys, merge keys, unknown properties, a wrong `apiVersion`, an
  unknown `operatorPolicy` and a missing `on_fault` subtree are all rejected.
- Cross-package JSON Schemas (`@agrirobots/contracts`, `@agrirobots/domain-model`)
  compile and produce actionable errors.

## Rules for the next implementation step

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4
WS-C. In particular: finite loops, deadlines, retry bounds, idempotency,
capability/manifest agreement, zone and operator policy, and
model/calibration approval must all be checked **before** an artifact can be
signed, and the compiled IR must be byte-stable across runs.
