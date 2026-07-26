# Local Review Attestation Ingestion Implementation Plan

1. Add the bounded ingestion operation and GitHub-derived publication context.
2. Implement actor association, PR-author, age, configuration, and exact-head
   authorization.
3. Persist/reconcile immutable attempt receipts with matching-replay reuse and
   conflicting-replay failure.
4. Add exhaustive negative mutation spies proving zero reviewer side effects.
5. Validate focused operation/receipt tests, privacy/error output, `npm test`,
   `npm run check`, and metadata validation.
