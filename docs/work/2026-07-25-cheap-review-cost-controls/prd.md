---
title: Harden cheap review cost controls
status: planning
created: 2026-07-25
---
# Harden cheap review cost controls

## Goal

Coordinate measurable cost, reliability, prompt, reasoning, and provider controls for the cheap review lane.

## Background

The cheap lane now selects Qwen3-Coder 30B A3B through OpenRouter, while deep
reviews retain Kimi K2.6. Model choice and duplicate suppression reduce cost,
but the workflow does not yet control token budgets, prompt size, reasoning
effort, endpoint price, or provider-failover provenance.

## Requirements

- Track the five independently deliverable child tasks owned by this roadmap.
- Keep `CONFIG__FALLBACK_MODELS=[]`; the selected named candidate chain is the
  sole cross-model fallback authority. The fallback child evaluates and bounds
  same-model provider endpoint failover rather than enabling runtime model
  substitution.
- Prefer controls that fail visibly over silent changes in model, cost, or
  review quality.
- Reject oversized cheap requests before dispatch without silently truncating
  context. Automatic continuation stays inside the cheap chain; explicit
  candidates block and no token outcome may escalate to deep implicitly.
- Treat output-limit termination as an incomplete review and distinguish soft
  reservation overruns from hard policy violations. Neither can trigger post-
  dispatch fallback; hard violations quarantine the candidate and overdrawn
  pools block new work.
- Preserve the provider-neutral router boundary: the pinned private candidate
  catalog owns provider-specific policy and credential bindings, while the
  consumer adapter applies only the authorized candidate's compiled safe
  projection with its secret-scoped credential.
- Sequence work so measurement and enforceable price/token boundaries precede
  adding a candidate to an automatic ordered chain.
- Bind every cheap external candidate to one immutable prompt profile. Permit
  profile reuse only for qualified candidate/profile pairs and forbid lane
  defaults, inheritance, fallback profiles, and manual/runtime overrides.
- Treat comparative prompt, candidate, and provider-failover evidence as
  advisory in version 1. Changes use the normal reviewed repository workflow
  without a separate pilot approval, mandatory observation window, fixed
  sample size, or signed promotion decision. This does not relax technical
  qualification or security/provider-policy enforcement.

## Acceptance Criteria

- [ ] Every child has testable requirements, validation evidence, and a
      documented rollback path.
- [ ] Cheap-review receipts or acknowledgments identify the configured and
      actual model and fail visibly if runtime cross-model substitution occurs.
- [ ] Routine-review cost and failure-rate evidence can be compared before and
      after each child ships without retaining source content or credentials.
- [ ] The integrated policy cannot silently escalate a cheap request to the
      deep lane or exceed its configured cost boundary.
- [ ] The integrated policy reserves a conservative maximum request cost,
      reconciles full actual usage, exposes overrun/violation evidence, and
      never counts length-limited partial output as completed assurance.
- [ ] Documentation distinguishes ordered candidate selection, same-model
      provider failover, prohibited runtime cross-model substitution, and
      manual deep escalation.
- [ ] Prompt-profile documentation distinguishes reusable registry entries,
      candidate-specific bindings, native handler-managed prompting, and
      candidate/profile qualification.

## Child Tasks

- `07-25-bound-cheap-review-token-usage`
- `07-25-enforce-cheap-provider-cost-policy`
- `07-25-reduce-cheap-review-prompt`
- `07-25-govern-cheap-review-fallbacks`
- `07-25-control-cheap-review-reasoning-effort`

## Dependencies

- `07-25-define-consumer-review-control-plane` — children store enforceable
  token/price/profile/failover policy in the pinned private candidate catalog
  and reserve/reconcile through the ledger its children define.
- `07-25-integrate-pr-agent-review-adapter` — every enforcement path (preflight,
  caps, provider routing, acknowledgment evidence) flows through the adapter.
- Internal order (own requirement: measurement and enforceable boundaries
  precede chain membership): `bound-cheap-review-token-usage`,
  `enforce-cheap-provider-cost-policy`, `reduce-cheap-review-prompt`, and
  `control-cheap-review-reasoning-effort` before
  `govern-cheap-review-fallbacks`' qualification/failover/pilot children.

## Out of Scope

- Replacing deterministic CI or human review with the cheap lane.
- Changing Copilot's GitHub-managed model or effort setting.
- Formal pilot-approval governance for the fast-moving version-1 MVP.

## Notes

- Coordination-only parent (2026-07-25 reconciliation): tracks the five child
  deliverables and cross-child acceptance; no direct implementation — start
  children, not this parent. PRD-only is appropriate for this parent.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-cheap-review-cost-controls`:

- research/2026-08-20-research.md
