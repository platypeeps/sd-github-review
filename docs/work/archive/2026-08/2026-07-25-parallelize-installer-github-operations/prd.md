---
title: Parallelize installer GitHub operations
status: done
created: 2026-07-25
---
# Parallelize installer GitHub operations

## Goal

Reduce cold installer latency with bounded concurrency for independent GitHub CLI reads and mutations.

## Background

Audit finding A-022 was recorded at repository head `2eeca60` with the following evidence:

- `scripts/consumer-installer.mjs:90` uses blocking `spawnSync`.
- `scripts/consumer-installer.mjs:117` serializes independent inspection calls.
- `scripts/consumer-installer.mjs:563` serializes remote mutations.

## Requirements

- Replace blocking non-interactive subprocess execution with an injectable asynchronous boundary.
- Run independent inspection calls concurrently and apply safe variable/label operations with a bounded cap.
- Keep secret prompting/stdin, manifest transitions, rollback, and dependent mutations ordered.
- Cancel or reconcile outstanding work deterministically after failure; never report partial convergence as success.

## Acceptance Criteria

- [ ] Call-order tests prove only independent operations overlap and concurrency never exceeds the configured cap.
- [ ] Failure fixtures preserve pending/uninstalling state and bounded recovery evidence.
- [ ] Secret values remain absent from arguments, reports, manifests, and captured diagnostics.
- [ ] A representative cold-install benchmark records improved wall time without weakening correctness.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-022; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-parallelize-installer-github-operations`:

- research/audit-finding.md
