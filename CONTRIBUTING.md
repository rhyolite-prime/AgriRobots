# Contributing

This repository is an **engineering and safety artefact**, not only source code.
A change here can alter what a machine is allowed to do on a farm with animals,
food, chemicals and crops present, so the rules below are part of the design.

## Before you start

1. Read [`docs/00_DESIGN_BASIS.md`](docs/00_DESIGN_BASIS.md) for scope and the
   operating design domain.
2. Read [`docs/08_IMPLEMENTATION_PLAN.md`](docs/08_IMPLEMENTATION_PLAN.md) for the
   workstreams, boundaries and gates.
3. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) §"Boundaries" below. If your change
   crosses a boundary, split it.

## Development setup

Requires Node.js 20.11 or newer (see [`.nvmrc`](.nvmrc)).

```bash
npm ci            # install workspace dependencies
npm run verify    # structure, links, types, lint, format, tests
```

Individual steps:

| Command | Purpose |
| --- | --- |
| `npm run check:tree` | Required boundaries exist; no safety-controller code outside the safety path |
| `npm run check:links` | Every relative Markdown link resolves |
| `npm run typecheck` | Strict TypeScript across `packages/*` |
| `npm run lint` | ESLint (flat config, `typescript-eslint`) |
| `npm run format` / `npm run format:check` | Prettier for code and configuration |
| `npm test` | Vitest unit and contract tests |

Authored engineering documents under `docs/`, `dsl/` and `drawings/` keep their
own hand formatting and are excluded from Prettier.

## Boundaries

| Boundary | May do | Must not do |
| --- | --- | --- |
| `apps/virtual-lab` | Assemble, inspect, review, export | Command hardware; hold signing keys; act as a safety function |
| `packages/contracts` | Define typed, versioned information | Contain permission logic or physical behaviour |
| `packages/domain-model` | Validate identifiers and manifests | Invent default masses, limits or zone classes |
| `packages/compiler-core` | Parse, validate, compile, hash | Evaluate arbitrary code; emit unbounded actions |
| `packages/policy` | Refuse what is not approved | Grant physical permission; relax a gate |
| `ros_ws` | Bounded autonomy and module behaviour | Replace the independent safety controller |
| `simulation` | Reproduce scenarios and faults | Count as physical safety evidence |
| `ai` | Measure, calibrate, report | Command a hazardous actuator directly |
| `fleet` | Register, roll out, audit | Enable motion; operate without local safe behaviour |

Two invariants are enforced by `npm run check:tree` and by review:

- **Safety independence.** No safety-controller implementation, e-stop logic or
  protective-field configuration may live under `apps/`, `simulation/`, `fleet/`
  or `ai/`.
- **Single compiler.** The recipe pipeline used by CI, the Virtual Lab and the
  edge deployment tool is one implementation (`packages/compiler-core`), so a
  reviewed recipe is byte-for-byte the deployed recipe.

## Change rules

- **Fail closed.** A validator that cannot decide must reject, with a reason a
  human can act on. Never substitute a default for a missing measurement,
  capability, calibration, zone or approval.
- **Versioned contracts.** Changing a type in `packages/contracts` or a JSON
  Schema means changing the type, the schema, the tests and the affected
  `VVT-*` expectations in the same change set.
- **Evidence.** A capability, gate or safety-relevant change names its evidence
  class (`VVT-SAF-*`, `VVT-UCI-*`, `VVT-FD-*`, …) and records it under
  [`test_evidence/`](test_evidence/README.md) using the
  [template](test_evidence/TEMPLATE_VVT_RECORD.md).
- **No secrets or credentials** in the repository: no signing keys, tokens, farm
  personal data, or customer site data.
- **No large binaries in Git.** Recordings, datasets, bags and videos are ignored;
  commit the manifest, hash and external location instead. `check:tree` fails on
  tracked files above 5 MB.
- **Recipes are immutable once approved.** A change is a new version and a new
  signature, not an edit in place.

## What "done" means

See [`docs/08_IMPLEMENTATION_PLAN.md`](docs/08_IMPLEMENTATION_PLAN.md) §6. In
short: reviewed, versioned, tested (including negative paths), observable through
typed events and a durable journal, reproducible from a committed fixture, with a
named owner and linked evidence. A simulator or unit test never substitutes for
physical braking, stability, force, EMC, cleanability, food/process, chemical,
animal-welfare or crop-protection validation.

## Commit and review conventions

- Small, reviewable change sets. One boundary per pull request where practical.
- Imperative subject line, prefixed by area: `docs:`, `compiler:`, `policy:`,
  `contracts:`, `domain-model:`, `sim:`, `ros:`, `ci:`.
- Reference the workstream (WS-A…WS-H) and gate when relevant.
- A pull request that changes safety-relevant behaviour requires review from the
  safety owner in addition to a code reviewer.
- Do not merge with a skipped or failing `npm run verify`.
