# Candidate-Bound Cheap Prompt Profiles Implementation Plan

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
