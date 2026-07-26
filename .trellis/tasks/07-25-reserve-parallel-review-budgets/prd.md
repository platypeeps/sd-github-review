# Reserve parallel review budgets

## Goal

Authorize complete reviewer sets through atomic bounded batch reservations.

## Requirements

- Accept only explicit managed-mode plans; standalone never invokes batch
  reservation or parallel dispatch.
- Submit one complete immutable proposed plan to a bounded batch-reservation
  operation before any child dispatch.
- Reserve required capacity atomically inside the consumer ledger across
  independent and shared pools, applying freshness and safety margins.
- Permit optional ineligibility only when required slots and minimum-success
  policy remain achievable. If assurance becomes impossible solely from proven
  pre-dispatch budget exhaustion, defer the whole plan and leave merge-gate
  mapping to aggregation; otherwise reject and block the whole plan.
- Persist reservation/authorization per child and release only unused capacity
  proven not dispatched.

## Acceptance Criteria

- [ ] Fixtures cover all-funded, required-unfunded, optional-unfunded,
      shared-pool contention, concurrent plans, replay, expiry, and partial
      chain eligibility.
- [ ] No partial plan side effect occurs when assurance is already impossible.
- [ ] Budget-only impossibility is distinguishable from every non-budget
      rejection; mixed causes cannot receive merge allowance.
- [ ] Batch identity and child reservations are idempotent and digest-bound.
- [ ] Responses never claim transactional locks over provider billing systems.

## Dependencies

- `07-25-compile-parallel-reviewer-plans` and budget-ledger contract.

## Out of Scope

- Concurrent child execution or aggregate Check semantics.
