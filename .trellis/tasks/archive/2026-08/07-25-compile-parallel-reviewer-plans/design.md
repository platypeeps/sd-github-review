# Parallel Reviewer Plan Compiler Design

## Boundary

This child extends the existing v2 source/compiler and pure plan preparation.
It ends with an immutable parent plan and child identities; it performs no
budget mutation or reviewer dispatch.

Each explicit slot selects one fixed candidate or one named chain. Validation
expands possible target sets against the pinned catalog and rejects overlap,
invalid bounds, wrong-lane references, and ambiguous overrides. All children
share the exact head and compiled digest.

Slot-aware `/review options` queries use the same pure expansion to report
bounded safe aliases and eligibility, then stop before creating a plan or child
identity. Candidate selection remains comment-command only; candidate/slot
control labels are unsupported.

## Rollback

Normal rollback compiles one explicit `primary-review` slot per lane. No
contextual default or legacy selector is reintroduced.
