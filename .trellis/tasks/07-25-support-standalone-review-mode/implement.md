# Standalone Review Mode Implementation Plan

1. Add discriminated standalone/managed source, compiled, receipt, status,
   explain, and setup-discovery fixtures with mixed-mode invalid cases.
2. Extend the pure compiler with strict standalone direct-handler/local-
   attested route validation and no catalog/control-plane input requirement.
3. Extend planning so standalone emits one immutable direct-handler plan or
   awaits one bounded local attestation while managed continues through private
   authorization.
4. Extend adapter/finalization evidence with explicit mode, profile,
   `not_managed`, limitations, reliable actual-model/provider provenance, and
   direct-review or local-attested assurance/gate Check projections.
5. Add side-effect-free standalone options and deterministic unsupported-
   capability responses for budget, pending, recovery, quarantine,
   adjudication, and parallel-plan operations.
6. Add installer scaffolding, one-time v1-to-standalone migration, semantic
   mode-diff, update/check/reapply/rollback/uninstall behavior, and managed-
   outage no-fail-open tests.
7. Document the capability matrix and the difference between absent-by-design
   and unexpectedly unavailable managed service.

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
