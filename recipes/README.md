# recipes

Reviewed, approved and signed AgriScript recipes for real use, plus fixtures.

**Status:** placeholder. Draft examples live in
[`dsl/examples`](../dsl/README.md) and remain the reference corpus for compiler
and policy tests.

## Promotion path

```text
dsl/examples (draft) -> bench/simulation validation -> policy and gate review
                   -> signed artifact (agri.artifact/v1) -> recipes/ (approved)
                   -> supervised execution with journal evidence
```

A recipe moves here only with: a recorded review, the approved capability and
gate, the cassette manifest and calibration it was validated against, the zones
it is approved for, the operator policy, and the evidence IDs it must produce.

## Rules

- Approved recipes are immutable. A change is a new version with a new signature,
  never an edit in place.
- No recipe may contain credentials, raw motor commands, arbitrary code, or a
  safety-mode override.
- Every recipe here must be reproducible: same source text, same compiler
  version, same IR bytes.
