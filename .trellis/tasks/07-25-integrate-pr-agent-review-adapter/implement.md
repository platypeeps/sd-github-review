# PR-Agent Review Adapter Implementation Plan

1. Add request-preflight, prompt-profile resolution, token-boundary, single-
   target, policy, provenance, and secret-boundary fixtures.
2. Implement exact private profile resolution/digest verification followed by
   side-effect-free complete-request preflight and bounded evidence.
3. Gate invocation on matching durable authorization and prepared fingerprint.
4. Apply the candidate-bound prompt profile plus compiled token/reasoning/
   provider policy with immutable output cap and empty model/profile fallback.
5. Emit finish reason, bounded acknowledgment, incomplete, ambiguous, and
   policy-violation outcomes.
6. Add replay, duplicate-publication, logging, and rollback documentation.

Validate exact target/profile execution, shared and candidate-specific profile
resolution, missing/mismatched/substituted profile rejection, compliant
endpoint failover, cross-model rejection, token/cost preflight, output-limit
incompleteness, timeout/ambiguity, usage unknowns, and credential isolation.
