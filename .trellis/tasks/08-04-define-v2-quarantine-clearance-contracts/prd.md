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

- [ ] Quarantine status and clearance request/response fixtures bind candidate,
      actor, reason, remediation evidence, policy/configuration digest, and audit
      identity without granting implicit budget or dispatch authority (parent AC13).
- [ ] Distinct fixtures exercise `input_ineligible`, `incomplete_token_limit`,
      `budget_overrun`, and `candidate_quarantined` (parent AC10 residual).
- [ ] npm test, syntax check, metadata + ci-parity validation, coverage gate green.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (shared design.md, frozen reason enum).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.
