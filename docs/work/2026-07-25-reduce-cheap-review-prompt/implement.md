# Candidate-Bound Cheap Prompt Profiles Implementation Plan

## Current state (verified 2026-08-20)

This plan is not greenfield. Profile identity, exact binding, the forbidden
default/inheritance/fallback/override levers, digest-change invalidation, and
the pre-dispatch mismatch failures already exist and are unit-tested:
`src/review-candidate-catalog.js:55`, `:567-609`, `:616-631`, `:733-739`,
`:1012-1027`; `src/routed-review-compiler.js:333-334`, `:404-405`;
`src/review-plan-authorization.js:101`, `:461-462`, `:955-956`. Step 1's
inventory is recorded in `research/2026-08-20-research.md`.

What is missing is the adapter side and the application: no module owns the
private registry values, and neither workflow path passes any prompt or output
control to the container — both run bare `review` with three `CONFIG__*`
variables (`.github/workflows/ai-review-router.yml:114-139`,
`examples/sd-review.yml:134-159`). The four modules holding the profile stack
are also unreachable from `src/index.js` (9,390/13,136 lines, 71%), so steps 3-4
depend on a delivery decision recorded as Open Question 1 in the research note.

## Plan

1. Inventory supported prompt/output controls in the pinned PR-Agent runtime.
2. Define immutable profile metadata and private adapter-registry fixtures for
   the current cheap candidate plus at least one replacement candidate.
3. Bind every cheap external candidate to exactly one profile and add shared
   and candidate-specific profile cases.
4. Apply and acknowledge the exact profile in both PR-Agent workflow paths.
5. Add advisory candidate/profile token, actionable-finding, and false-positive
   comparisons with explicit evidence limitations.
6. Document profile authoring, qualification invalidation, normal reviewed
   updates, and rollback without defaults or inheritance.

Validate exact binding/application, digest mismatch, unsupported capability,
privacy/redaction, deep-profile isolation, explicit candidate behavior, and
the relevant full repository gates.
