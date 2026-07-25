# Define operation specific Action contract

## Goal

Make Action inputs, permissions, outputs, runtime parsing, and documentation derive from one operation-aware contract.

## Background

Audit finding A-010 was recorded at repository head `2eeca60` with the following evidence:

- `action.yml:6` exposes one global contract for operations with different needs.
- `src/operations.js:517` proves acknowledgment needs no GitHub client.
- `scripts/validate-action-metadata.mjs:206` does not compare runtime semantics.

## Requirements

- Define a versioned tagged operation contract covering names, types, defaults, required/forbidden combinations, permissions, and outputs.
- Choose thin operation wrappers or one envelope without requiring unused GitHub credentials for acknowledgment.
- Generate or validate `action.yml`, examples, runtime decoding, and docs against the authoritative contract.
- Document durable `run-external-reviewer` as authorization for a newly emitted adapter request, not merely a selected route.

## Acceptance Criteria

- [ ] Metadata validation detects missing, extra, default-drifted, or wrong-operation fields.
- [ ] Acknowledgment fixtures run without a GitHub token or client and reject unrelated inputs.
- [ ] Standalone, route, acknowledge, finalize, and query examples expose only their required permissions and contracts.
- [ ] Public output semantics in DESIGN.md and README match runtime replay/query/finalize behavior.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-010; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
