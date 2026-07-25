# Local-Attested Review Implementation Plan

1. Complete the versioned source, attestation, receipt, outcome, privacy, and
   setup-discovery contracts in
   `07-25-define-local-review-attestation-contracts`.
2. Extend standalone compilation with the strict direct-handler/local-attested
   route union and explicit trust-policy validation.
3. Implement authenticated, bounded, idempotent exact-head ingestion through
   `07-25-ingest-local-review-attestations` with no reviewer dispatch path.
4. Implement immutable attempt storage plus revisioned assurance/gate
   projections through `07-25-project-local-review-assurance`.
5. Integrate the command-pack publisher only after the contract fixtures are
   stable; keep contract ownership in this repository.
6. Add install, update, check, uninstall, migration-diff, readiness, and
   branch-protection diagnostics without auto-selecting local-attested mode.
7. Document the distinction among direct review, local-attested review, and
   `review:none`, including the repository-attested trust limitation.

Validation must cover strict config unions, all terminal outcomes, trust
policy, PR-author policy, wrong/changed head, replay conflict, expiry, privacy
bounds, zero reviewer mutations, Check CAS/revision behavior, and installer
lifecycle. Run focused protocol/runtime/installer tests, `npm test`,
`npm run check`, and `npm run validate:metadata` before task completion.

Rollback removes local-attested configuration only through an explicit
reviewed configuration change and retains immutable historical receipts.
