# Parallel Review Budget Reservation Design

## Boundary

This child consumes one immutable proposed parent plan and returns one durable
batch authorization, proven-budget deferral, or non-budget rejection. It does
not execute child reviewers.

The private ledger evaluates each slot's fixed candidate or named chain and
reserves all authorized child capacity atomically across pools it owns. Optional
slots may be omitted only when the completion formula remains achievable. The
response records freshness, margins, shared-pool effects, and per-slot outcome.

If the completion formula is impossible, the response classifies whether every
missing success is caused solely by proven pre-dispatch budget exhaustion. Only
that classification may become deferred assurance and use the lane's merge
policy downstream; any mixed or non-budget cause is a blocking rejection.

## Failure And Rollback

Failure before authorization has no child side effect. Outstanding leases are
released only when no dispatch is proven. Disabling fan-out returns to the
single-slot reservation contract.
