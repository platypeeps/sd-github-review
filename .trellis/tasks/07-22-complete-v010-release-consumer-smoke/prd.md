# Complete v0.1.0 release and consumer smoke

## Goal

Close the remaining pilot observation and maintainer-approval gates, publish an
immutable first semantic release, and verify installation in a small consumer
set without weakening the existing release checklist.

## Requirements

- Reconfirm the recorded private-pilot scenarios and complete the outstanding
  observation window in `docs/RELEASE_CHECKLIST.md`.
- Require explicit maintainer approval before creating `v0.1.0`.
- Tag and release the exact green candidate without moving an existing tag.
- Replace consumer-facing action placeholders with reviewed full commit SHAs
  where the example is intended to be runnable.
- Smoke-test installation and routing in a bounded consumer set and document
  rollback/upgrade evidence.

## Acceptance Criteria

- [ ] Candidate SHA, source CI, pilot evidence, and approval are recorded.
- [ ] `v0.1.0` and its GitHub release point to the approved immutable commit.
- [ ] A provider-free consumer smoke PR completes with documented route output.
- [ ] Installation examples use immutable SHAs and rollback is tested or
  concretely documented.
- [ ] No provider secret or PR-controlled checkout crosses the pilot boundary.

## Out of Scope

- Publishing without explicit approval.
- Live external-reviewer validation, which belongs to the adapter task.
