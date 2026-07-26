# Migrate routed review configuration to v2

## Goal

Convert supported legacy fixed routes once into explicit v2 standalone
profiles, with managed mode remaining a separate reviewed migration.

## Requirements

- Detect only the supported legacy model/provider and route settings owned by
  this installer; reject ambiguous or unmanaged inputs.
- Produce a dry-run mapping from fixed legacy routes to explicit standalone
  lane profiles. Do not require or synthesize a private catalog.
- Preserve unrelated workflow settings and require any unresolved provider/model
  mapping to be supplied explicitly.
- When a supported installer-owned legacy exhaustion setting is present in a
  reviewed managed-mode migration, map `fail` to
  `budgetExhaustion.<lane>.merge=block` and `defer_success` to `merge=allow` in
  the dry run. This is a one-time translation only; v2 runtime/compiler input
  rejects both legacy values.
- Perform the conversion once and reject legacy/default selectors after the
  repository declares version 2.

## Acceptance Criteria

- [ ] Canonical legacy fixtures migrate deterministically to valid explicit v2
      standalone source without losing supported routing policy.
- [ ] Enabling managed mode is never an implicit side effect of v1 migration.
- [ ] Unknown, conflicting, partial, or drifted legacy input fails before write.
- [ ] Rerunning migration is idempotent and never dual-writes v1 and v2 policy.
- [ ] Legacy exhaustion mapping appears only in migration fixtures; active v2
      fixtures require explicit block/allow and reject legacy vocabulary.
- [ ] Rollback restores prior managed files without making v2 interpret legacy
      input.

## Dependencies

- `07-25-scaffold-routed-review-source` for the complete target shape.
- `07-25-define-budget-review-v2-contracts` for v1/v2 compatibility rules.

## Out of Scope

- Long-lived backward compatibility or private catalog implementation.
