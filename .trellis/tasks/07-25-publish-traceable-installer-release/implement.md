# Publish traceable installer release Implementation Plan

1. Define release identity fields and compatibility rules.
2. Add release-reference synchronization and validation.
3. Prepare migration/changelog/release notes and cut only after exact-head gates pass.
4. Run released-artifact consumer smoke and rollback checks.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-007 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
