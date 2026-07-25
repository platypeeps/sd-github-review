# Local Review Assurance Projection Implementation Plan

1. Add local-attested outcome-to-Check mappings and bounded summaries.
2. Reuse revision/CAS projection writes for same-head retries and new-head
   supersession.
3. Add awaiting-evidence, late-result, conflicting-write, and readiness tests.
4. Verify branch-protection diagnostics and privacy/trust wording.
5. Run focused Check/receipt tests, `npm test`, `npm run check`, and metadata
   validation.
