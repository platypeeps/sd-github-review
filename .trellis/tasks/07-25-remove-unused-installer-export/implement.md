# Remove unused installer export Implementation Plan

1. Repeat tracked and untracked reference search.
2. Remove the function.
3. Run installer tests, syntax check, and metadata validation.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-021 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
