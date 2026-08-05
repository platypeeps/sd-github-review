# Budget Review v2 Contracts Implementation Plan

1. Add canonical valid, invalid, forbidden, boundary, prompt-profile,
   candidate-options, request-preflight, token/cost outcome, and pool/candidate-
   state fixtures.
2. Add explicit budget-exhaustion merge-policy, three-axis outcome, stable
   Check, and revisioned exact-head projection fixtures.
3. Implement pure decoders and cross-contract identity validation.
4. Add quarantine status/clearance authorization and audit fixtures.
5. Add `standard-v1` classification/lifecycle, hold, purge, backup, transfer,
   deletion-receipt, and coverage fixtures.
6. Add canonical fingerprint and bounded-output helpers.
7. Add historical v1 read-only receipt decoding.
8. Publish setup-discovery capabilities and contract documentation.

Validate all protocol fixtures, privacy/size bounds, compatibility cases,
canonical stability, `npm test`, syntax checks, and metadata validation.

## Scope split at implementation

This task delivers the coherent contract core: the source discriminated union,
prompt-profile binding, candidate-options, and request-preflight fixtures from
step 1; steps 2, 6, 7, and 8; and their pure decoders from step 3 (source,
prompt-profile, preflight, candidate-options, outcome, projection, setup-
discovery, canonical helpers, and the read-only v1 receipt decoder). The
remaining work is owned by follow-up tasks (see `prd.md` Scope Split), which
inherit this plan and `design.md`:

- Step 4 (quarantine status/clearance/audit) -> `08-04-define-v2-quarantine-clearance-contracts`.
- Step 5 (`standard-v1` retention family) -> `08-04-define-v2-retention-standard-v1-contracts`.
- Step 3 cross-contract identity validation + immutable receipt/projection
  decoders and durable authorization, plus the residual prompt-profile fixtures
  (shared/candidate-specific, missing/unknown/incompatible, and digest-mismatched
  profiles) -> `08-04-define-v2-receipt-and-identity-contracts`.
- Local-attestation evidence envelope + trust proofs ->
  `08-04-define-v2-local-attestation-envelope`.
