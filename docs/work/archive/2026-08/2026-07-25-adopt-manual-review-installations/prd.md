---
title: Adopt manual review installations
status: done
created: 2026-07-25
branch: feat/adopt-manual-review-installations
---
# Adopt manual review installations

## Goal

Provide a guarded path from approved historical or manual review workflows into installer-managed ownership.

## Background

Audit finding A-019 was recorded at repository head `2eeca60` with the following evidence:

- `SETUP-PR-AGENT.md:207` supports manual workflow copying.
- `scripts/consumer-installer.mjs:458` rejects unmanaged differing workflows.
- Current setup documentation offers no adoption command or recovery path.

## Requirements

- Add an explicit `adopt` operation; never infer adoption during install or update.
- Recognize only allow-listed historical template hashes and semantically equivalent supported configurations.
- Show a dry-run diff and require confirmation before creating ownership metadata or changing remote resources.
- Reject unknown drift with a bounded manual reconciliation procedure and preserve unrelated content.

## Acceptance Criteria

- [x] Known v0.1.0/current manual fixtures adopt deterministically without deleting user resources.
- [x] Unknown, partially matching, symlinked, or provider-conflicting workflows fail before mutation.
- [x] Adoption writes pending then active ownership only after local and remote validation succeeds.
- [x] Check, update, rollback, and uninstall work after adoption and preserve originally unowned resources.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-019; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-adopt-manual-review-installations`:

- research/audit-finding.md
