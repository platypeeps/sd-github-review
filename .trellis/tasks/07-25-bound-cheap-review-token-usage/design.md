# Cheap Review Token-Budget Design

## Boundary

This task owns token and per-request cost enforcement for cheap external
reviewer candidates. Candidate policy lives in the pinned private catalog; the
compiled safe projection carries only enforceable non-secret limits to the
adapter. Generic reservation and reconciliation state belongs to the sibling
ledger tasks.

Deep and native Copilot behavior remains unchanged until those candidates opt
into an equivalent proven policy.

## Three Enforcement Boundaries

| Boundary | Decision point | Outcome | Fallback |
| --- | --- | --- | --- |
| Prepared input exceeds hard input limit | Before reservation or dispatch | `ineligible_pre_dispatch: input_token_limit` | Automatic routing may continue only within the same cheap chain; an explicit candidate blocks |
| Provider reports output/token length limit | After dispatch | `incomplete_token_limit` and no authoritative partial review | Never |
| Actual usage exceeds reservation | Reconciliation | `budget_overrun` when within hard limits; otherwise `policy_violation` | Never |

The design deliberately has no generic runtime `over_budget` behavior. Each
boundary has enough evidence to choose one deterministic outcome.

## Preflight And Reservation

The adapter prepares the complete request before authorization and determines
its metered input tokens using a provider-compatible tokenizer. A conservative
upper bound is permitted only when documented and tested for that model. An
unverifiable count makes the candidate ineligible; context is never silently
removed to make it fit.

The reservation request carries an explicit unit and a conservative maximum:

```text
maximumRequestCost =
  pricedPreparedInput
  + pricedConfiguredOutputCap
  + tokenizerAndPricingSafetyMargin
```

The pinned candidate policy also declares a hard per-request cost limit. The
computed reservation must fit both that limit and the current pool. Price,
tokenizer, unit-conversion, or provider-capability uncertainty fails closed.

## Post-Dispatch Outcomes

A normal provider stop with valid output may complete the review. A length or
token-limit finish reason is incomplete even if the partial payload parses: it
does not satisfy assurance and is not published as an authoritative review.
Usage is still reconciled because the invocation occurred.

Review outcome and budget outcome remain orthogonal:

- `actual > reserved` while all hard request limits remain satisfied records a
  soft `budget_overrun`; a valid completed review may still satisfy assurance.
- Actual input, output, or cost beyond a hard authorized limit records
  `policy_violation`; the review does not satisfy assurance and the candidate
  is quarantined for operator investigation.
- Full authoritative actual usage is debited in either case. A negative pool
  becomes `overdrawn` and cannot authorize new work until verified recovery or
  an audited adjustment.

No post-dispatch outcome advances the candidate chain. Token ineligibility,
incomplete output, and hard policy violations block the merge gate; the lane's
budget-exhaustion merge allowance does not apply.

## Evidence And Privacy

Bounded receipts may expose configured limits, counted input, reported output,
finish reason, reservation, actual cost, variance, hard cost limit, pool state,
and policy outcome. They contain no request context, filenames, prompts, model
output, provider transcript, credentials, or raw billing payload.

## Rollback

Disable the candidate rather than removing or weakening hard limits. Existing
reservations and reconciled usage remain historical evidence. Rollback never
enables silent truncation, deep escalation, or post-dispatch retry.
