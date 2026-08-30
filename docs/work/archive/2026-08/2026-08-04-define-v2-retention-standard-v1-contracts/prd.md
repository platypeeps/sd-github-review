---
title: Define v2 standard-v1 retention contracts
status: done
created: 2026-08-04
branch: feat/08-04-define-v2-retention-standard-v1-contracts
---
# Define v2 standard-v1 retention contracts

## Goal

Define the immutable `standard-v1` retention contract family and its fixtures.
Completes the parent retention acceptance criterion.

## Delivered by 07-25 (PR #45, merged 2026-08-05)

Sibling task `07-25-define-review-data-retention-policy` shipped the bulk of
this contract family in `src/retention-policy.js` (immutable STANDARD_V1
profile with deterministic digest) plus `fixtures/protocol/v2/retention-*.json`
and `test/retention-policy.test.js`. Already delivered and merged:

- retention-profile (`decodeRetentionProfile`, `STANDARD_V1`), record-
  classification (`decodeRecordClassification`), lifecycle
  (`computeRecordLifecycle`, `RETENTION_LIFECYCLE_STATES`), legal-hold
  (`decodeLegalHold`, `LEGAL_HOLD_STATES`), status (`decodeRetentionStatus`,
  `decodeRetentionStatusReport`), purge request/progress/result
  (`decodePurgeRequest`, `assertLivePurgeWithinSla`), coverage
  (`summarizeCoverage`, `buildAnonymousAggregate`), transfer/removal
  (`decodeRepositoryLifecycleEvent`, `REPOSITORY_LIFECYCLE_KINDS`).
- seven-day live deletion SLA and 35-day backup hard-max enforced via
  `livePurgeSlaDays` / `backupHardMaxDays` (`authorizeRestoreReads`).
- Fixtures: `retention-standard-v1`, `retention-status.{valid,invalid}`,
  `retention-purge.{valid,invalid}`, `retention-legal-hold.{valid,invalid}`,
  `retention-privacy-fields.invalid`; suite green under npm test + syntax +
  ci-parity.

This task is now scoped to the residual gaps below, not a re-delivery.

## Requirements

- Add the `deletion-receipt` decoder (idempotent deletion outcome envelope with
  its privacy validation) not covered by the shipped 07-25 suite.
- Add the fixtures still missing after 07-25: destructive-authorization,
  transfer/removal, deletion-journal restore, and coverage-gaps.

## Acceptance Criteria

- [x] `deletion-receipt` decoder added to `src/retention-policy.js` with
      privacy/ordering validation matching the existing decoder conventions and
      a valid/invalid fixture pair.
- [x] Fixtures added for destructive-authorization, transfer/removal, deletion-
      journal restore, and coverage-gaps (parent retention AC completeness).
- [x] npm test, syntax check, metadata + ci-parity validation, coverage gate green.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (shared design.md).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/08-04-define-v2-retention-standard-v1-contracts`:

- research/deletion-receipt-gap-analysis.md
