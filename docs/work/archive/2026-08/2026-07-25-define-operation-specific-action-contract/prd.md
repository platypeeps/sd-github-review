---
title: Define operation-specific Action contract
status: done
created: 2026-07-25
---
# Define operation-specific Action contract (A-010)

## Goal

Make the Action's operation set, per-operation inputs, permissions, outputs,
runtime decoding, and documentation derive from one authoritative operation
contract, so metadata, runtime, permissions, and docs can no longer drift
independently.

## Background

Audit finding A-010 (P2 · effort M · design), recorded at head `2eeca60`.
Current-head evidence (2026-08-04, after this session's A-004/A-013/A-021/A-022):

- `action.yml:8` declares `github-token: required: true` globally, but the
  `acknowledge` operation returns at `src/operations.js:517` before any client
  or token is read. Metadata asserts a requirement the operation does not have.
- The operation set is triplicated: the `OPERATIONS` set (`operations.js:15`),
  the error string (`operations.js:233`), and `standalone` special-cased in
  `normalizeOperation` — plus `supportedOperations` in
  `config/routed-review-setup-v1.json:11`. No single source of truth.
- `scripts/validate-action-metadata.mjs` (`validateMetadata`, ~:277) checks only
  structure and SHA/digest pinning; it never cross-checks `action.yml` inputs or
  outputs against what each operation actually reads or emits, and never flags
  the `github-token` global-required mismatch.
- Permission drift: `config/routed-review-setup-v1.json:16-20` declares durable
  `requiredPermissions` = `contents:read, pull-requests:write, checks:write`
  (no `issues`), but `examples/pr-agent-on-demand-review-router.yml` grants
  `issues: write` on its `review` and `finalize` jobs, and DESIGN.md:324-325
  states the permission contract in prose without mentioning `issues` at all.

## Operations (authoritative set)

`standalone` (default), `route`, `acknowledge`, `finalize`, `query`.

- `standalone` — event-driven routing; constructs client lazily; needs
  `contents:read` (+ `pull-requests:write` when Copilot enabled).
- `route` — durable dispatch; constructs client; needs
  `contents:read, pull-requests:write, checks:write`.
- `acknowledge` — side-effect-free adapter helper; **no client, no token**;
  reads only `adapter-request` + `adapter-outcome`.
- `finalize` — durable receipt completion via the store; needs
  `contents:read, checks:write` (client constructed for the store).
- `query` — durable receipt read via the store; needs `contents:read,
  checks:write`.

Note the Action's operation permission needs are distinct from an external
**adapter container's** needs. A-004 deliberately isolated the PR-Agent
container (which needs `issues:write` for its comment channel) from the
receipt-authority jobs. This contract governs the Action's operations only; it
must not strip a permission an adapter container legitimately requires, nor
re-merge the isolated jobs.

## Requirements

- Define one authoritative operation contract (a JS module, importable by
  runtime, validation, and tests) declaring, per operation: canonical name,
  whether it needs a GitHub client/token, its required inputs, its optional
  inputs, its forbidden inputs, its required Action permissions, and the outputs
  it emits.
- Derive the runtime operation set and `normalizeOperation` from the contract —
  remove the triplicated operation list; the runtime decoders remain the trust
  boundary but read required/forbidden expectations from the contract.
- `acknowledge` must run without constructing a GitHub client and must reject
  inputs carrying *another operation's* semantics (e.g. `review-request`,
  `cheap-backend`) — forbidden-input enforcement. It must still tolerate the
  universal envelope inputs `operation` and `github-token`: the shipped
  `finalize` job's acknowledge step passes `github-token: ${{ github.token }}`
  (`examples/pr-agent-on-demand-review-router.yml:171`) and must keep working,
  so `github-token` is an ignored/optional input for acknowledge, not forbidden.
