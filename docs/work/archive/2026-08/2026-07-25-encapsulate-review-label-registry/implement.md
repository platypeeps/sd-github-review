# Encapsulate review label registry Implementation Plan

1. Add the non-mutable public API.
2. Migrate callers and alignment tests.
3. Delete the mutable export.
4. Run routing, Action, installer, and metadata suites.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-020 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
