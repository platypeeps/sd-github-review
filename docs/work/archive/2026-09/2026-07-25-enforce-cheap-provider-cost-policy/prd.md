---
title: Enforce cheap provider cost policy
status: planning
parked: 2026-09-01 bulk-park (D2)
created: 2026-07-25
---
# Enforce cheap provider cost policy

## Goal

Add price-ceiling and endpoint/data-policy controls for OpenRouter-backed cheap reviews.

## Background

OpenRouter normally chooses among providers for a selected model using price
and availability. The current PR-Agent adapter supplies only the model and API
key; it does not enforce a maximum price, endpoint allowlist, zero-data-
retention policy, or parameter-support requirement.

## Requirements

- Research how the pinned PR-Agent/LiteLLM OpenRouter path forwards provider
  routing controls and fails when a requested constraint cannot be honored.
- Define an enforceable maximum input/output price policy for the cheap lane;
  do not rely on model-page pricing remaining static.
- Prefer policy constraints over a single endpoint pin so provider-level
  failover remains available when compliant endpoints exist.
- Define approved data-retention/region requirements and require providers to
  support every request parameter used by the cheap profile.
- Store the price, endpoint, data, region, and parameter constraints in the
  candidate's pinned private-catalog policy. The repository source and router
  carry only stable aliases and digest-bound safe policy evidence.
- Fail visibly when no endpoint meets the price and data policy; never route to
  a more expensive or less restrictive endpoint silently.
- Preserve the generic OpenRouter secret and keep provider preferences out of
  the human source, router inputs, and durable request payloads.

## Acceptance Criteria

- [ ] Integration tests prove provider price, data, and parameter constraints
      reach OpenRouter through the pinned PR-Agent runtime.
- [ ] Tests cover a compliant endpoint, price-cap exhaustion, data-policy
      rejection, unsupported parameters, and provider failover within policy.
- [ ] The workflow cannot exceed the configured price ceiling through a model
      or provider fallback.
- [ ] Bounded acknowledgment evidence records policy compliance without
      exposing provider credentials or raw routing metadata.
- [ ] Documentation includes catalog configuration, failure recovery, and
      rollback to an explicitly pinned baseline OpenRouter provider policy.

## Dependencies

- `07-25-define-review-candidate-catalog` — price ceiling, endpoint, data,
  region, and parameter constraints live in the candidate's pinned
  private-catalog policy.
- `07-25-integrate-pr-agent-review-adapter` — provider routing controls are
  forwarded (and their failures surfaced) through the pinned PR-Agent/LiteLLM
  OpenRouter path.

## Out of Scope

- Hard-coding one commercial provider endpoint without an approved data or
  reliability requirement.

## Notes

- Complex task (review decision 2026-07-25): cross-runtime policy translation,
  fail-closed selection, and integration evidence require the accompanying
  `design.md` and `implement.md` before `task.py start`.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-enforce-cheap-provider-cost-policy`:

- research/2026-08-20-research.md
