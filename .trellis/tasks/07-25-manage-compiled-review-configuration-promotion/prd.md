# Manage compiled review configuration promotion

## Goal

Resolve mode-specific inputs, preview semantic changes, and promote pending
compiled manifests safely.

## Requirements

- Resolve the exact source-pinned catalog only for managed mode through the
  trusted credential-scoped management step. Pass setup-discovered fixed
  profiles for standalone without a management credential or network call.
- Present a deterministic semantic diff covering catalog, chains, slots,
  policies including per-lane budget-exhaustion merge behavior, and override
  exposure before writes.
- Write compiled output through pending/validated/active states while preserving
  the prior active manifest until promotion succeeds.
- For audit finding A-013, pending state records enough prior managed-artifact
  identity to recognize and resume every installer-owned interruption point
  without treating the known previous workflow as operator drift.
- Detect managed drift, update idempotently, and uninstall only owned source,
  generated manifest, and explicitly managed labels.

## Acceptance Criteria

- [ ] Missing/stale/mismatched catalog, compiler failure, or interrupted
      promotion leaves the prior active configuration intact.
- [ ] Crash-point fixtures after each pending/source/generated/workflow write
      resume or roll back deterministically, while a genuine operator edit
      remains protected and fails before overwrite.
- [ ] Standalone promotion succeeds with no catalog/control-plane access;
      managed failure never promotes a standalone replacement.
- [ ] Runtime never observes pending or source-only configuration.
- [ ] Dry-run, update, check, reapply, drift, rollback, and uninstall fixtures
      are deterministic and preserve unrelated consumer content.
- [ ] Logs and manifest state contain no credential or raw catalog secret.
- [ ] Promotion refuses managed source with missing/legacy exhaustion policy
      and never fills it from prior state or runtime context.

## Dependencies

- `07-25-compile-routed-review-configuration`.
- `07-25-define-review-candidate-catalog`.

## Out of Scope

- Compiler semantics, runtime dispatch, and provider billing operations.
