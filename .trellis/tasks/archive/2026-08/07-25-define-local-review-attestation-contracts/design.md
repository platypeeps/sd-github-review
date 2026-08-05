# Local Review Attestation Contract Design

This child owns pure schemas, canonicalization, identity, and privacy bounds.
It adds a standalone route execution discriminant and a local-attestation
envelope that is enriched with authenticated GitHub context only after decode.

The canonical attempt identity excludes transport correlations; the evidence
fingerprint includes every normalized review-result and policy-relevant field.
Caller-supplied actor, association, workflow, and authorization fields are
forbidden because the ingestion boundary derives them from GitHub.

The receipt records `trustLevel=repository_attested` and the policy digest.
Self-reported usage is a separately discriminated projection and never enters
budget authorization or balance calculations.