- Fix the `github-token` metadata mismatch: it cannot be globally
  `required: true` when `acknowledge` does not use it. Make it non-required in
  metadata and enforce its presence at runtime for the operations that need it
  (`route`, `finalize`, `query`), with a bounded, explicit error.
- Extend `validate-action-metadata.mjs` to validate `action.yml` against the
  contract: every declared input/output is used by some operation, no input is
  globally required unless every operation requires it, and no operation's
  contract input/output is missing from metadata.
- Validate each shipped/example workflow's Action-operation `permissions` as a
  **lower bound**: for every job that runs this Action, the granted `permissions`
  must include the union of the permissions the contract lists for each operation
  that job runs. Do not enforce an upper bound — a single job legitimately runs
  multiple operations (the `finalize` job runs `acknowledge` + `finalize`) and
  holds extra permissions for comment/side-effect or non-Action steps (both the
  `review` and `finalize` jobs hold `issues:write`/`pull-requests:write` beyond
  the receipt set). Jobs that do not run this Action (the isolated `pr-agent`
  container) are outside contract scope and are not permission-checked, which
  preserves A-004 by construction. Contract permissions per operation must be
  grounded in that operation's actual GitHub API calls and reconciled with
  A-004's stated durable set (`contents:read, pull-requests:write, checks:write`,
  no `issues`).
- Reconcile `config/routed-review-setup-v1.json` `supportedOperations` and
  `requiredPermissions` with the contract (validated, not duplicated).
- Align documentation (DESIGN.md, README.md) so the per-operation permission and
  output semantics match the contract and runtime, including an explicit
  statement that durable authorization to run an external adapter is the emitted
  `adapter-request` (not merely `run-external-reviewer`, which is the standalone
  gate), and that the durable receipt jobs' extra `issues:write`/
  `pull-requests:write` are job-level permissions for PR-comment side effects,
  distinct from (and a superset of) the contract's receipt-operation set — not a
  claim that the receipt operations themselves require `issues`.

## Acceptance Criteria

- [x] One contract module is the sole source of the operation set; runtime,
      metadata validation, and tests read it. The old triplicated list is gone.
- [x] Metadata validation fails on: an `action.yml` input/output absent from the
      contract, a contract input/output absent from `action.yml`, and any input
      declared globally required that some operation does not require
      (regression-tested with a deliberately drifted fixture).
- [x] `acknowledge` runs with no client and rejects an other-operation input
      (e.g. `review-request`) while still accepting the shipped example's
      `github-token`/`operation` envelope; existing `operations.test.js:228`
      (no client) still passes, and the shipped `finalize` job's acknowledge
      step (which passes `github-token`) is not rejected.
- [x] `route`/`finalize`/`query` raise a bounded explicit error when
      `github-token` is absent; `action.yml` no longer declares it globally
      required.
- [x] Each Action-running job grants at least the union of its operations'
      contract permissions (lower-bound check); the real `examples/*` workflows
      pass unchanged, and a fixture that drops a required permission fails. No
      upper-bound check is imposed. Non-Action jobs (the `pr-agent` container)
      are not permission-checked, so A-004 isolation and permissions are
      preserved with no job re-merge.
- [x] `config/routed-review-setup-v1.json` supportedOperations/requiredPermissions
      are validated against the contract and agree.
- [x] DESIGN.md/README output & permission semantics match runtime; the durable
      adapter-authorization and `issues:write` ownership are documented.
- [x] Full suite green; `npm test`, `npm run check`, `npm run validate:metadata`,
      and `npm run check:full` pass with 0 preflight failures.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Must preserve A-004 (PR-Agent receipt-authority isolation), A-003 (durable
  receipt concurrency), and the durable-receipt permission model.

## Out of Scope

- Findings other than A-010 (A-009 installer decomposition, A-018 profiles).
- Changing routing behavior, receipt semantics, or which route maps to which
  reviewer.
- Re-merging or re-permissioning the A-004-isolated adapter jobs.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-define-operation-specific-action-contract`:

- research/audit-finding.md
