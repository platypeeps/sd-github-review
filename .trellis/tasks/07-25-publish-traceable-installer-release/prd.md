# Publish traceable installer release

## Goal

Ship the current installer and working PR-Agent templates under a reproducible release identity with an explicit upgrade path.

## Background

Audit finding A-007 was recorded at repository head `2eeca60` with the following evidence:

- `README.md:38` depends on the post-v0.1.0 installer.
- `SETUP-PR-AGENT.md:19` rejects the only release's Docker Action pattern.
- `scripts/consumer-installer.mjs:530` omits source tag/commit from manifests.

## Requirements

- Cut a reviewed release containing the installer, direct `docker run` PR-Agent workflows, and current setup discovery.
- Record immutable installer source tag and commit in new or updated consumer manifests.
- Define version-selection, package/tag consistency, changelog, migration-note, and first-party SHA synchronization gates.
- Publish an explicit v0.1.0 migration advisory and rollback instructions.

## Acceptance Criteria

- [ ] The release tag contains both installer scripts and every documented first-party workflow.
- [ ] A release-built install records source tag/commit and `check` can compare against the selected released source.
- [ ] Release validation rejects package/tag drift, inconsistent first-party SHAs, or missing compatibility classification.
- [ ] A clean consumer can install, update from v0.1.0 guidance, check, and roll back using only released artifacts.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-007; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
