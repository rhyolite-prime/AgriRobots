# @agrirobots/domain-model

Canonical identifiers and the `agri.module/v1` manifest validator for the AP-01
carrier, UCI-01 interface and the EG-01/FD-01/CS-01/WD-01 cassettes.

**Status:** scaffold. Structural validation only; values still come from the
design package and are not measured hardware data.

## Contents

| Path | Purpose |
| --- | --- |
| `src/identifiers.ts` | Carrier, cassette, serial, drawing, zone, gate and `VVT-*` evidence identifiers |
| `src/module-manifest.ts` | `validateModuleManifest()` and zone-class authorisation |
| `schemas/agri.module.v1.schema.json` | Language-neutral manifest schema for ROS 2 / C++ / Python consumers |

## Rules

- The validator **rejects** missing measurements. It never substitutes a default
  mass, centre of gravity, current limit or zone class.
- A valid manifest is an engineering assertion, not trust: it is issued only
  after inspection, measurement, electrical test, firmware review and
  configuration approval.
- Manifest data must agree with the released drawings
  (`drawings/AGR-110_UCI01_PAYLOAD_INTERFACE.svg` and the cassette drawings) and
  with the filled mass/CG database before a cassette is armed.
- Cassette type and serial prefix must agree (`FD-01-####` is a feed cassette).

See [`docs/01_MECHANICAL_DESIGN.md`](../../docs/01_MECHANICAL_DESIGN.md) and
[`docs/02_CONTROLS_SOFTWARE_AND_DSL.md`](../../docs/02_CONTROLS_SOFTWARE_AND_DSL.md) §4.
