# ai/datasets

Dataset manifests, label guides, splits and governance records.

**Status:** placeholder. Raw and derived data directories are ignored by Git;
only manifests, label guides, split definitions and governance records are
committed.

## Required before any collection

- Named data owner and lawful basis for farm, worker, animal, crop and video data
- Site/biosecurity and privacy rules, including who may view recordings
- Label guide with inclusion/exclusion criteria and annotator training
- Split policy that keeps sites, seasons, lighting and cultivars from leaking
  between train, validation and test
- Provenance: sensor, calibration, timestamp, location, crop/animal state

## Manifest fields

`datasetId`, `revision`, `site`, `cropOrFlock`, `season`, `sensor`,
`calibrationBundleHash`, `splitAssignments`, `labelGuideRevision`,
`annotatorAgreement`, `retentionPolicy`, `contentHash`.

## Rules

- No dataset may be used for a release decision without a committed manifest and
  a recorded split.
- Deleting or relabelling data is a versioned change, not an edit in place.
- A dataset that cannot be traced to a calibration and a site condition is not
  usable evidence.
