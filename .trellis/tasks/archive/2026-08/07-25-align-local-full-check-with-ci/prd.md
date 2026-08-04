# Align local full check with CI

## Goal

Make the prescribed local full-check execute the exact package gates enforced by repository CI.

## Background

Audit finding A-017 was recorded at repository head `2eeca60` with the following evidence:

- `scripts/sd-ai-command-pack-full-check.sh:1033` defaults to unrelated generic stage names.
- `package.json:12` defines `test`, `check`, and `validate:metadata`.
- `.github/workflows/ci.yml:20` runs those three checks.

## Requirements

- Add a repository-owned configuration or wrapper that invokes all CI package gates locally.
- Fail when a required package gate is missing or skipped; warnings are not success.
- Keep the installed command-pack source generated and update the durable consumer-side configuration point.
- Make the PR template name the parity-preserving command.

## Acceptance Criteria

- [x] A clean local full-check runs test, check, and metadata validation and reports their results.
- [x] A fixture that removes or fails one package script makes the local gate fail.
- [x] CI and local gate inventories are compared by a regression test or validator.
- [x] No unrelated generic stage is required for this repository.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-017; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
