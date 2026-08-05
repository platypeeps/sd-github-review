# Decompose consumer installer lifecycle

## Goal

Split the consumer installer into focused modules without changing its public CLI or ownership guarantees.

## Background

Audit finding A-009 was recorded at repository head `2eeca60` with the following evidence:

- `scripts/consumer-installer.mjs:115` owns GitHub transport.
- `scripts/consumer-installer.mjs:273` owns validation.
- `scripts/consumer-installer.mjs:487` owns planning and mutation.
- `scripts/consumer-installer.mjs:836` owns CLI parsing.

## Requirements

- Separate manifest/config codecs, pure lifecycle planning, GitHub CLI transport, local persistence, and orchestration.
- Retain one thin CLI entrypoint and one stable programmatic lifecycle interface.
- Keep secret handling, dry-run, pending/active state, ownership allowlists, and failure recovery behavior unchanged.
- Sequence this refactor so other installer remediation tasks can land without repeated merge conflicts.

## Acceptance Criteria

- [x] Module-level tests mirror the new boundaries and existing lifecycle tests pass unchanged.
- [x] No provider secret, raw remote payload, or host path enters reports or manifests.
- [x] Install/update/check/uninstall outputs and exit semantics remain compatible.
- [x] The resulting modules have explicit dependency direction and no cycle.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-009; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
