# Reject symlinked installer targets Implementation Plan

1. Add injectable path-inspection helpers and containment errors.
2. Use the guard in every managed read/write/remove path.
3. Add temporary-worktree symlink and TOCTOU regression tests.
4. Update the consumer-installer spec with the containment contract.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-005 regression fixture fails or if an existing exact-head, privacy, ownership, or no-duplicate-side-effect guarantee regresses.
