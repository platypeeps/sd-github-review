# Cheap Provider Cost Policy Implementation Plan

1. Pin and exercise the PR-Agent/LiteLLM/OpenRouter policy-forwarding path with
   representative endpoint fixtures.
2. Add candidate-catalog schema and compiler validation for price, retention,
   region, and parameter-support constraints.
3. Translate the complete compiled policy during adapter preflight and fail
   before dispatch when any mandatory constraint cannot be enforced.
4. Emit bounded policy-compliance and exhaustion evidence without credentials
   or raw provider-routing metadata.
5. Document catalog configuration, recovery, rollback, and same-model endpoint
   failover.

Validate compliant selection, price exhaustion, retention and region rejection,
unsupported parameters, ignored runtime controls, same-model failover, and
cross-model rejection.
