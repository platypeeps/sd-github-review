# Enforce same-model provider failover

## Goal

Keep cross-model fallback disabled and constrain endpoint failover to compliant same-model providers.

## Requirements

- Keep PR-Agent/LiteLLM cross-model fallback empty in generated, managed, and
  rollback workflows.
- Allow endpoint failover only for the authorized candidate's exact model and
  only across endpoints satisfying its price, data, region, parameter,
  attribution, error-class, and retry policy.
- Validate configured and actual model/provider evidence and treat mismatch or
  mandatory-provenance absence as a policy violation.
- Stop on authentication, invalid request, context limit, moderation/data
  policy, or ambiguous outcome unless the explicit same-model policy safely
  classifies it.

## Acceptance Criteria

- [ ] Primary success, eligible failover, provider exhaustion, ineligible error,
      model mismatch, missing provenance, and ambiguity fixtures pass.
- [ ] No later chain candidate reaches the adapter as an internal fallback.
- [ ] Endpoint failover never widens candidate policy or duplicates publication.
- [ ] Rollback disables routing or removes the candidate while retaining an
      empty cross-model fallback list.

## Dependencies

- A current record from `07-25-qualify-cheap-review-candidates`.

## Out of Scope

- Cross-model fallback or availability-pilot conclusions.
