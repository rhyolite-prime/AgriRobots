# @agrirobots/asset-import (planned)

Ingestion and validation of 3D/robot-description assets so that the Virtual Lab,
the digital twin and the edge system all describe the same physical machine.

**Status:** placeholder — no package manifest yet, so it is intentionally outside
the npm workspace. Create it when the first real asset pipeline lands.

## Planned responsibilities

| Input | Checks | Output |
| --- | --- | --- |
| GLTF/GLB concept and CAD exports | scale, units, origin, naming, triangle budget, material sanity | Normalised preview asset with content hash |
| URDF/Xacro | link/joint names, frames, inertia positivity, collision vs visual separation, limit plausibility | Validated description plus frame report |
| Mass/CG database | agreement with measured values and the module manifest | Signed mass/CG record for stability analysis |
| Calibration bundles | transform completeness, timestamp, sensor serial agreement | Immutable calibration reference |

## Rules

- Assets are configuration items: every exported asset carries a content hash and
  a configuration ID, and a change is a reviewed change.
- Catalogue inertia or mass values are not acceptance evidence; measured values
  win, and a disagreement must raise an error rather than be silently rounded.
- A URDF that does not match the released drawings or the measured mass/CG record
  must fail import, because the twin would then validate the wrong machine.
- No asset import may alter safety limits. Limits come from the risk assessment
  and the module manifest.

See [`docs/01_MECHANICAL_DESIGN.md`](../../docs/01_MECHANICAL_DESIGN.md) and
[`docs/08_IMPLEMENTATION_PLAN.md`](../../docs/08_IMPLEMENTATION_PLAN.md) §4 WS-D.
