# Bound review remote operations

## Goal

Add explicit, testable deadlines to GitHub HTTP requests and consumer-installer subprocesses.

## Background

Audit finding A-012 was recorded at repository head `2eeca60` with the following evidence:

- `src/github.js:156` calls `fetch` without an abort signal.
- `scripts/consumer-installer.mjs:89` calls `spawnSync` without a timeout.

## Requirements

- Apply a configurable per-attempt timeout to GitHub requests without shortening evidence-backed rate-limit waits incorrectly.
- Apply bounded timeouts to `gh`, Git, and credential-helper subprocesses used by the installer.
- Distinguish timeout from HTTP, provider, validation, and ambiguous mutation failures with bounded errors.
- Never retry mutating requests merely because a timeout occurred; require reconciliation where side effects are uncertain.

## Acceptance Criteria

- [x] Injected-clock tests cover request timeout before response, body stall, retry interaction, and mutating ambiguity.
- [x] Fake child-process tests cover timeout exit, redaction, and recovery guidance.
- [x] Timeout values are documented, positive, bounded, and do not leak secrets or commands.
- [x] Existing retry and lifecycle tests remain green.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-012; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
