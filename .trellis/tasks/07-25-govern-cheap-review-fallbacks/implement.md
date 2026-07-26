# Cheap Review Provider Failover Implementation Plan

## Child Delivery Tasks

1. `07-25-qualify-cheap-review-candidates`
2. `07-25-enforce-same-model-provider-failover`
3. `07-25-evaluate-cheap-provider-failover-pilot`

The remaining sequence is the parent integration gate after each child passes
its own acceptance criteria.

## Preconditions

- Approve `prd.md` and `design.md`.
- Confirm the pinned PR-Agent/LiteLLM/OpenRouter capabilities through primary
  documentation and a bounded fixture before changing consumer policy.
- Curate real spec/research entries in `implement.jsonl` and `check.jsonl`
  before starting in sub-agent dispatch mode.

## Execution Order

1. Add failing fixtures for empty internal fallback configuration, configured
   versus actual model provenance, and provider-policy enforcement.
2. Add or tighten managed workflow and installer validation so a nonempty
   `CONFIG__FALLBACK_MODELS` is visible incompatible drift.
3. Add the bounded same-model policy to pinned candidate-catalog fixtures and
   apply its compiled safe projection in the consumer adapter without moving
   provider settings or credentials into the human source or router inputs.
4. Extend acknowledgment validation for actual model, actual provider when
   available, retry/failover count, policy digest, and limitations.
5. Implement the failure-class matrix and stop/reconcile behavior for model
   mismatch or ambiguous dispatch.
6. Add the observation-pilot report and candidate-qualification evidence.
7. Update setup, operator, fallback, and rollback documentation.
8. Run focused adapter/installer tests and the full repository gates.

## Validation Matrix

- Primary endpoint success.
- Eligible same-model endpoint failure followed by compliant provider success.
- Provider exhaustion with no cross-model substitution.
- Price, data, region, and parameter-policy rejection.
- Authentication, context-limit, moderation, invalid-request, and ambiguous
  failure classes.
- Actual-model mismatch and missing mandatory provenance.
- Installer install/update/check/uninstall and operator rollback.
- Candidate qualification with replacement provider/model aliases.

## Rollback Gate

Rollback removes or disables provider-routing policy for the candidate and, if
necessary, removes that candidate from the lane chain. It never populates the
PR-Agent/LiteLLM cross-model fallback list.

## Review Gates

- Confirm no model identifier other than the selected candidate reaches the
  adapter as an alternate target.
- Confirm same-model failover cannot widen price/data policy.
- Confirm policy violation or ambiguity never authorizes another candidate.
- Confirm bounded receipts contain no provider credentials or raw routing data.
