---
title: Consolidate routing policy boundaries
status: done
created: 2026-07-25
branch: codex/consolidate-routing-policy-boundaries
---
# Consolidate routing policy boundaries

## Goal

Give routing policy, protocol codecs, risk-context construction, and reviewer dispatch one clear dependency direction.

## Background

Audit finding A-008 was recorded at repository head `2eeca60` with the following evidence:

- `src/protocol.js:975` implements routing floors and local-evidence policy despite codec ownership.
- `src/index.js:170` composes standalone routing and dispatch.
- `src/operations.js:333` repeats durable composition.

## Requirements

- Keep versioned decoding/canonicalization in protocol modules and move route selection to one policy owner.
- Extract shared risk-context construction and reviewer-dispatch services used by standalone and durable entrypoints.
- Move generic path matching to a neutral utility rather than coupling receipt persistence to router internals.
- Preserve public v1 behavior while providing explicit seams for v2 standalone and managed planners.

## Acceptance Criteria

- [x] Dependency tests or import checks prove protocol and receipt layers do not import policy internals.
- [x] Standalone and durable parity fixtures use the shared risk and dispatch services.
- [x] Existing route, protocol, receipt, and operation suites remain behaviorally unchanged.
- [x] DESIGN.md and directory-structure specs match the implemented boundaries.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-008; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-consolidate-routing-policy-boundaries`:

- research/a-008-routing-policy-boundaries.md
- research/audit-finding.md
