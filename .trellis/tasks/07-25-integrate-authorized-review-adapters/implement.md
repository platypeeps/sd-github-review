# Authorized Review Adapter Implementation Plan

## Child Delivery Tasks

1. `07-25-integrate-copilot-review-adapter`
2. `07-25-integrate-pr-agent-review-adapter`

The parent completes only after both children pass the shared authorization,
acknowledgment, idempotence, and secret-boundary gates.

## Preconditions

- Child authorization and acknowledgment schemas are already frozen and shipped
  (`src/protocol-v2.js`, `src/review-plan-authorization.js`,
  `src/review-candidate-catalog.js`; tasks
  `07-25-define-budget-review-v2-contracts` and
  `07-25-authorize-budget-aware-review-plans` are archived). Consume them; do
  not redefine them.
- Re-own the control-plane contract this task's `prd.md` names as a dependency.
  `07-25-define-consumer-review-control-plane` does not exist; the parent's
  `implement.md` makes re-owning it (recreate, or fold into
  `07-25-compile-and-execute-budget-aware-review-plans`) a precondition of this
  child specifically, because the bounded acknowledgment is defined against that
  contract. Repointing at the archived
  `07-25-authorize-budget-aware-review-plans` /
  `07-25-define-review-usage-reconciliation` is an acceptable resolution, but it
  has to be recorded rather than assumed.
- Confirm the compiled lane vocabulary before dispatch work starts. This adapter
  dispatches per lane, and the code's `REVIEW_LANES = ["review","assurance","gate"]`
  (`src/protocol-v2.js:61`) is not the `cheap`/`deep` vocabulary the parent PRD
  and design use. That decision is parent Precondition (b).
- Decide where the adapter seam sits and add the corresponding edge to
  `test/dependency-boundaries.test.js:18-55`, which today grants neither
  `operations.js` nor `index.js` any path into a v2 module. Nothing else in
  this plan can start until that edge exists.
- Extend the shipped v1 seam (`src/operations.js:141-160`, `:242-259`,
  `:455-485`; `examples/sd-review.yml:69-185`) rather than building a parallel
  one, so the existing `adapter-request` path is not orphaned.
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
- Allowed-import matrix and single-definition assertions
  (`test/dependency-boundaries.test.js`), which every wiring change trips
  first.
- `npm test`, `npm run check`, and installer lifecycle tests.

## Rollback Gate

Each handler can be disabled independently. Rollback never enables adapter-
internal cross-model fallback or weakens the authorization boundary.
