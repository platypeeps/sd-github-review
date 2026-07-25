# Local Review Attestation Contracts Implementation Plan

1. Add source/compiled route-union and trust-policy fixtures.
2. Add attestation, authorization, receipt, status, outcome, and Check
   projection fixtures with canonical identities and boundary sizes.
3. Implement pure decoders, forbidden-field validation, and fingerprints.
4. Add historical-v1 rejection and setup-discovery capability fixtures.
5. Validate canonical stability, privacy bounds, all fixtures, focused protocol
   tests, `npm test`, `npm run check`, and metadata validation.
