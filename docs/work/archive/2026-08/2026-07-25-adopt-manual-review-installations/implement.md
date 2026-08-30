# Adopt manual review installations Implementation Plan

1. Define historical template registry and semantic equivalence rules.
2. Add explicit CLI parsing and read-only adoption planning.
3. Implement confirmed lifecycle transition and rollback.
4. Add historical, drift, ownership, and documentation fixtures.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-019 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
