# Report parallel review evidence

## Goal

Publish bounded parent-child provenance, cost, deferred state, and effectiveness-ready reporting.

## Requirements

- Publish bounded parent/child correlation, exact head, slot, selection source,
  candidate, handler, actual provider/model, chain position, child status,
  per-child/total cost, completion policy, independent review/assurance/gate
  outcomes, gate reason, and exact-head projection identity/revision.
- Include parallel attempts in overall, per-repository, cheap/deep lane,
  candidate, pool, deferred, recovered, and pending reports.
- Preserve reviewer attribution and finding-channel references without copying,
  merging, or rewriting raw findings.
- Emit effectiveness-ready stable identities and limitations while excluding
  prompts, diffs, source, transcripts, secrets, and unbounded provider data.
- Include `standard-v1` policy/digest, retained coverage window, expired/purged/
  held counts, and last deletion so retention cannot silently bias reviewer
  comparisons.

## Acceptance Criteria

- [ ] One/two/many-reviewer reports are deterministic, bounded, and clearly
      distinguish incomplete, deferred, failed, and satisfied assurance.
- [ ] Reports never infer review success from a passing gate, distinguish
      budget-only merge allowance from hard blocks, and identify which linked
      attempt owns the current exact-head projection.
- [ ] Unknown usage/cost and unidentified provider provenance remain explicit.
- [ ] Truncation preserves aggregate outcome and recovery references.
- [ ] Fixtures support later same-head reviewer comparison without making an
      automatic effectiveness recommendation.
- [ ] Retention fixtures prove missing/expired/purged evidence reduces declared
      coverage and never improves reported effectiveness implicitly.

## Dependencies

- `07-25-aggregate-parallel-review-assurance` and finalized child receipts.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Finding adjudication, automatic model changes, or command-pack implementation.
