# Authorized Review Adapter Implementation Plan

## Child Delivery Tasks

1. `07-25-integrate-copilot-review-adapter`
2. `07-25-integrate-pr-agent-review-adapter`

The parent completes only after both children pass the shared authorization,
acknowledgment, idempotence, and secret-boundary gates.

## Preconditions

- Freeze immutable child authorization and acknowledgment schemas.
- Qualify candidate/profile policy capabilities against pinned reviewer
  runtimes.
- Curate implementation and check context before `task.py start`.

## Execution Order

1. Add native/external preflight, token boundary, valid, mismatch, timeout, and
   ambiguity fixtures.
2. Implement bounded side-effect-free external request preflight and bind its
   fingerprint to authorization.
3. Gate every adapter side effect on matching durable authorization and the
   exact preflight fingerprint.
4. Implement external single-target invocation and empty internal fallback.
5. Resolve and verify the exact private prompt profile, then apply safe token/
   reasoning/provider policy projections, including the immutable output cap
   and finish-reason mapping.
6. Implement native Copilot request and bounded exact-head observation.
7. Emit bounded model/profile acknowledgments and integrate reconciliation
   references.
8. Harden credential isolation, logs, replay, and changed-head behavior.

## Validation

- Adapter/model provenance and policy enforcement tests.
- Copilot request/observer correlation tests.
- Replay, ambiguity, timeout, and duplicate-publication tests.
- Workflow permission and secret/public-metadata scans.
- `npm test`, `npm run check`, and installer lifecycle tests.

## Rollback Gate

Each handler can be disabled independently. Rollback never enables adapter-
internal cross-model fallback or weakens the authorization boundary.
