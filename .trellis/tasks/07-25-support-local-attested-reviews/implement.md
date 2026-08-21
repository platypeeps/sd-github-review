# Local-Attested Review Implementation Plan

The contracts child `07-25-define-local-review-attestation-contracts` and the
follow-on `08-04-define-v2-local-attestation-envelope` completed on 2026-08-05
and are archived. Their decoders ship in `src/protocol-v2.js`
(`decodeStandaloneRoute` with the attestation policy, `decodeSelfReportedUsage`,
`decodeLocalAttestationRequest`, `decodeLocalReviewAuthorization`,
`decodeLocalReviewReceipt`, `decodeLocalAttestationStatus`,
`decodeCheckProjection`, `authorizeProjectionWrite`) with fixtures under
`fixtures/protocol/v2/` exercised by `test/protocol-v2.test.js`.
`src/routed-review-compiler.js` compiles the policy onto the standalone route.
Everything below the contract layer is unbuilt.

1. Reconcile the envelope before either child starts. The shipped
   `decodeLocalAttestationRequest` carries no review tool/profile identity, no
   finding or disposition counts, no start/finish pair, and no stable reason
   code, all of which `prd.md` requires. Widen the contract or narrow the PRD;
   do not let the children each assume a different answer. Settle the same way
   whether `awaiting_local_attestation` maps to a `deferred` assurance state —
   `decodeReviewOutcomes` currently admits `deferred` only with the
   `budget_exhausted_deferred` reason, which this execution kind never uses.
2. Implement authenticated, bounded, idempotent exact-head ingestion through
   `07-25-ingest-local-review-attestations`, in its own `src/` module with no
   reviewer dispatch path. `src/operations.js` cannot host it:
   `test/dependency-boundaries.test.js` forbids it from importing
   `protocol-v2.js`.
3. Implement immutable attempt storage plus revisioned assurance/gate
   projections through `07-25-project-local-review-assurance`. There is no v2
   receipt store; `ReceiptStore` in `src/receipt.js` is v1-only, publishes
   `sd-github-review/receipt`, and stays untouched.
4. Enforce the trust policy the contract only declares. `maxAgeSeconds`,
   `allowedAssociations`, and `allowPrAuthor` are decoded and read by nothing
   else in `src/`; the live-head re-read has no implementation either.
5. Integrate the command-pack publisher only after the contract fixtures are
   stable; keep contract ownership in this repository.
6. Add install, update, check, uninstall, migration-diff, readiness, and
   branch-protection diagnostics without auto-selecting local-attested mode.
   Manifest schema 4 has no attestation policy and no `--route-mode` value for
   this execution kind, so this is net-new installer surface gated on step 1's
   route-mode-versus-execution-kind decision.
7. Document the distinction among direct review, local-attested review, and
   `review:none`, including the repository-attested trust limitation. Update
   `DESIGN.md`'s "Planned Local-Attested Review Execution" section, whose
   terminal-outcome wording still says "failed/cancelled" rather than the
   shipped `error`.

Validation must cover strict config unions, all terminal outcomes, trust
policy, PR-author policy, wrong/changed head, replay conflict, expiry, privacy
bounds, zero reviewer mutations, Check CAS/revision behavior, and installer
lifecycle. It must also prove the two meanings of local evidence stay separate:
a v1 `localReview` summary, which `src/router.js` uses to lower an `auto` route,
can never mint a `repository_attested` receipt or satisfy the gate.

Handle three separate inventories for every new module, each with different
semantics — do not treat them as one step:

- The `check` script in `package.json:12` is an explicit `node --check` file
  list that omits `src/protocol-v2.js` and `src/routed-review-compiler.js`.
  A new module must be appended or it is never syntax-checked, silently.
- The matrix in `test/dependency-boundaries.test.js:18-55` already covers the
  v2 layer (`protocol-v2.js` at `:24`, plus `routed-review-compiler.js` and
  `review-plan-authorization.js` importing it). Its completeness test asserts
  every `src/*.js` appears in `ALLOWED`, so an unregistered module fails loudly
  rather than silently; the work is to declare the new module's allowed imports.
- `scripts/check-coverage.mjs` includes `src/**` by default and its
  `QUARANTINED` list (`:38-47`) already names all eight v2 modules as
  *excluded* from coverage. Adding a new module there suppresses its
  measurement. Leave it out of `QUARANTINED` so coverage is enforced, and
  delete an existing entry only when that module becomes reachable.

Then run focused protocol/runtime/installer tests, `npm test`, `npm run check`,
and `npm run validate:metadata` before task completion.

Rollback removes local-attested configuration only through an explicit
reviewed configuration change and retains immutable historical receipts.
