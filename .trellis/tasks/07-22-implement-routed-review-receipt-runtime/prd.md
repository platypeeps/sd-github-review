# Implement routed-review receipt runtime

## Goal

Implement the versioned, exact-head routed-review request and durable receipt
contract published by archived task
`07-22-publish-routed-review-receipt-contract`.

## Requirements

- Implement canonical request/receipt schemas, fixtures, validation, and
  exact-head identity.
- Derive logical dispatch identity and normalized request fingerprint from
  validated fields; reject spoofed or conflicting evidence.
- Coordinate one native or delegated dispatch per repository/PR/head/attempt
  and reconcile ambiguous retries without a second reviewer request.
- Publish/query the head-bound durable receipt and mirror it to Action outputs.
- Enforce local-summary privacy bounds, independent-review floors, successor
  comparison, and noninteractive fail-closed behavior.
- Preserve current standalone event routing and provider credential ownership.

## Acceptance Criteria

- [ ] All acceptance criteria from the archived contract PRD are implemented
  or explicitly superseded with evidence.
- [ ] Native Copilot and delegated backends share one idempotency/receipt
  envelope with observable finding channels.
- [ ] Same-head, new-head, rerequest, successor, ambiguity, and privacy fixtures
  pass without duplicate dispatch.
- [ ] The command-pack consumer receives a versioned setup/receipt contract and
  an immutable release or commit identity.
- [ ] Full repository checks and a private end-to-end pilot pass.

## Dependency

Use the archived PRD, design, and implementation plan under
`.trellis/tasks/archive/2026-07/07-22-publish-routed-review-receipt-contract/`
as the approved source contract.
