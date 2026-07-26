# Skip irrelevant PR file enumeration

## Goal

Avoid GitHub pull-request file pagination when no sensitive-path policy can affect routing.

## Background

Audit finding A-014 was recorded at repository head `2eeca60` with the following evidence:

- `src/index.js:207` does not test whether parsed patterns are empty.
- `src/operations.js:340` fetches files before parsing patterns.
- `src/github.js:215` allows up to 30 sequential pages.

## Requirements

- Parse and normalize sensitive patterns before deciding whether to enumerate files.
- Skip file requests when routing is explicit, the event is ignored, draft policy skips, or the pattern set is empty.
- Keep the over-3,000-file fail-closed behavior when path evaluation is actually required.
- Apply identical call-avoidance semantics to standalone and durable routing.

## Acceptance Criteria

- [ ] Standalone and durable tests assert zero file calls for every irrelevant condition.
- [ ] Nonempty sensitive-pattern fixtures still route correctly and preserve pagination bounds.
- [ ] Empty configuration emits the same decision and safe outputs without a file request.
- [ ] Call-count regressions fail deterministically.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-014; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
