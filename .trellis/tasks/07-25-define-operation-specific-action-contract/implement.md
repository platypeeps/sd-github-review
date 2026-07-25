# Define operation specific Action contract Implementation Plan

1. Inventory operation-specific inputs, outputs, and permissions.
2. Define the tagged contract and compatibility mapping.
3. Wire runtime and metadata validation to the contract.
4. Update examples/docs and add drift regression fixtures.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-010 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
