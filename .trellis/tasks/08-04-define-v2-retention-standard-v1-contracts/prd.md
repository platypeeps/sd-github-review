# Define v2 standard-v1 retention contracts

## Goal

Define the immutable `standard-v1` retention contract family and its fixtures.
Completes the parent retention acceptance criterion.

## Requirements

- Define immutable retention-profile, record-classification, lifecycle, legal-
  hold, status, purge request/progress/result, deletion-receipt, backup-expiry,
  transfer/removal, and coverage schemas for `standard-v1`.
- Fixtures cover destructive authorization, idempotent purge, seven-day live
  deletion, 35-day backup expiry, holds, transfer/removal, deletion-journal
  restore, and coverage gaps.

## Acceptance Criteria

- [ ] Retention fixtures cover `standard-v1`, destructive authorization,
      idempotent purge, seven-day live deletion, 35-day backup expiry, holds,
      transfer/removal, deletion-journal restore, and coverage gaps (parent
      retention AC).
- [ ] npm test, syntax check, metadata + ci-parity validation, coverage gate green.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (shared design.md).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.
