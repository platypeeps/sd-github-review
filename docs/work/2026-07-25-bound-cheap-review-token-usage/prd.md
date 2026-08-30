---
title: Bound cheap review token usage
status: planning
created: 2026-07-25
---
# Bound cheap review token usage

## Goal

Make cheap PR-Agent reviews respect explicit input, output, and per-request cost
limits without silently dropping review context or starting duplicate reviews.

## Background

The current workflow selects a cheaper model but does not set a lane-specific
input or output budget. Provider context limits and PR-Agent's
`custom_model_max_tokens` are capability metadata, not necessarily spend
limits, and must not be treated as equivalent without evidence.

Token-budget enforcement has three distinct boundaries: input size is known
before dispatch, output-limit termination is known only after a reviewer starts,
and authoritative cost may arrive later during reconciliation. They require
different outcomes and must not share one ambiguous `over_budget` switch.

## Requirements

- Identify the PR-Agent/LiteLLM settings that enforce request input and output
  limits for the pinned PR-Agent version.
- Define separate cheap-lane input and output budgets based on measured routine
  PR payloads and acceptable finding quality.
- Preflight the complete prepared request with a provider-compatible tokenizer
  or a documented conservative upper bound. If its input exceeds the
  candidate's hard input limit, mark that candidate
  `ineligible_pre_dispatch` with reason `input_token_limit`; do not reserve or
  invoke it and never truncate, summarize, segment, or sample source silently.
- For automatic routing, a pre-dispatch-ineligible candidate may advance only
  to the next configured candidate in the same cheap named chain. An explicit
  candidate blocks without fallback because token ineligibility is not budget
  exhaustion. Never escalate to deep implicitly.
- Send the configured hard output-token cap to the provider. A provider result
  with a length/token-limit finish reason is `incomplete_token_limit`, does not
  count toward review assurance, and is not published as an authoritative
  partial review. Because a reviewer side effect and spend occurred, do not
  retry or select another candidate for that attempt.
- Compute a conservative maximum request cost from prepared input, the hard
  output cap, pinned unit prices, and a safety margin. Reserve that amount
  before dispatch. If token counting, cap enforcement, pricing, or unit
  conversion cannot be proven for the candidate, fail closed before dispatch.
- Distinguish a soft reservation overrun from a hard authorization violation:
  actual usage above the reservation but within all hard request limits may
  retain a valid completed review while recording `budget_overrun`; actual
  usage above a hard input, output, or per-request cost limit is
  `policy_violation`, does not satisfy review assurance, and quarantines the
  candidate pending operator review. Neither condition authorizes fallback
  after dispatch.
- Reconcile the full authoritative actual usage even when it exceeds the
  reservation. If the debit makes a pool negative, mark it `overdrawn` and
  reject future reservations until replenishment or an explicit audited
  adjustment restores usable capacity.
- Store enforceable token limits and over-budget behavior in the candidate's
  pinned private-catalog policy. The repository source names the candidate but
  does not repeat provider parameters; the adapter applies the compiled safe
  projection where the runtime supports that contract.
- Emit bounded usage/outcome metadata suitable for cost analysis without
  retaining diff content, prompts, partial model output, or provider
  transcripts. Include configured input/output limits, counted input, reported
  output, finish reason, reserved and actual cost, variance, hard request cost
  limit, overdrawn state, and policy outcome when available.
- Preserve existing deep and Copilot behavior.

## Acceptance Criteria

- [ ] Tests prove the output budget reaches the model request and caps the
      generated response.
- [ ] Input tests cover exact/under/over-boundary counts, conservative-count
      fallback, and prove an oversized automatic request advances only within
      its cheap chain while an explicit candidate blocks without fallback.
- [ ] No input-overflow fixture silently truncates, samples, summarizes,
      segments, or escalates a request to deep.
- [ ] Output tests distinguish normal completion from length-limit termination;
      incomplete output never satisfies assurance, publishes an authoritative
      partial review, retries, or dispatches another candidate.
- [ ] Reservation tests prove the maximum request cost uses counted input,
      configured output cap, pinned prices, unit conversion, and safety margin.
- [ ] Tests distinguish a completed review with `budget_overrun` from a hard
      `policy_violation`; both reconcile full actual usage and neither falls
      back after dispatch.
- [ ] An overdrawn pool blocks future reservations until verified recovery, and
      a hard-limit violation quarantines the candidate independently of pool
      recovery.
- [ ] Tests cover malformed catalog/compiled policy, digest mismatch, stale
      pricing, tokenizer mismatch, absent cap enforcement, unknown usage, and
      unsupported-provider behavior.
- [ ] The workflow fails closed when it cannot prove that a configured budget
      is enforced.
- [ ] Usage metadata is bounded and contains no source text, filenames,
      credentials, or prompt content.
- [ ] Documentation distinguishes context-window capacity from enforced token
      and spend budgets.

## Dependencies

- `07-25-define-review-candidate-catalog` for enforceable safe policy fields.
- `07-25-define-review-budget-ledger` and
  `07-25-define-review-usage-reconciliation` for reservation and actual usage.
- `07-25-integrate-pr-agent-review-adapter` for preflight, cap enforcement, and
  finish-reason evidence.

## Out of Scope

- Changing automatic routing thresholds solely to approximate token usage.
- Applying the cheap budget to deep or Copilot reviews.
- Runtime summarization, segmentation, or sampling of oversized PR context.
- Retrying or replacing a candidate after a reviewer invocation may have begun.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-bound-cheap-review-token-usage`:

- research/2026-08-20-research.md
