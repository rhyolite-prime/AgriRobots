# fleet — non-safety control plane

Robot registry, artifact rollout and audit services.

**Status:** placeholders. Nothing here may operate a physical machine until the
single-robot signed-artifact path and rollback tests pass.

| Directory | Purpose |
| --- | --- |
| [`control-plane`](control-plane/README.md) | Registry, rollout, health and audit services |
| [`schemas`](schemas/README.md) | Robot, artifact and deployment manifests |

## Standing rules

- Fleet services are **non-safety** orchestration. Loss of connectivity must leave
  local stop, park and recovery behaviour intact, and must never enable an
  unsafe resume.
- Every deployed artifact is signed, hash-referenced and approved against a gate;
  a partially installed or unapproved bundle must not run.
- Access is authenticated, role-based and audited: mutual TLS or equivalent,
  RBAC, VPN/jump access, SBOM and configuration hashes, staged rollout, tested
  rollback.
- Telemetry, dashboards and task allocation are separate from safety control and
  from the recipe-signing path.
- Multi-robot coordination is a later capability; a handover must carry mission
  state, recipe hash, zone, module state and operator approval, and must not
  assume another robot can safely resume at an arbitrary physical state.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../docs/08_IMPLEMENTATION_PLAN.md) §4 WS-H.
