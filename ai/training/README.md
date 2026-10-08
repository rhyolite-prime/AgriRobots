# ai/training

Reproducible training jobs for perception, confidence calibration and bounded
policies.

**Status:** placeholder.

## Requirements for every job

- Committed config with dataset manifest IDs, split, preprocessing and
  augmentation definitions
- Pinned environment and dependency lock
- Deterministic seeding where supported, and an explicit statement where it is not
- Output artifacts with content hashes, metrics and a model card
- A registered rollback artifact for the previously approved model

## Reinforcement learning constraints

RL is subordinate to measured evidence. Any RL work must use bounded action
spaces, safety shields, scenario randomisation, and deterministic regression
tests, and must be evaluated in replay and shadow mode before a guarded physical
trial. A learned policy never bypasses the capability allow-list, the module
manifest limits or the safety controller.
