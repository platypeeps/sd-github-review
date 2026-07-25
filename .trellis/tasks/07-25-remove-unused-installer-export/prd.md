# Remove unused installer export

## Goal

Delete the unreachable `hasManagedFiles` export without changing installer behavior.

## Background

Audit finding A-021 was recorded at repository head `2eeca60` with the following evidence:

- `scripts/consumer-installer.mjs:890` is the only repository reference to `hasManagedFiles`.

## Requirements

- Confirm no documented, generated, or test consumer imports the export.
- Remove only the unused export; retain the live private `pathExists` helper.
- Keep public CLI and programmatic installer interfaces unchanged.

## Acceptance Criteria

- [ ] Repository-wide symbol search finds no remaining reference.
- [ ] Installer lifecycle, syntax, and metadata tests pass.
- [ ] No replacement abstraction or compatibility shim is added without a consumer.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-021; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
