---
title: Reuse receipt snapshots during rerequests
status: done
created: 2026-07-25
---
# Reuse receipt snapshots during rerequests

## Goal

Load and decode current-head receipt state once per begin operation and reuse it through rerequest validation and identity lookup.

## Background

Audit finding A-015 was recorded at repository head `2eeca60` with the following evidence:

- `src/receipt.js:396` loads current-head records during rerequest validation.
- `src/receipt.js:486` immediately loads the same records again.

## Requirements

- Introduce an immutable decoded receipt snapshot scoped to one `begin` attempt.
- Pass the snapshot to rerequest validation, identity lookup, and duplicate detection without weakening live-head checks.
- Refresh only at explicit mutation/election boundaries where new visibility matters.
- Keep receipt privacy, canonicalization, and malformed/duplicate failure behavior unchanged.

## Acceptance Criteria

- [ ] Call-count tests prove ordinary and same-head rerequest begins avoid duplicate list calls.
- [ ] Visibility-lag and concurrent-create tests still perform required post-create reconciliation reads.
- [ ] Matching, conflicting, malformed, duplicate, and changed-head fixtures remain green.
- [ ] No stale snapshot can authorize dispatch after a live-head or receipt-state change.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-015; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-reuse-receipt-snapshots-during-rerequests`:

- research/audit-finding.md
