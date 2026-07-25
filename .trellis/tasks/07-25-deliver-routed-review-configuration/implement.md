# Routed Review Configuration Lifecycle Implementation Plan

## Child Delivery Tasks

1. `07-25-scaffold-routed-review-source`
2. `07-25-migrate-routed-review-configuration-v2`
3. `07-25-manage-compiled-review-configuration-promotion`

Each child must pass its own acceptance criteria before this parent runs the
combined lifecycle validation below.

## Preconditions

- Approve the parent v2 configuration contract and sibling compiler interface.
- Confirm the managed catalog-resolution transport and credential owner;
  standalone remains independent of both.
- Curate implementation and check context before `task.py start`.

## Execution Order

1. Add standalone/managed source, catalog-projection, fixed-profile, explicit
   budget-exhaustion merge-policy, compiled-manifest, and semantic-diff
   fixtures.
2. Add fresh-install scaffolding for one complete explicit source.
3. Integrate mode-specific compiler inputs and managed-only catalog resolution.
4. Implement dry-run and pending/active promotion with prior-state preservation.
5. Implement update/check/drift and one-time v1-to-v2 migration.
6. Implement ownership-aware uninstall plus reserved candidate/slot-label
   detection without label adoption or mutation.
7. Add stable Check publication, branch-protection readiness diagnostics, and
   explicit-authorization migration/legacy-retirement fixtures.
8. Update setup, migration, rollback, and troubleshooting documentation.

## Validation

- Installer fresh/update/check/dry-run/reapply/uninstall tests.
- Reserved candidate/slot-label preservation and unsupported-control tests.
- Catalog missing/stale/mismatch, standalone no-catalog, mixed-mode, and
  compiler-failure tests.
- Interrupted promotion and managed-drift tests.
- Branch-protection missing-gate, required-assurance, authorized migration, and
  legacy-retirement tests.
- v1 migration and post-cutover rejection tests.
- `npm test`, `npm run check`, and `npm run validate:metadata`.

## Rollback Gate

Do not promote a new compiled manifest until its source/output and applicable
managed catalog digests plus validation pass. Preserve the prior active version
on every error.
