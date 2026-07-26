# Review Data Retention Policy Implementation Plan

1. Define immutable retention-profile, record-classification, lifecycle, legal-
   hold, status, purge, deletion-receipt, and coverage schemas.
2. Add the canonical `standard-v1` profile and deterministic digest fixtures.
3. Extend the private-control-plane fake with a controllable clock, lifecycle
   scheduler, compaction, active maxima, and idempotent deletion journal.
4. Implement the 180-day deferred actionable window followed by 30 days of
   deferred terminal detail; add the 180-day unresolved-attempt maximum
   followed by 90 days of operational terminal detail before compaction.
5. Implement 90-day observation retention, 13-month bounded event/chain/policy
   and static prompt-profile retention, 25-month anonymous aggregates, and
   35-day backup expiry.
6. Implement authorized legal hold/release/expiry, repository inactive/transfer
   handling, and seven-day live purge with backup-aware completion status.
7. Add restore tests that replay the deletion journal before reads and never
   rehydrate purged data.
8. Publish bounded retention status/purge contracts and the command-pack
   handoff for `sd-review data status` and `sd-review data purge`.
9. Update security, privacy, recovery, adjudication, reporting, uninstall, and
   operational documentation.

## Validation

- Fake-clock exact-boundary, calendar, state-transition, compaction, and
  idempotency tests.
- Prohibited-field and 24-hour crash-cleanup tests.
- Deferred/reconciliation/adjudication chain and policy-reference fixtures.
- Hold, purge, transfer, inactive repository, backup, restore, and deletion-
  journal fault injection.
- Coverage-aware report and anonymous-aggregate re-identification checks.
- `npm test`, `npm run check`, and `npm run validate:metadata`.

## Rollback Gate

Do not activate private retention until its clock behavior, purge SLA, backup
aging, legal-hold expiry, deletion-journal restore, and coverage reporting pass
the exported conformance suite together. Rollback disables collection but
continues deletion and backup-aging obligations.
