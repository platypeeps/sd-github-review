# Integrate authorized review adapters

## Goal

Execute immutable authorized candidates through secret-isolated Copilot and external reviewer workflow adapters.

## Background

The public planner may authorize native GitHub Copilot or an external PR-Agent
candidate while preserving the logical cheap/deep lane. The workflow adapter
must execute exactly that authorization and return bounded provenance without
becoming a second selector or policy store. Native Copilot and external
PR-Agent delivery are separate children; this parent owns their shared
integration and isolation gates.

## Requirements

- Give each child operation only the immutable authorized candidate, exact-head
  identity, prompt-profile mode/identity, bounded safe policy projection, and
  credential it needs. External preflight resolves the private registry by
  alias/version/digest before authorization.
- Provide a side-effect-free external-adapter preflight that prepares the full
  request, computes provider-compatible or conservative input tokens, proves
  output-cap and pricing capability, and returns only bounded facts tied to the
  exact head/policy digest. It runs before reservation and uses no reviewer
  invocation.
- Keep native Copilot request/observation and external reviewer invocation as
  distinct adapter operations under the same acknowledgment contract.
- For PR-Agent/LiteLLM, keep `CONFIG__FALLBACK_MODELS=[]`; never pass later
  named-chain candidates into the adapter.
- Apply only the authorized model target, exact candidate-bound prompt profile,
  reasoning/token/provider policies, and permitted same-model endpoint
  failover. Native Copilot declares handler-managed prompting.
- Pass the immutable hard output-token cap to the provider and preserve its
  finish reason. Map length/token-limit termination to
  `incomplete_token_limit`; never publish partial output as authoritative or
  invoke a replacement candidate.
- Acknowledge configured and actual model, actual provider when available,
  prompt-profile mode and applied alias/version/digest when referenced,
  dispatch state, usage/cost reference, policy digest, and bounded limitations.
- Treat an actual-model mismatch as a policy violation. Treat an uncertain
  side effect as ambiguous and require reconciliation; neither authorizes a
  replacement candidate.
- Isolate reviewer and management credentials from parent receipts, job output,
  untrusted PR code, and other child operations.
- Make replay/rerequest handling idempotent and preserve exact-head correlation.

## Child Deliverables

- `07-25-integrate-copilot-review-adapter` owns native Copilot request,
  observation, rerequest, and permission boundaries.
- `07-25-integrate-pr-agent-review-adapter` owns external candidate preflight,
  secret isolation, exact model/profile execution, and acknowledgment.

## Acceptance Criteria

- [ ] Native Copilot and external candidates execute only after matching durable
      authorization and retain the requested logical lane.
- [ ] Tests prove no alternate model reaches PR-Agent/LiteLLM and generated
      workflows retain an empty internal fallback list.
- [ ] Valid same-model endpoint failover remains inside the candidate policy;
      cross-model substitution fails visibly.
- [ ] External adapters resolve and apply only the authorized profile; native
      adapters remain handler-managed, and no default or caller override can
      substitute profile behavior.
- [ ] Acknowledgment mismatch, timeout, ambiguity, replay, and changed-head
      fixtures never duplicate reviews or comments.
- [ ] Secret-boundary tests prove credentials and raw provider metadata do not
      enter source config, parent receipts, summaries, or logs.
- [ ] Usage/cost unknowns and late observations remain explicit rather than
      fabricated or silently discarded.
- [ ] Preflight fixtures prove full-context counting, no silent truncation,
      exact-head/policy binding, and failure when token, cap, price, or unit
      evidence is unavailable.
- [ ] Output-cap fixtures prove length-limited output cannot satisfy assurance,
      publish an authoritative partial review, retry, or fall back.

## Dependencies

- `07-25-compile-and-execute-budget-aware-review-plans` for immutable plans and
  acknowledgment validation.
- `07-25-define-consumer-review-control-plane` for authorization and
  reconciliation references.
- Cheap candidate policy tasks for provider, prompt, token, and reasoning
  qualification.

## Out of Scope

- Candidate ordering, budget reservation, or cross-model fallback decisions.
- Storing authoritative balances or provider credentials in this repository.

## Intended start order (2026-07-25 reconciliation)

- Starts after `07-25-define-budget-review-v2-contracts` (plan/acknowledgment shapes)
  and the control-plane authorization definitions exist; the mutual reference with
  `07-25-compile-and-execute-budget-aware-review-plans` resolves because only its
  contract child blocks this task, not the whole parent.
