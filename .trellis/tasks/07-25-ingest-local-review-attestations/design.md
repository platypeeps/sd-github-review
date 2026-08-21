# Local Review Attestation Ingestion Design

The ingestion operation decodes untrusted bounded evidence, derives GitHub
authority, loads the exact compiled route/policy, verifies the live PR head,
and then creates or reads the immutable attempt receipt.

Validation order is deliberate: shape/privacy bounds, canonical identity,
route execution kind, actor/association/PR-author policy, evidence age, live
head, and idempotency fingerprint. No branch reaches reviewer dispatch.

An ambiguous receipt mutation returns reconciliation required. Absence after an
ambiguous write never authorizes retry under a new identity. Check projection
is a separate child operation consuming the verified receipt.

The decode, authorization, receipt, and projection contracts already ship in
`src/protocol-v2.js` (`decodeLocalAttestationRequest`,
`decodeLocalReviewAuthorization`, `decodeLocalReviewReceipt`,
`decodeCheckProjection`, `authorizeProjectionWrite`); this task adds only the
runtime that drives them. Ingestion therefore lands in its own module rather
than in `src/operations.js`, which the dependency matrix in
`test/dependency-boundaries.test.js` forbids from importing `protocol-v2.js`.
Review results are `clean | findings | error` and outcome classes are
`completed_local | completed_local_findings | awaiting_local_attestation |
failed_local`; a cancelled local run reports `error`. Evidence age applies the
compiled `attestation.maxAgeSeconds`, which nothing in `src/` evaluates today.
