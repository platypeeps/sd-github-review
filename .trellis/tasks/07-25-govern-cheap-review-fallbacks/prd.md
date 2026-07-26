# Govern cheap review provider failover

## Goal

Keep the selected named candidate chain as the sole cross-model fallback authority
while measuring and bounding same-model provider failover for cheap PR-Agent
reviews.

## Background

OpenRouter may retry providers serving the selected model. That endpoint-level
behavior can improve availability without changing the candidate. PR-Agent or
LiteLLM cross-model fallback is a separate behavior that can bypass candidate
ordering, reservation, cost, data, and receipt policy. The accepted design
therefore keeps runtime cross-model fallback disabled and represents every
model change as an explicit named-chain decision before dispatch.

This task is the integration roadmap for independent candidate qualification,
same-model endpoint enforcement, and observation-pilot children.

## Requirements

- Keep PR-Agent `CONFIG__FALLBACK_MODELS=[]` in every generated and managed
  routed-review workflow. The selected named candidate chain is the only component
  allowed to select a different model.
- Collect bounded cheap-review success, error-class, latency, endpoint-failover,
  and retry evidence without prompts, diffs, findings, or credentials.
- Record a measurable availability objective and observation window when they
  help interpret provider-level failover evidence, but do not make them a
  formal version-1 promotion gate.
- Permit provider endpoint failover only when it retains the candidate's exact
  model target and every endpoint satisfies the cheap lane's price, data,
  region, parameter, and attribution policy.
- Keep that endpoint-failover policy in the candidate's pinned private catalog;
  the repository source selects the alias and the adapter applies only the
  authorized digest-bound projection.
- Require adapter acknowledgment and durable receipt evidence to record the
  configured and actual model and the actual provider when available. A model
  mismatch is a policy violation, not a successful fallback.
- Specify the endpoint/provider error classes eligible for same-model failover.
  Context-limit, moderation, authentication, and invalid-request failures must
  fail visibly unless an explicit provider-level policy safely handles them
  without changing model or request meaning.
- Qualify every later cheap-chain candidate independently. If
  `openrouter/mistralai/mistral-small-2603` remains configured, validate it as
  its own candidate at implementation time rather than as PR-Agent's internal
  fallback.
- Provide rollback by disabling provider routing for the candidate or removing
  the candidate from the chain; internal cross-model fallback remains disabled
  in every rollback state.
- Keep the version-1 observation report advisory. Provider-policy changes use
  the normal reviewed repository workflow and require no separate pilot
  approver, fixed minimum sample, signed decision, or decision expiry.

## Acceptance Criteria

- [ ] A documented pilot report describes same-model provider-routing outcomes,
      the current objective/window when used, and evidence limitations without
      claiming formal approval.
- [ ] Generated and managed workflows keep
      `CONFIG__FALLBACK_MODELS=[]` across install, update, and rollback.
- [ ] Same-model provider failover requires actual-model provenance and bounded
      price/data policy; absence of either blocks dispatch.
- [ ] Tests cover primary success, eligible endpoint failure, same-model
      provider failover, provider exhaustion, ineligible error classes,
      cross-model substitution rejection, and receipt provenance.
- [ ] Provider failover never changes candidate identity or causes a duplicate
      review/comment; a different-model acknowledgment fails visibly and does
      not authorize another candidate.
- [ ] Operator documentation distinguishes same-model provider failover,
      ordered candidate selection, retry, and explicit deep routing.

## Dependencies

- `07-25-define-review-candidate-catalog` — endpoint-failover, price, data,
  region, and attribution policy live in the candidate's pinned private
  catalog entry.
- `07-25-integrate-pr-agent-review-adapter` — acknowledgment and durable
  receipt evidence (configured vs actual model/provider) come from the adapter.
- Sibling boundary tasks `07-25-bound-cheap-review-token-usage` and
  `07-25-enforce-cheap-provider-cost-policy` precede changes to automatic
  chain membership (parent sequencing rule).
- Internal child order: `07-25-qualify-cheap-review-candidates` →
  `07-25-enforce-same-model-provider-failover` →
  `07-25-evaluate-cheap-provider-failover-pilot`.

## Out of Scope

- Enabling PR-Agent/LiteLLM cross-model fallback.
- Treating Kimi K2.6 or any other deep-only candidate as an automatic cheap
  fallback.
- Adding a candidate based only on hypothetical availability concerns.
- Formal pilot-approval governance for version 1.
