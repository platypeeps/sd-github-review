---
title: Make durable receipt creation concurrency safe
status: done
created: 2026-07-25
---
# Make durable receipt creation concurrency safe

## Goal

Ensure concurrent begins elect one authoritative receipt and authorize at most one reviewer dispatch.

## Background

Audit finding A-003 was recorded at repository head `2eeca60` with the following evidence:

- `src/receipt.js:486` checks absence before a separate Check Run create.
- `src/receipt.js:519` can authorize after rereading only the creator's visible Check Run.
- `src/receipt.js:323` rejects later duplicate logical identities without a recovery path.

## Requirements

- Define a deterministic authority rule for multiple Check Runs with one logical dispatch identity.
- Authorize dispatch only after the authoritative receipt is visible and no competing create can also become authoritative.
- Represent extra creates as bounded reconciliation evidence; never delete or overwrite ambiguous records automatically.
- Keep matching replay, changed-head, ambiguous mutation, and exact-head privacy guarantees intact.

## Acceptance Criteria

- [ ] A barrier-controlled concurrent-begin test proves exactly one `dispatchAllowed=true`.
- [ ] After all creates are visible, query/finalize resolves the elected receipt or returns a recoverable reconciliation state rather than wedging forever.
- [ ] Duplicate and visibility-lag fixtures never authorize two reviewer requests.
- [ ] Receipt outputs remain canonical, bounded, and free of prohibited data.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-003; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-make-durable-receipt-creation-concurrency-safe`:

- research/audit-finding.md
