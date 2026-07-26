# Harden pull request identity overrides Implementation Plan

1. Add a strict PR-number decoder and event/override binding rule.
2. Route every metadata and side-effect call through the normalized target.
3. Add negative and explicit-dispatch orchestration tests.
4. Update the input contract documentation if error semantics change.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-002 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
