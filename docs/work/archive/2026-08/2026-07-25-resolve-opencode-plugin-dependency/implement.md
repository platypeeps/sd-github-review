# Resolve OpenCode plugin dependency Implementation Plan

1. Inspect OpenCode loading behavior and run a bounded smoke probe.
2. Choose removal or a frozen nested install.
3. Add audit/validation coverage for the chosen shape.
4. Update metadata documentation if the install contract changes.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-016 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
