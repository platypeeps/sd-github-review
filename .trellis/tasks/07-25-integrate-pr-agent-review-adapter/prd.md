# PARKED: Integrate PR-Agent review adapter

## Goal

Prepare and execute one external candidate with secret isolation and exact
model/profile provenance.

## Requirements

- Accept one immutable external candidate plan with exact model target, exact
  prompt-profile alias/version/digest, and bounded safe token/reasoning/provider
  policy projection for preflight. Require its matching durable authorization
  before dispatch.
- Resolve the exact profile identity through the private adapter registry,
  verify the actual profile digest, and apply that profile before preparing or
  dispatching the request. Never infer a lane default, merge profiles, fall back
  to another profile, or accept a runtime/comment override.
- Before reservation, prepare the full request without invoking the reviewer and
  return a digest-bound bounded preflight containing input count/bound, output
  cap, price/unit evidence, conservative maximum charge, hard request limit,
  prepared-request fingerprint, and capability evidence.
- Invoke the pinned PR-Agent/LiteLLM path with
  `CONFIG__FALLBACK_MODELS=[]`; never receive later named-chain candidates.
- Scope the reviewer credential to the child job and keep it out of source,
  receipts, summaries, and logs.
- For audit finding A-004, run the provider-credentialed reviewer without
  `checks: write` or another credential capable of mutating the durable receipt
  namespace. Route and finalization operations use separate least-privilege
  jobs and exchange only the bounded acknowledgment contract.
- Return configured/actual model, provider when available, dispatch state,
  applied prompt-profile alias/version/digest, finish reason, usage/cost
  reference, policy digest, and bounded limitations.
- Apply the authorized output cap exactly. A length/token-limit finish reason is
  `incomplete_token_limit`; return usage evidence but do not publish partial
  output or invoke another candidate.

## Acceptance Criteria

- [ ] Tests prove single-target invocation, policy forwarding, supported same-
      model endpoint failover, and cross-model substitution rejection.
- [ ] Model mismatch, timeout, ambiguous side effect, and replay never authorize
      a replacement or duplicate publication.
- [ ] Cheap and deep candidates use their own compiled policies without adapter
      source changes.
- [ ] Shared and candidate-specific prompt-profile fixtures resolve the exact
      authorized profile; missing values, incompatible handler, digest mismatch,
      substitution, or default-profile behavior fails before dispatch.
- [ ] An explicit candidate request uses the same bound profile as automatic
      selection and cannot provide a profile selector.
- [ ] Secret and raw provider-routing metadata are absent from durable output.
- [ ] Workflow fixtures prove the reviewer job token cannot create or update
      Check Runs, while a separate finalizer can persist only a validated
      bounded acknowledgment.
- [ ] Preflight fails before reservation when input counting, output-cap
      enforcement, pricing/units, maximum cost, or finish-reason evidence is
      unproven; request content is absent from preflight output.
- [ ] Output-cap termination is incomplete, never publishes an authoritative
      partial review, and never retries or falls back.

## Dependencies

- `07-25-authorize-budget-aware-review-plans` and qualified cheap/deep candidate
  policy tasks.

## Out of Scope

- Candidate ordering, budget reservation, or native Copilot observation.
- Prompt-profile authoring or model-quality evaluation.
