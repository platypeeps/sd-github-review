# Publish Finding Adjudication Evidence For Analysis

## Goal

Expose bounded, versioned adjudication status and analysis evidence for
`sd-review-learnings` and `sd-review-effectiveness` without making either
consumer an adjudication authority.

## Requirements

- Query by repository, PR, plan, finding, lane, reviewer/candidate,
  configuration digest, time window, trust floor, and current/disputed state.
- Return exact coverage, unresolved/disputed counts, exclusions, truncation,
  freshness, and safe event identities.
- Return `standard-v1` policy/digest, retained coverage window, held/expired/
  purged counts, and last deletion. Never present post-retention evidence as a
  complete historical denominator.
- Preserve reviewer attribution and duplicate relationships while presenting
  one underlying issue to recurrence consumers.
- Provide separate projections for recurring-learning input and paired
  effectiveness input; both derive from one canonical event view.
- Never zero-fill missing evidence or infer correctness from thread resolution,
  comment deletion, agreement, author identity, or later code changes.

## Acceptance Criteria

- [ ] Query fixtures cover one/two/many reviewers, duplicate findings,
      corrected events, disputes, missing storage, stale data, truncation, and
      mixed configurations.
- [ ] Learning projection excludes invalid evidence from promotion, deduplicates
      underlying issues, and preserves unresolved current actions.
- [ ] Effectiveness projection exposes trust/coverage and only paired
      exact-head evidence.
- [ ] Missing adjudication remains `unresolved`; it never becomes valid,
      invalid, or zero cost.
- [ ] Payloads are deterministic, bounded, privacy-safe, and stable across input
      ordering.
- [ ] Retention/deletion fixtures preserve correction-chain integrity and
      reduce coverage explicitly in both learning and effectiveness projections.

## Dependencies

- `07-25-define-finding-adjudication-contract`.
- `07-25-implement-trusted-finding-adjudication-workflow`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Markdown learning updates, effectiveness scoring, or configuration changes.
