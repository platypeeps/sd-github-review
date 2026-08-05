# Deferred Review Recovery Contract Design

## Boundary

This child defines private pending-record state plus the public bounded references
needed to list and recover a budget-deferred review. It does not implement the
future operator command or automatic background replay.

Recovery always creates a distinct authorized attempt after checking tenant,
repository access, open PR, exact head, current policy, budget, duplicates, and
prior ambiguity. A changed head supersedes the record instead of replaying it.

The original and recovery receipts are immutable and linked. The exact-head
assurance/gate projection records a monotonic revision and
latest-authorized-attempt identity; compare-and-swap updates ensure only that
attempt can advance the projection. A late result from an older attempt is
retained for audit but cannot rewrite current assurance or merge-gate state. A
changed head gets a new projection and supersedes the prior pending record.

## Retention And Rollback

The shared immutable `standard-v1` policy owns retention, deletion, transfer,
and audit. An actionable record has a hard 180-day maximum. At that boundary it
becomes `expired_unreviewed`; terminal detail remains 30 days before compaction
to the bounded 13-month receipt. Holds, purge, backup expiry, removal, and
transfer use the shared retention contract and expose coverage effects.

Configuration rollback preserves retained historical deferred evidence but
disables incompatible recovery until a valid current policy exists. Rollback
cannot restart or extend a retention timer.
