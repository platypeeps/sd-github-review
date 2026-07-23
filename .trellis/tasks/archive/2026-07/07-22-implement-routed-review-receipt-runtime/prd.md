# Decompose routed-review receipt runtime delivery

## Goal

Convert the approved versioned routed-review contract into ordered Trellis
tasks that each fit one coherent pull request without losing any runtime,
security, compatibility, or pilot requirement.

## Requirements

- Preserve the archived PRD, design, and implementation plan as the approved
  source contract.
- Separate pure protocol/policy, durable GitHub transport, on-demand dispatch,
  and cross-repository pilot/handoff work at natural ownership boundaries.
- Give every child concrete requirements, acceptance criteria, dependencies,
  affected files, risks, validation, and rollback points.
- Keep the existing external-adapter validation task independent and make the
  final pilot consume its evidence instead of duplicating adapter work.
- Record dependency order explicitly; parent/child links alone are not a
  dependency system.

## Acceptance Criteria

- [x] Four ordered child tasks cover protocol core, durable receipts, on-demand
  dispatch, and pilot/handoff work.
- [x] Every R1-R23 requirement and archived acceptance criterion maps to at
  least one child task.
- [x] Each child is independently actionable and sized for one pull request.
- [x] Private-pilot and command-pack handoff mutations are isolated from
  repo-local implementation and remain approval/evidence gated.
- [x] Task metadata and context validation pass.

## Dependency

Use the archived PRD, design, and implementation plan under
`.trellis/tasks/archive/2026-07/07-22-publish-routed-review-receipt-contract/`
as the approved source contract.

## Child Order

1. `07-23-implement-routed-review-protocol-core`
2. `07-23-implement-durable-routed-review-receipts`
3. `07-23-implement-on-demand-routed-review-dispatch`
4. `07-23-pilot-routed-review-runtime-handoff`

The final pilot also depends on
`07-22-validate-external-reviewer-adapters`; it consumes that task's live
adapter evidence rather than implementing a parallel adapter contract.
