# Make durable receipt creation concurrency safe Implementation Plan

1. Specify authority and duplicate-reconciliation states in the receipt contract.
2. Implement election and full reread before dispatch authorization.
3. Add deterministic concurrency and eventual-visibility fixtures.
4. Verify query, acknowledge, observe, replay, and changed-head behavior.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-003 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
