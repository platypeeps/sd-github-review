# Skip irrelevant PR file enumeration Implementation Plan

1. Centralize the need-for-path-evaluation predicate.
2. Use it in standalone and durable paths.
3. Add negative side-effect and parity tests.
4. Update quality examples if orchestration order changes.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-014 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
