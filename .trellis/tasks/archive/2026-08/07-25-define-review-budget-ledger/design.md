# Review Budget Ledger Contract Design

## Boundary

This child defines observation and reservation semantics for a consumer-owned
private ledger. The public repository supplies schemas and an in-memory fake;
the eventual private implementation owns durable state and provider adapters.

Observations carry freshness and uncertainty. Reservations are idempotent leases
bound to the complete review identity. Shared pools serialize within the ledger;
provider billing balances remain external observations and are not claimed as
transactionally locked.

Every reservation is based on a bounded preflight tied to the exact request and
configuration fingerprint. It declares units, conservative maximum expected
charge, and a hard per-request authorization limit. Expected averages may be
reported but cannot protect capacity or authorize dispatch.

An authoritative reconciliation may debit more than reserved. The ledger
records the full debit and enters `overdrawn` when usable capacity becomes
negative. It blocks future reservations until verified recovery or an audited
adjustment. Candidate quarantine is a separate policy state and is never
cleared merely because pool funds return.

`standard-v1` retains terminal operational detail and bounded observations for
90 days, forces unresolved state to `expired_unknown` at 180 days, and retains
the compact receipt/audit for 13 months. Holds, purge, backup, and coverage use
the shared retention lifecycle.

## Failure And Rollback

Stale/unknown state fails closed. Pre-authorization timeout permits the same
idempotent retry. Disabling ledger routing returns consumers to an explicit
earlier review configuration without erasing ledger history.
