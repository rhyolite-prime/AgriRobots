# ai/evaluation

Held-out, replay, shadow-mode and drift evaluation reports.

**Status:** placeholder.

## Report contents

- Dataset manifest and split used, with site/season/lighting/cultivar metadata
- Metrics with confidence intervals, plus per-class and per-site breakdowns
- Confidence calibration and abstention behaviour, including false-action rate
- Replay results against recorded failures
- Shadow-mode summary: detections, abstentions, operator disagreements
- Drift indicators: sensor contamination, calibration age, lighting/soil/cultivar
  change, confidence shift
- Explicit pass/fail against the gate criteria and the resulting decision

## Rules

- Evaluation on training data or on a leaked split is not evidence.
- A metric improvement never authorises actuation by itself; the relevant gate
  (for example G7 for weeding) requires crop-protection, latency, exclusion-radius,
  placement and force evidence as well.
- Failing a threshold reverts the capability to shadow or sensing-only mode and
  preserves the logs for diagnosis.
