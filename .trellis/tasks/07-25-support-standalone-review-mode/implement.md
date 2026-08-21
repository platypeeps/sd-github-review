# Standalone Review Mode Implementation Plan

Step status verified against the tree on 2026-08-20; see
`research/2026-08-20-research.md`. Every module named below is currently
unreachable from `src/index.js`, so none of the completed work is live.

1. **Mostly done.** Add discriminated standalone/managed source, compiled,
   receipt, status, explain, and setup-discovery fixtures with mixed-mode
   invalid cases. Source and compiled fixtures exist
   (`fixtures/protocol/v2/source-contracts.{valid,invalid}.json`,
   `routed-review-source.{valid,invalid}.json`,
   `routed-review-handler-profiles.valid.json`). Receipt, status, and explain
   fixtures do not — there is no v2 attempt-receipt contract yet.
2. **Done.** Extend the pure compiler with strict standalone direct-handler/
   local-attested route validation and no catalog/control-plane input
   requirement. `src/routed-review-compiler.js:306` `compileStandalone`,
   `:238` `decodeHandlerProfiles`, `:309-311` catalog-forbidden guard;
   route shapes at `src/protocol-v2.js:543` `decodeStandaloneRoute`.
3. **Not started.** Extend planning so standalone emits one immutable direct-
   handler plan or awaits one bounded local attestation while managed continues
   through private authorization. `src/review-plan-authorization.js:400-404`
   currently rejects standalone manifests and defers this arm by name.
4. **Not started.** Extend adapter/finalization evidence with explicit mode,
   profile, `not_managed`, limitations, reliable actual-model/provider
   provenance, and direct-review or local-attested assurance/gate Check
   projections. `decodeCheckProjection` (`src/protocol-v2.js:1324`) carries no
   mode or provenance today.
5. **Not started.** Add side-effect-free standalone options and deterministic
   unsupported-capability responses for budget, pending, recovery, quarantine,
   adjudication, and parallel-plan operations.
   `decodeCandidateOptionsResponse` (`src/protocol-v2.js:763`) is managed-only
   and requires a catalog digest.
6. **Not started.** Add installer scaffolding, one-time v1-to-standalone
   migration, semantic mode-diff, update/check/reapply/rollback/uninstall
   behavior, and managed-outage no-fail-open tests. `scripts/consumer-installer*`
   has no v2 mode awareness at all.
7. **Not started.** Document the capability matrix and the difference between
   absent-by-design and unexpectedly unavailable managed service. `DESIGN.md:437`
   still describes the standalone `local-attested` route in future tense.

Reuse rather than redefine the local-attestation contracts already landed by
`07-25-support-local-attested-reviews`: `src/protocol-v2.js:1182, 1211, 1258,
1292`.

## Validation

- Schema/compiler golden and invalid mixed-mode fixtures.
- No-network/no-control-plane standalone install and dispatch tests.
- Managed missing/timeout/stale/mismatch tests proving zero reviewer side
  effects and no mode change.
- Receipt/status/options privacy, exact-head, and unsupported-capability tests.
- Consumer installer migration, dry-run, drift, rollback, and uninstall tests.
- `npm test`, `npm run check`, and `npm run validate:metadata`.

## Rollback Gate

Disable standalone v2 emission if any fixture can infer mode, expose a managed
capability, or dispatch after managed authorization failure. Preserve the last
valid explicit configuration and historical receipts.
