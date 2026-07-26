# Decompose consumer installer lifecycle Implementation Plan

1. Extract codecs and pure plan first.
2. Extract transport and persistence behind injected interfaces.
3. Reduce the original module to orchestration and compatibility exports.
4. Run lifecycle, subprocess, metadata, and install-audit gates.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-009 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
