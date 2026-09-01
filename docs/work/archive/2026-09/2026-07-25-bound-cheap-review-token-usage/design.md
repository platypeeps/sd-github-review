# Cheap Review Token-Budget Design

## Boundary

This task owns token and per-request cost enforcement for cheap external
reviewer candidates. Candidate policy lives in the pinned private catalog; the
compiled safe projection carries only enforceable non-secret limits to the
adapter. Generic reservation and reconciliation state belongs to the sibling
ledger tasks.

Deep and native Copilot behavior remains unchanged until those candidates opt
into an equivalent proven policy.

## Runtime Capability Verdict (verified 2026-08-20)

The July draft assumed a reviewer adapter capable of applying a compiled policy.
There is none for the cheap lane. All three templates invoke the pinned PR-Agent
container as a bare `docker run` whose only machine-readable result is an exit
status (`examples/pr-agent-router.yml:119-139`, `examples/sd-review.yml:139-157`,
`examples/pr-agent-on-demand-review-router.yml:134-152`), passing exactly
`CONFIG__MODEL`, `CONFIG__FALLBACK_MODELS`, and `CONFIG__RESTRICTED_MODE`.

Read against PR-Agent v0.39.0 source, that runtime cannot satisfy this design:

- **No output cap.** `litellm_ai_handler.py` passes `max_tokens` to
  `litellm.acompletion` only for Claude extended thinking
  (`extended_thinking_max_output_tokens`, default 4096, gated on
  `enable_claude_extended_thinking`). For the configured OpenRouter cheap model
  the hard output cap is not expressible at all.
- **The input bound is truncation.** `get_max_tokens` (`algo/utils.py`) feeds a
  pruning threshold that `pr_processing.py` applies by clipping patches
  (`clip_tokens`) and skipping whole files past its output-buffer thresholds.
  `max_model_tokens` defaults to `32000`, so the lane already silently clips
  today. Configuring that setting tightens the prohibited behavior rather than
  replacing it.
- **Finish reason does not escape.** PR-Agent captures `finish_reason`
  internally but exposes no usage or finish-reason payload to its caller.

By this design's own fail-closed rule, the correct outcome is therefore *do not
enable a cheap candidate under this runtime* — not *configure the runtime*.
Enforcement requires a caller that prepares the request, counts it, caps output,
and reads back finish reason and usage, which is what
`07-25-integrate-pr-agent-review-adapter` owns.

Separately, neither shipped default model
(`openrouter/qwen/qwen3-coder-30b-a3b-instruct`,
`openrouter/moonshotai/kimi-k2.6`; `scripts/consumer-installer/codecs.mjs:66-70`)
appears in PR-Agent's `MAX_TOKENS` map, and no template sets
`CONFIG__CUSTOM_MODEL_MAX_TOKENS`, so `get_max_tokens` raises on that path. That
is a shipped-configuration defect to file on its own, not part of this design.

## Three Enforcement Boundaries

| Boundary | Decision point | Outcome | Fallback |
| --- | --- | --- | --- |
| Prepared input exceeds hard input limit | Before reservation or dispatch | outcome `input_ineligible`, preflight reason `input_token_limit` | Automatic routing may continue only within the same cheap chain; an explicit candidate blocks |
| Provider reports output/token length limit | After dispatch | `incomplete_token_limit` and no authoritative partial review | Never |
| Actual usage exceeds reservation | Reconciliation | `budget_overrun` when within hard limits; otherwise `policy_violation` | Never |

The design deliberately has no generic runtime `over_budget` behavior. Each
boundary has enough evidence to choose one deterministic outcome.

Shipped code already names two of these three boundaries, and implementation
adopts those names rather than introducing a parallel vocabulary:

- Pre-dispatch ineligibility is outcome `input_ineligible`
  (`src/protocol-v2.js:135`) with a reason drawn from the frozen
  `PREFLIGHT_INELIGIBILITY_REASONS` set (`src/review-plan-authorization.js:80-88`).
  `input_token_limit` is the new member this task adds to that set.
- `incomplete_token_limit` already exists (`src/protocol-v2.js:136`).
- Reconciliation already classifies
  `within_reserve | budget_overrun | policy_violation`
  (`src/review-usage-reconciliation.js:75-83`), emits quarantine on a hard
  violation (`:800-803`), and marks a pool sticky-`overdrawn` on a negative full
  debit (`:875-880`).

## Preflight And Reservation

The adapter — once one exists; see the capability verdict above — prepares the
complete request before authorization and determines
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
