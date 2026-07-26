# Define Finding Adjudication Identity And Trust Contract

## Goal

Publish strict versioned schemas and conformance fixtures for stable finding
identity and orthogonal adjudication evidence.

## Requirements

- Define canonical finding identity from repository, PR, finding head,
  plan/attempt, reviewer child, candidate/configuration digest, normalized
  fingerprint, and safe channel reference.
- Keep `correctness`, `relationship`, `resolution`, and `trustLevel`
  independent and strictly typed.
- Represent actors, permission snapshots, rationale codes, evidence
  references, timestamps, and supersession without raw findings or secrets.
- Define `operational|maintainer_attested|independent` trust and fail-closed
  policy inputs for high-risk CODEOWNER/second-maintainer requirements.
- Canonicalize and size-bound events, queries, receipts, and conflict results;
  reject unknown major versions and identity mismatches.

## Acceptance Criteria

- [ ] Valid/invalid fixtures cover every enum combination and forbidden field.
- [ ] Identity is stable for reordered equivalent input and changes for a new
      repository, PR, head, plan, child, candidate, configuration, or finding.
- [ ] Duplicate and superseded relationships require valid non-self targets.
- [ ] A correction references the exact prior event; conflicting terminal
      events resolve to a deterministic disputed view.
- [ ] Privacy and size tests reject source, patches, prompts, credentials,
      transcripts, unrestricted text, and excessive nesting/cardinality.
- [ ] Historical schema versions remain read-only and cannot authorize a new
      attestation.

## Dependencies

- Stable finding provenance from
  `07-25-report-parallel-review-evidence`.

## Out of Scope

- GitHub actor lookup, persistence, operator UX, or effectiveness metrics.
