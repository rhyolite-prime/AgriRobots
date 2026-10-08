# fleet/schemas

Robot, artifact and deployment manifests for the non-safety control plane.

**Status:** placeholder. The signed envelope and deployment manifest contracts
already exist in
[`packages/contracts/schemas`](../../packages/contracts/schemas/agri.artifact.v1.schema.json);
fleet-specific schemas (robot registry record, rollout plan, audit export) are
added here once the registry is designed.

## Rules

- Fleet schemas must reference the shared contract schemas rather than redefining
  hashes, gates or safety states.
- Every schema carries an explicit `schemaVersion` and is validated in CI.
- A schema change is a configuration-control event with a migration and rollback
  note.
