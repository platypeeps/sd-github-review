---
title: Define v2 quarantine status and clearance contracts
status: done
created: 2026-08-04
branch: feat/08-04-define-v2-quarantine-clearance-contracts
---
# Define v2 quarantine status and clearance contracts

## Goal

Define the candidate quarantine status schema and the clearance request/response
contracts. Completes parent AC13.

## Requirements

- Define quarantine status and clearance request/response schemas binding
  candidate, actor, reason, remediation evidence, policy/configuration digest,
  and audit identity.
- Grant no implicit budget or dispatch authority through quarantine/clearance.
- Add valid/invalid fixtures for every residual preflight/outcome reason code not
  distinctly fixtured by the v2 contract core: `input_ineligible`,
  `incomplete_token_limit`, `budget_overrun`, and `candidate_quarantined`
  (parent AC10 residual), each distinguished without exposing prompts or output.

## Acceptance Criteria

- [x] Quarantine status and clearance request/response fixtures bind candidate,
      actor, reason, remediation evidence, policy/configuration digest, and audit
      identity without granting implicit budget or dispatch authority (parent AC13).
- [x] Distinct fixtures exercise `input_ineligible`, `incomplete_token_limit`,
      `budget_overrun`, and `candidate_quarantined` (parent AC10 residual).
- [x] npm test, syntax check, metadata + ci-parity validation, coverage gate green.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (shared design.md, frozen reason enum).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/08-04-define-v2-quarantine-clearance-contracts`:

- research/quarantine-clearance-gap-analysis.md
