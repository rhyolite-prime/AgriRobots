# @agrirobots/contracts

Versioned contracts shared by every AMARS subsystem: the Nuxt Virtual Lab, the
simulation/replay stack, the AgriScript compiler, the ROS 2 edge runtime and the
non-safety fleet services.

**Status:** scaffold. Types and JSON Schemas only — no runtime behaviour, no
signing implementation and no transport.

## Contents

| Path | Purpose |
| --- | --- |
| `src/schema-versions.ts` | Canonical `agri.*/v1` identifiers; a change is a configuration-control event |
| `src/events.ts` | Safety states, signal quality, event sources, `JournalEvent` |
| `src/artifacts.ts` | `SignedArtifactEnvelope`, `DeploymentManifest`, hash guard |
| `schemas/agri.event.v1.schema.json` | Language-neutral event schema for ROS/Python/C++ consumers |
| `schemas/agri.artifact.v1.schema.json` | Language-neutral signed-envelope schema |

## Rules

- These contracts describe **information**, never permission. Nothing here can
  authorise motion; only the independent safety controller can.
- `safetyState: UNKNOWN` and `quality: STALE` are inhibiting values, not neutral
  ones.
- TypeScript types and the JSON Schemas must stay in sync; the schema files are
  the cross-language source of truth.
- Adding a field is a reviewable change: update the type, the schema, the tests
  and the `VVT-EXE-*` / `VVT-CFG-*` evidence expectations together.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §3
and [`docs/02_CONTROLS_SOFTWARE_AND_DSL.md`](../../docs/02_CONTROLS_SOFTWARE_AND_DSL.md).
