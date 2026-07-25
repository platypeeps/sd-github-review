# Parallel Review Assurance Aggregation Design

## Boundary

This child consumes terminal or deadline-bounded child states and produces one
immutable aggregate attempt result plus stable assurance and merge-gate Check
projections. It does not dispatch work or rewrite findings.

Assurance is satisfied only when every required slot is `completed` and total
completed children meet `minimum_successes`. The parent observes optional
children until terminal state or deadline. Late evidence is retained but does
not rewrite the finalized attempt.

Aggregate budget deferral is eligible only when all missing required/minimum
successes are attributable to proven pre-dispatch budget exhaustion. It records
`reviewOutcome=deferred_budget` and `assuranceOutcome=deferred`; the lane's
explicit `budgetExhaustion.merge` maps only `gateOutcome` to `pass` or `block`.
Any non-budget failure makes the gate block.

`sd-review / assurance` concludes `action_required` for aggregate deferral and
is never branch-protection-required. `sd-review / gate` is the sole required
Check and may pass only under explicit merge allowance; its deferred title is
`Merge allowed; review assurance deferred`. Dynamic child checks remain
diagnostic.

A recovery is a distinct linked aggregate attempt. The current exact-head
projection carries a monotonic revision and latest-authorized-attempt identity;
compare-and-swap updates prevent an older child or attempt from overwriting a
newer projection.

## Rollback

The two stable Checks remain across fan-out changes. Rollback to one explicit
slot uses the same formula and leaves branch protection requiring only
`sd-review / gate`.
