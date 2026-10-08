# @agrirobots/policy

Capability allow-list and approval-gate checks. This package decides whether a
recipe or manifest claim may be **compiled, signed and enabled**, and it fails
closed.

**Status:** scaffold with a working draft allow-list. Zone/route commissioning,
operator RBAC, chemical and food-process approvals, model/calibration approval
and speed/tool limit policy are not implemented yet.

## Contents

| Path | Purpose |
| --- | --- |
| `data/capability-allow-list.yaml` | Draft `agri.policy.capability-allow-list/v1` entries with hazard class, minimum gate and approval needs |
| `src/allow-list.ts` | Parsing, capability lookup, recipe/manifest checks, release-readiness gating |
| `src/errors.ts` | `PolicyError` with stable `E_POLICY_*` codes |

## Encoded decisions

- Only five capabilities exist: `dispense_mass.v1`, `apply_volume.v1`,
  `collect_egg.v1`, `inspect_plant.v1`, `mechanical_weed.v1`.
- There is **no** egg shell treatment, chemical application or herbicide
  capability, and a test fails if one is added without review.
- `mechanical_weed.v1` is `actuation_gated` at **G7** with mandatory process
  approval; `inspect_plant.v1` is `sensing_only`.
- A `draft` allow-list is usable for bench, simulation and replay work, but a
  physical release requires status `released`.
- Capability identifiers never grant permission by themselves. Physical
  permission comes from the independent safety controller and the inspected
  cassette manifest.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4
WS-C and [`docs/05_SAFETY_AND_COMPLIANCE.md`](../../docs/05_SAFETY_AND_COMPLIANCE.md).
