# Consolidate routing policy boundaries Implementation Plan

1. Map current imports and choose neutral policy/path utility boundaries.
2. Extract policy and risk-context services with parity tests.
3. Move dispatch composition behind one interface.
4. Update architecture documentation and run the full suite.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-008 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
