# Parallel Reviewer Plan Compiler Implementation Plan

1. Add one/two/many-slot source, compiled, and plan fixtures.
2. Extend compiler validation for slots, bounds, thresholds, and disjointness.
3. Implement slot-targeted override and unambiguous shorthand rules.
4. Produce stable parent/child identities and side-effect-free proposed plans.
5. Add migration, docs, and single-slot rollback fixtures.

Validate overlap, wrong lane, duplicates, limits, thresholds, cheap/deep
independence, deterministic output, and no contextual defaults.
