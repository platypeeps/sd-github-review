# Local Review Attestation Ingestion Implementation Plan

1. Add the bounded ingestion operation in its own `src/` module, plus the
   GitHub-derived publication context (`GITHUB_ACTOR`, `GITHUB_WORKFLOW_REF`,
   `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, resolved association), which nothing
   in `src/` reads today.
2. Implement actor association, PR-author, age, configuration, and exact-head
   authorization, reusing the shipped `src/protocol-v2.js` decoders and the
   compiled `attestation` policy from `src/routed-review-compiler.js`.
3. Persist/reconcile immutable attempt receipts with matching-replay reuse and
   conflicting-replay failure. There is no v2 receipt store yet; `ReceiptStore`
   in `src/receipt.js` is v1-only and stays untouched.
4. Add exhaustive negative mutation spies proving zero reviewer side effects.
5. Handle the three verification inventories, which differ in semantics.
   Declare the module's allowed imports in the matrix in
   `test/dependency-boundaries.test.js:18-55` (it already covers the v2 layer,
   and its completeness test fails loudly on an unregistered module). Append it
   to the explicit `node --check` list in `package.json:12`, which omits
   `src/protocol-v2.js` today, or it is never syntax-checked. Leave it out of
   `QUARANTINED` in `scripts/check-coverage.mjs:38-47` — that list *excludes*
   modules from coverage, and `src/**` is measured by default.
6. Validate focused operation/receipt tests, privacy/error output, `npm test`,
   `npm run check`, and metadata validation.
