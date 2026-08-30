---
title: Define review budget ledger
status: done
created: 2026-07-25
branch: feat/07-25-define-review-budget-ledger
---
# Define review budget ledger

## Goal

Specify authoritative observations, shared pools, leases, and atomic idempotent reservations.

## Requirements

- Define bounded authoritative observations with source, units, observed-at,
  freshness deadline, confidence/unknown state, and safety margin.
- Define idempotent reservations and leases for candidate pools, including
  atomic shared-pool decisions inside the consumer ledger.
- Require every reservation request to declare explicit units, a bounded
  side-effect-free request preflight, the conservative maximum expected charge,
  and the hard per-request authorization limit. Never reserve an unbounded
  average estimate.
- Bind observe/reserve results to tenant, repository, PR, exact head, attempt,
  compiled digest, candidate, and request fingerprint.
- Treat provider billing systems as observations rather than transactionally
  locked resources and fail closed on stale/unknown state.
- Represent `overdrawn` pools and candidate quarantine explicitly. An
  overdrawn pool rejects new reservations until verified replenishment or an
  audited adjustment restores usable capacity; pool recovery does not clear a
  candidate quarantine automatically.
- Apply `standard-v1`: retain detailed terminal reservation/lease/authorization
  state for 90 days; force unresolved state to `expired_unknown` after 180
  days; retain bounded receipts/audit for 13 months and raw bounded budget
  observations/provider references for 90 days.

## Acceptance Criteria

- [x] Conformance fixtures cover independent/shared pools, concurrent boundary,
      replay, lease expiry, stale/unknown state, and safety margins.
- [x] Losing concurrent attempts receive bounded ineligibility without silent
      partial mutation.
- [x] A timeout before authorization is safely retryable with the same identity.
- [x] Reservation fixtures cover conservative maximum cost, hard request limit,
      unit mismatch, missing/unsafe preflight, and refusal to reserve beyond
      usable pool capacity.
- [x] Overdrawn pools block new work and recover only through a fresh
      authoritative observation or audited adjustment.
- [x] Public responses contain no management credential or raw billing payload.
- [x] Fake-clock fixtures cover 90-day detail/observation expiry, 180-day
      unresolved expiry, 13-month receipts, holds, purge, and coverage.

## Dependencies

- `07-25-define-review-candidate-catalog`.
- `07-25-define-budget-review-v2-contracts`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Usage reconciliation, deferred recovery, or provider-specific deployment.
