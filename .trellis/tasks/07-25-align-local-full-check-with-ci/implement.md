# Align local full check with CI Implementation Plan

1. Identify the supported repository configuration seam.
2. Declare the three authoritative package gates.
3. Add parity validation and failure fixtures.
4. Update PR template and run both local and CI-equivalent commands.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-017 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
