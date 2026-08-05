# Define review usage reconciliation

## Goal

Specify actual usage and cost reconciliation, reserve release, overruns, and unknown usage.

## Requirements

- Define idempotent reconciliation of authorized reserve against actual usage,
  cost, outcome, and bounded provider reference.
- Preserve missing usage/cost as unknown, account for overruns visibly, and
  release only capacity proven unused.
- Debit the full authoritative actual usage even when it exceeds the reserved
  amount. Classify actual usage above reserve but within hard request limits as
  `budget_overrun`; classify any hard input/output/per-request cost breach as
  `policy_violation` and emit a candidate-quarantine requirement.
- Mark a pool `overdrawn` when the full debit exceeds usable capacity. Do not
  clamp actual usage to the reservation or fabricate a zero balance.
- Handle delayed usage, duplicate callbacks, expired leases, policy violations,
  and ambiguous reviewer side effects without fabricating state.
- Retain bounded audit linkage to the original authorization and candidate pool.
- Apply `standard-v1`: retain terminal reconciliation operational detail for 90
  days, unresolved reconciliation for at most 180 days before
  `expired_unknown`, and the compact bounded receipt/audit for 13 months.

## Acceptance Criteria

- [x] Fixtures cover exact use, partial use/release, overrun, zero use, unknown
      usage, delayed reconciliation, duplicate input, and conflicting input.
- [x] Soft-overrun fixtures preserve an otherwise valid review outcome; hard-
      limit fixtures produce a policy violation and candidate quarantine.
- [x] Full actual usage is debited, negative capacity is represented as
      `overdrawn`, and future eligibility cannot treat it as available.
- [x] Reconciliation is monotonic and cannot spend or release another attempt's
      reservation.
- [x] Unknown usage never becomes a fabricated zero-cost success.
- [x] Output remains bounded and credential-free.
- [x] Fake-clock fixtures cover operational compaction, unresolved expiry,
      13-month receipt deletion, legal hold, purge, and coverage.

## Dependencies

- `07-25-define-review-budget-ledger`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Candidate selection, review publication, or deferred recovery.
