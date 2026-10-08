# fleet/control-plane

Registry, rollout, health and audit services.

**Status:** placeholder — no service code exists.

## Planned capabilities, in order

1. **Inventory registry** — robot identity, cassette serials and manifests,
   firmware, ROS bundle hash, maps, calibration, models, recipes and last known
   configuration.
2. **Artifact store** — signed envelopes with content hashes and approval records
   (`agri.artifact/v1`).
3. **Staged rollout** — bench/simulator, then staging robot, then supervised pilot
   robot, with an explicit rollback point per stage.
4. **Health and audit** — typed events, retention policy, incident and change
   history, exportable for review.
5. **Task allocation** — only after single-robot behaviour is stable and audited.

## Rules

- The control plane may **inhibit** operation (by withholding approval) but may
  never **enable** physical motion. Enable comes from the safety controller.
- No credentials, signing keys or personal data are committed to this repository.
- An interrupted or invalid update must leave the robot in a known safe
  configuration and refuse to run a partially installed bundle.
