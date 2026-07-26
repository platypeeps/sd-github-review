# Define deferred review recovery

## Goal

Specify deferred record lifecycle, exact-head recovery, retention, authorization, and deletion.

## Requirements

- Define bounded deferred records for exhausted attempts with tenant/repository/
  PR/head identity, policy outcome, opaque references, and retention state.
- Require authorized recovery to revalidate repository access, open PR, exact
  head, current compiled policy, budget, and duplicate evidence.
- Create a distinct recovery attempt linked to the deferral; supersede stale
  heads and never reconstruct prompts or replay ambiguous dispatches.
- Keep every attempt receipt immutable. Allow a linked newer authorized attempt
  for the same exact head to supersede the head-level assurance/gate Check
  projection through a monotonic revision and compare-and-swap rule. Retain
  late older results as evidence but reject them as projection updates.
- Define tenant isolation, audit, retention, deletion, repository transfer, and
  service-outage behavior.
- Apply `standard-v1`: keep a deferred record actionable until recovered,
  superseded, the PR closes, or 180 days elapse. Expiry is a visible
  `expired_unreviewed` terminal state. Retain terminal detail for 30 more days,
  then compact to the bounded 13-month receipt and coverage record.
- Ensure uninstall/removal stops recovery eligibility immediately, while
  authorized purge and cross-tenant transfer follow the shared retention
  contract rather than silently deleting or reassigning records.

## Acceptance Criteria

- [ ] Tests cover unchanged/changed head, closed PR, duplicate retry, unavailable
      budget, ambiguous prior dispatch, supersession, expiry, and deletion.
- [ ] Recovery is explicit and idempotent; no automatic review occurs unless a
      separate repository policy later authorizes it.
- [ ] Deferred assurance remains distinguishable from completed review
      assurance regardless of whether merge policy passes or blocks the gate.
- [ ] Same-head recovery updates only the latest authorized Check projection;
      changed-head recovery creates new Checks, and late older results cannot
      overwrite either projection.
- [ ] Cross-tenant and stale authorization attempts fail closed.
- [ ] Fake-clock tests cover the exact 180-day actionable boundary, 30-day
      terminal-detail window, compaction, legal hold, purge, and coverage
      effects.

## Dependencies

- `07-25-define-review-budget-ledger` and
  `07-25-define-review-usage-reconciliation`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Portable retry command implementation or automatic background replay.
