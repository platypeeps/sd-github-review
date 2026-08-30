---
title: Encapsulate review label registry
status: done
created: 2026-07-25
---
# Encapsulate review label registry

## Goal

Prevent importers from mutating the process-wide registry of supported review labels.

## Background

Audit finding A-020 was recorded at repository head `2eeca60` with the following evidence:

- `src/router.js:167` exports a mutable `Set` consumed by entrypoint event gating.

## Requirements

- Keep the mutable lookup structure private to the routing module.
- Expose an `isReviewLabel(value)` predicate or an immutable value collection.
- Update callers and metadata tests to use the stable public contract.
- Do not change the supported label set or precedence.

## Acceptance Criteria

- [ ] No exported object permits adding or deleting supported labels.
- [ ] Router, Action, installer, and metadata label-alignment tests remain green.
- [ ] A regression test proves caller mutation cannot change event-gating behavior.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-020; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-encapsulate-review-label-registry`:

- research/audit-finding.md
