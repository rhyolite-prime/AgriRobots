# ai — data, models and evaluation

Perception, confidence calibration and (later) bounded learned policies.

**Status:** placeholders. No datasets, models or training jobs exist yet.

| Directory | Purpose |
| --- | --- |
| [`datasets`](datasets/README.md) | Manifests, labels, splits and governance |
| [`training`](training/README.md) | Reproducible CV/RL jobs |
| [`evaluation`](evaluation/README.md) | Held-out, replay and drift reports |

## Standing rules

- Held-out farm/site data outranks synthetic data. Synthetic images may support
  training only with a documented comparison on real held-out data.
- Perception emits measurements with uncertainty, model ID, data ID and
  calibration ID. It never commands a hazardous actuator directly.
- Confidence must be calibrated, and abstention must be a first-class outcome
  (`abstained_detection`), never a silent retry or a relaxed margin.
- A learned policy may be deployed only as an approved bounded action block with
  explicit time, force and velocity limits, behind the same allow-list and safety
  permit path as any other action.
- Every released model carries a model card, provenance, rollback artifact and
  drift-monitoring plan.

See [`docs/08_IMPLEMENTATION_PLAN.md`](../docs/08_IMPLEMENTATION_PLAN.md) §4 WS-G.
