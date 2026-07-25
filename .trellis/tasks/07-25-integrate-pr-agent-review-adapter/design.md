# PR-Agent Review Adapter Design

## Boundary

This child owns preflight and one external reviewer invocation for one immutable
candidate plan. It receives a safe compiled policy and exact profile identity;
dispatch additionally requires matching durable authorization and the one
scoped reviewer credential. It does not receive chain successors or management
credentials.

## Prompt-Profile Resolution

The adapter registry owns actual prompt templates and PR-Agent configuration
values keyed by alias/version/digest. Before request preparation, the adapter
resolves that identity, canonicalizes the private values, verifies their digest
against the plan, and applies the profile. That applied digest becomes part of
the prepared-request fingerprint and acknowledgment.

There is no lane default, inheritance, merging, fallback, or caller-supplied
profile override. A missing entry, digest mismatch, handler incompatibility, or
attempted substitution fails before reviewer invocation. Multiple candidates
may resolve the same immutable entry without duplicating profile values.

PR-Agent/LiteLLM runs with internal cross-model fallback disabled. A provider
router may use only policy-compliant same-model endpoints. The acknowledgment
binds configured and actual target, provider evidence, usage reference, and
dispatch certainty to the child authorization.

A side-effect-free preflight prepares the complete request and binds its
fingerprint, applied prompt-profile digest, token count/bound, output cap,
price/unit evidence, maximum expected charge, and hard request limit to
authorization. Dispatch reuses the same prepared-request fingerprint. Preflight
uses no reviewer credential or provider invocation. A length/token-limit finish
reason produces `incomplete_token_limit`; usage is reconciled, partial output
is not published, and no replacement candidate is invoked.

## Rollback

Disable the candidate/handler or restore the prior workflow. Rollback never
populates the internal fallback list, selects a default profile, or weakens
model/profile-provenance validation.
