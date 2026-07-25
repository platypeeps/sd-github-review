# Reject symlinked installer targets

## Goal

Contain every installer read, write, rename, and removal beneath a canonical consumer worktree without following repository-controlled symlink ancestors.

## Background

Audit finding A-005 was recorded at repository head `2eeca60` with the following evidence:

- `scripts/consumer-installer.mjs:404` resolves only the Git worktree root.
- `scripts/consumer-installer.mjs:438` joins fixed destinations without canonicalizing ancestors.
- `scripts/consumer-installer.mjs:242` writes through existing path components.

## Requirements

- Inspect every existing ancestor from the canonical root to each managed destination with `lstat`-equivalent semantics.
- Reject symlinks, unexpected non-directories, and any resolved destination outside the root before local or GitHub mutation.
- Recheck containment immediately before atomic rename or removal to narrow time-of-check/time-of-use exposure.
- Apply the same guard to install, update, check, adoption, rollback, and uninstall paths.

## Acceptance Criteria

- [ ] Malicious `.github/workflows` and manifest-ancestor symlink fixtures fail before writing outside the target.
- [ ] Normal missing-directory creation and regular-directory lifecycle tests still pass.
- [ ] A replacement-between-plan-and-write fixture fails safely without touching the external target.
- [ ] Dry-run and check report bounded path errors without leaking unrelated host paths.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-005; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
