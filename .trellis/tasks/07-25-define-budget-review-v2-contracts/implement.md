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
