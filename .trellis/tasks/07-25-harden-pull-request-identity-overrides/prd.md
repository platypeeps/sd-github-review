# Harden pull request identity overrides

## Goal

Bind routing metadata, GitHub reads, and reviewer mutations to one strictly validated pull-request identity.

## Background

Audit finding A-002 was recorded at repository head `2eeca60` with the following evidence:

- `src/index.js:138` parses `pr-number` independently with `Number.parseInt`.
- `src/index.js:179` keeps event PR metadata while later GitHub operations use the override.
- `src/index.js:235` performs reviewer operations against the override target.

## Requirements

- Accept only a complete positive decimal override; reject suffixes, signs, whitespace variants, zero, and unsafe integers.
- When an event carries a PR identity, reject a conflicting override before constructing a GitHub client or emitting outputs.
- Use one normalized PR number for metadata lookup, file enumeration, reviewer lookup, mutation, outputs, and summaries.
- Preserve explicit `workflow_dispatch` support by fetching all metadata for its normalized target.

## Acceptance Criteria

- [ ] Mismatched event/override fixtures fail before any GitHub call.
- [ ] Malformed values including `12garbage` are rejected with a field-specific bounded error.
- [ ] Standalone explicit-target and event-target tests assert every client call uses the same PR number.
- [ ] Existing routing precedence and output tests remain green.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-002; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
