# Test shipped review process boundaries Implementation Plan

1. Build reusable subprocess and fake-`gh` fixtures.
2. Add installer boundary cases.
3. Add Action entrypoint smoke and failure cases.
4. Define coverage command/floors and wire them into CI.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-006 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
