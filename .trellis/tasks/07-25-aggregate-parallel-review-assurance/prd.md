# Aggregate parallel review assurance

## Goal

Evaluate required slots and minimum successes into immutable aggregate evidence
plus separate exact-head assurance and merge-gate Checks.

## Requirements

- Define child and parent terminal states with only `completed` counting as a
  successful review.
- Satisfy assurance only when every required slot completes and total successes
  meet the compiled `minimum_successes` threshold.
- Continue bounded observation of optional children through terminal state or
  plan deadline; record late observations without retroactive result changes.
- If the threshold becomes impossible solely because one or more children have
  proven pre-dispatch budget exhaustion, record aggregate deferred assurance
  and apply the lane's explicit `budgetExhaustion.merge=block|allow` to the
  merge gate. If any contributing child has a policy violation, ambiguous
  dispatch, incomplete output, authentication/framework failure, or other
  non-budget failure, block regardless of that setting.
- Publish the same two stable exact-head Checks as single-review execution:
  `sd-review / assurance` truthfully reports aggregate assurance and
  `sd-review / gate` is the only branch-protection-required Check.
- Keep each finalized aggregate attempt immutable. A distinct linked recovery
  attempt may update the exact-head Check projection only through a monotonic
  revision and latest-authorized-attempt compare-and-swap rule.

## Acceptance Criteria

- [ ] Tests cover all required success, required failure, optional failure,
      minimum met/not met, timeout, ambiguity, late result, and supersession.
- [ ] A passing deferred gate says `Merge allowed; review assurance deferred`
      and never claims missing reviews completed.
- [ ] Mixed budget/non-budget failure always blocks; merge allowance applies
      only when every missing assurance contribution is proven budget
      exhaustion before dispatch.
- [ ] Aggregate finalization is deterministic and replay-idempotent.
- [ ] Branch protection requires only the stable gate Check; the stable
      assurance Check and dynamic child diagnostics are not required.
- [ ] Recovery and late-result tests prove immutable aggregate attempts and
      deterministic latest-head projection ownership.

## Dependencies

- `07-25-orchestrate-parallel-review-dispatch`.

## Out of Scope

- Findings synthesis or reviewer effectiveness recommendations.
