# Define v2 local-attestation evidence envelope

## Goal

Define the bounded local-attestation evidence envelope decoder with authenticated
GitHub actor/workflow enrichment and exact-head binding, plus the proofs that
`review:none` and historical v1 local summaries cannot yield `independent` trust
or satisfy v2 assurance. Completes parent AC8.

## Requirements

- Define the bounded local-attestation envelope: explicit actor/association,
  PR-author, and age policy; forbid inferred trust and mixed execution fields.
- Enrich the envelope with authenticated GitHub actor/workflow context at
  ingestion; receipt uses `trustLevel=repository_attested` (constant
  `ATTESTED_TRUST_LEVEL` already exists in `src/protocol-v2.js`).
- Prove a caller assertion cannot produce `independent` trust.
- Prove `review:none` and historical v1 local summaries cannot satisfy v2
  assurance.

## Acceptance Criteria

- [ ] Local-attestation fixtures bind exact-head evidence and authenticated
      publication context and use `repository_attested` trust (parent AC8).
- [ ] Fixtures prove `review:none` and v1 local summaries cannot satisfy v2
      assurance.
- [ ] npm test, syntax check, metadata + ci-parity validation, coverage gate green.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (standalone attestation policy + shared design.md).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.
