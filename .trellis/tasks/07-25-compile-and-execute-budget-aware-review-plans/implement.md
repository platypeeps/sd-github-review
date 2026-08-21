# Budget-Aware Review Engine Implementation Plan

## Child Delivery Tasks

1. `07-25-define-budget-review-v2-contracts`
2. `07-25-compile-routed-review-configuration`
3. `07-25-authorize-budget-aware-review-plans`
4. `07-25-finalize-budget-review-evidence`
5. `07-25-support-standalone-review-mode`
6. `07-25-support-local-attested-reviews`

The sequence below is the parent integration gate after those independently
reviewable children land.

## Preconditions

- Approve the parent source/catalog/compiled ownership design.
- Freeze bounded control-plane and adapter acknowledgment fixtures.
- Curate implementation and check context before `task.py start`.

## Execution Order

1. Land schemas and valid/invalid conformance fixtures.
2. Implement pure source/catalog decoding, prompt-profile reference validation,
   normalization, and canonical digest generation.
3. Implement strict trusted candidate-command parsing, bounded side-effect-free
   options discovery, exact-head plan preparation, and identities.
4. Implement bounded authorization-response validation and durable persistence.
5. Integrate authorized adapter dispatch without exposing alternate models or
   allowing profile substitution.
6. Implement model/profile acknowledgment validation, reconciliation,
   immutable receipts, and revisioned assurance/gate Check projections.
7. Publish bounded status, pending, explain, recovery, and setup discovery.
8. Add historical v1 read-only decoding and v2 cutover tests.
9. Add explicit standalone compilation, direct-handler planning, capability
   reporting, v1 migration, and managed-outage no-downgrade behavior.

## Validation

- Compiler golden, invalid-source/catalog, and reproducibility tests.
- Router/protocol/receipt/operation idempotence, command/options, reserved-label,
  and exact-head tests.
- Authorization mismatch, ambiguity, model-mismatch, and prohibited-field tests.
- Status/recovery/setup-discovery and branch-protection readiness fixtures.
- No-control-plane standalone and managed-service-outage fail-closed fixtures.
- `npm test`, `npm run check`, and `npm run validate:metadata`.
- Each step that wires a v2 module into the entrypoint must, in the same change,
  remove it from the coverage quarantine in `scripts/check-coverage.mjs` and add
  it to the `check` script in `package.json`. Both gates currently cover only the
  v1 modules reachable from `src/index.js`, so neither observes any module this
  task delivers until it is un-quarantined.

## Rollback Gate

No version-2 workflow may emit dispatch until compiler, authorization durability,
and historical-receipt boundaries pass together.
