# test_evidence

Verification and validation records (`VVT-*`), reports and configuration hashes.

**Status:** placeholder with a record template. Large artifacts (bags, videos,
point clouds, raw logs) are ignored by Git and stored externally; the record
itself, its hashes and its location reference are committed.

## Evidence classes

| Prefix | Subject |
| --- | --- |
| `VVT-VL-*` | Virtual Lab assembly, UCI validation, twin export |
| `VVT-DSL-*` | Compiler acceptance and rejection behaviour |
| `VVT-EXE-*` | Edge execution, signing and artifact verification |
| `VVT-SIM-*` | Simulation and replay scenarios |
| `VVT-SAF-*` | Safety functions, stops, mode transitions, reaction times |
| `VVT-EE-*` | Electrical, connector, insulation, thermal, EMC |
| `VVT-UCI-*` | Interface exchanges, latch/ID interlock, mis-seat faults |
| `VVT-NAV-*` | Localisation, route following, docking, speed zones |
| `VVT-STB-*` | Stability, braking, mass/CG, grade behaviour |
| `VVT-STR-*` | Structural, fatigue, load and FEA correlation |
| `VVT-FD-*` / `VVT-CS-*` / `VVT-EG-*` / `VVT-WD-*` | Cassette task evidence |
| `VVT-CFG-*` | Configuration, OTA, rollback, access and audit |

## Rules

- Use [`TEMPLATE_VVT_RECORD.md`](TEMPLATE_VVT_RECORD.md) for every record.
- A record without configuration IDs, raw-data location and hashes is not
  evidence.
- Evidence is append-only: a retest creates a new record that references the old
  one.
- A passing test in one class never waives a requirement in another.

See [`docs/03_EXECUTION_PLAN_AND_VV.md`](../docs/03_EXECUTION_PLAN_AND_VV.md).
