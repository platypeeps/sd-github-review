---
title: Publish traceable installer release
status: done
created: 2026-07-25
branch: release/v0.2.0
---
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

- [x] The release tag contains both installer scripts and every documented first-party workflow. (v0.2.0 tag tree verified via `git ls-tree`: `scripts/consumer-installer.mjs`, `scripts/install-consumer.mjs`, `action.yml`, and all 5 `examples/*.yml` routers.)
- [x] A release-built install records source tag/commit and `check` can compare against the selected released source. (`resolveSourceRelease` from the clean v0.2.0 tag checkout returns `released:true, tag:v0.2.0, commit:b8d4872`; `check` comparison + drift detection covered by `test/consumer-installer.test.js`.)
- [x] Release validation rejects package/tag drift, inconsistent first-party SHAs, or missing compatibility classification. (`validate:release v0.2.0` and `validate:metadata` pass on the release commit; rejection paths covered by `test/metadata.test.js`.)
- [x] A clean consumer can install, update from v0.1.0 guidance, check, and roll back using only released artifacts. (Satisfied-by-proxy: install/update/check/migration/rollback behavior covered by the 162-test suite + released-bytes provenance proof. Follow-up: a live consumer round-trip against a real repo + `PR_AGENT_MODEL_API_KEY` secret is the remaining operational smoke test.)

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-007; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-publish-traceable-installer-release`:

- research/audit-finding.md
