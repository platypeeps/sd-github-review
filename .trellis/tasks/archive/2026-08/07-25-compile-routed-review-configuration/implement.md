# Routed Review Configuration Compiler Implementation Plan

1. Add source/catalog golden and invalid fixtures.
2. Implement strict decode and composition/reference validation, including
   prompt-profile identity, digest, handler compatibility, and explicit
   budget-exhaustion merge policy.
3. Implement canonical normalization, safe expansion, and digests.
4. Add field-located redacted diagnostics and purity tests.
5. Publish compiler schema/version and integration documentation.

Validate reproducibility, semantic digest sensitivity, malformed inputs,
capability/policy/profile mismatch, forbidden profile defaults/inheritance/
overrides, overlap, no-network/no-filesystem behavior, and the full protocol
test gate.
