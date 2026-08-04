# Test shipped review process boundaries

## Goal

Exercise the actual GitHub Action and consumer-installer process entrypoints and prevent critical boundary coverage from regressing.

## Background

Audit finding A-006 was recorded at repository head `2eeca60` with the following evidence:

- `test/consumer-installer.test.js:7` imports the engine and substitutes a fake transport.
- `action.yml:193` ships `src/index.js` as the process entrypoint.
- `.github/workflows/ci.yml:20` has no coverage gate.

## Requirements

- Run `scripts/install-consumer.mjs` as a subprocess with a PATH-injected fake `gh`.
- Run `src/index.js` as a subprocess with temporary event, output, and summary files.
- Cover success, malformed/missing input, exit status, stdin secret handling, exact CLI arguments, and redaction.
- Add conservative global and critical-file coverage floors without hiding generated or side-effecting boundaries.

## Acceptance Criteria

- [x] Installer subprocess tests cover install, check, update, uninstall, JSON/human output, TTY refusal, and redacted failures. — `test/installer-entrypoint.test.js` (install+manifest+gh, check-healthy JSON, update idempotent, uninstall `--yes`, human report without `--json`, `--set-secret` TTY refusal, secret redaction on gh failure).
- [x] Action subprocess tests cover successful output plus missing/malformed event failure annotation and exit status. — `test/action-entrypoint.test.js` (routing outputs+summary exit 0, stdout fallback, missing `GITHUB_EVENT_PATH` `::error::` exit 1, malformed payload `::error::` exit 1).
- [x] CI runs the coverage command and fails below documented floors. — `.github/workflows/ci.yml` runs `npm run test:coverage`; `scripts/check-coverage.mjs` enforces global + per-file floors (teeth-verified: exit 1 when a floor is raised above actual).
- [x] Tests remain hermetic and never use a real repository, network, secret, or user directory. — `test/support/subprocess.mjs` uses temp dirs, a fake `gh` on `PATH`, a locally git-initialised target, and an unroutable `GITHUB_API_URL`.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-006; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
