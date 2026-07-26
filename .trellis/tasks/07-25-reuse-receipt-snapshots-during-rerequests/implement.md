# Reuse receipt snapshots during rerequests Implementation Plan

1. Define the internal snapshot shape and ownership.
2. Refactor query helpers to accept a supplied snapshot.
3. Add call-count and stale-state tests.
4. Run receipt and operation suites.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-015 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
