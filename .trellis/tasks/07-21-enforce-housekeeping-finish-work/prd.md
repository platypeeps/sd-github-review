# Enforce finish-work before housekeeping merge

## Goal

Prevent housekeeping from merging a delivery PR unless the caller explicitly completed the SD finish-work lifecycle, eliminating separate task-bookkeeping PRs.

## Requirements

- A housekeeping run that discovers a ready open pull request must not merge it
  unless the caller explicitly supplies the exact head for which the SD
  finish-work lifecycle completed.
- Post-merge cleanup and default-branch verification must continue to work
  without the attestation because there is no delivery merge left to guard.
- The repository-local `sd-housekeeping` and `sd-ship` instructions must name
  the handoff explicitly so an agent cannot treat a plain script invocation as
  completion of finish-work.
- The gate must fail closed with an actionable anomaly; it must not archive a
  task, manufacture a journal entry, or bypass review/check requirements.
- Regression coverage must exercise both the blocked un-attested path and the
  successful attested path.
- Capture the cross-layer lesson in Trellis guidance: a safety-critical
  natural-language sequencing contract needs an executable boundary check.

## Acceptance Criteria

- [x] A green, comment-clean PR is refused when housekeeping is invoked without
  an exact finish-work head or with a stale one.
- [x] The same fixture reaches the merge function after valid attestation.
- [x] Draft, blocked, unchecked, and unresolved-thread fixtures retain their
  existing behavior.
- [x] Help text and both orchestration skills describe when the exact-head
  attestation is valid and how to pass it.
- [x] A repository-owned test prevents a future pack refresh from silently
  dropping the handoff contract.
- [x] Housekeeping self-tests, shell lint, project tests/checks, metadata
  validation, install audit, and diff checks pass.

## Notes

- Root cause category: cross-layer contract plus missing integration coverage.
- Scope is this repository's installed command-pack surface. Upstream fleet
  propagation is a separate repository change and must not be implied here.
- The repository records the reviewed override as provenance version
  `0.28.0+sd-github-review.1` over base pack `0.28.0` so install audit remains
  fail-closed and does not mislabel modified bytes as the upstream payload.
