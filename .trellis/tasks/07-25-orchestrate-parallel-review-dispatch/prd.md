# Orchestrate parallel review dispatch

## Goal

Persist child identities and run authorized native and external reviewers concurrently without duplication.

## Requirements

- Persist the complete parent plan and every child authorization before
  dispatching any reviewer.
- Run authorized native/external child operations concurrently up to the
  compiled global limit while preserving per-child credential isolation.
- Make replay and same-head authorized rerequest idempotent with stable child
  identities and no duplicate comments/reviews.
- Supersede unfinished plans on head change and reconcile each ambiguous child
  independently without replacing or cancelling unrelated children.

## Acceptance Criteria

- [ ] Concurrency fixtures prove bounded simultaneous start for two and three-
      plus children with unique identities.
- [ ] Crash/replay, changed head, partial finalization, timeout, and ambiguous
      child fixtures produce no duplicate side effects.
- [ ] Each adapter receives only its immutable candidate and credential.
- [ ] One child's failure or ambiguity cannot silently change another child.

## Dependencies

- `07-25-reserve-parallel-review-budgets` and authorized adapter children.

## Out of Scope

- Completion formula, aggregate status, or effectiveness reporting.
