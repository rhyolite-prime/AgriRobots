# simulation/replay

Deterministic playback of recorded runs and datasets.

**Status:** placeholder.

## Purpose

Replay is the primary regression mechanism: a fix is proven by re-running the
recorded failure, not by a new live demonstration.

## Required for every replayable run

- Recipe hash and compiled IR version
- Map revision, zones and route commissioning state
- Cassette serial, manifest hash, firmware and calibration bundle hash
- Model versions and dataset identifiers
- ROS message definitions and software bundle hash
- Safety-controller mode transitions and event journal
- Sensor quality/uncertainty as recorded, not reconstructed

## Rules

- Replay must be reproducible from committed metadata plus externally stored
  recordings; recordings themselves stay out of Git.
- A replay that cannot resolve every configuration ID must fail rather than run
  with defaults.
- Replay results feed `VVT-SIM-*` and `VVT-EXE-*` evidence, and are never
  accepted as physical safety evidence on their own.
