# On-Demand Routed-Review Dispatch Implementation Plan

## Execution Order

1. Add Action metadata and failing decoder/output compatibility tests.
2. Implement operation staging and exact-head `route` through the protocol and
   receipt store.
3. Integrate native Copilot and external adapter request output into one
   receipt envelope.
4. Implement `finalize` acknowledgment and read-only `query` operations.
5. Add setup descriptor, no-checkout on-demand workflow, and setup fixtures.
6. Update README/DESIGN/release guidance and executable backend specs.
7. Run focused, full, install, metadata, and review checks.

## Validation Plan

- Assert existing standalone behavior and output compatibility.
- Assert forbidden calls for replay, conflict, stale head, ambiguous state,
  unacknowledged adapter, and query.
- Parse every workflow/example and inspect minimal permissions/no checkout.
- Run `npm test`, `npm run check`, `npm run validate:metadata`, install audit,
  and review preflight/full-check.

## Documentation And Spec Updates

Document setup discovery, operation contracts, required permissions, durable
lookup, ambiguity recovery, provider-secret ownership, and no-checkout bounds.

## Review Notes

- Trace every operation through the same canonical protocol and receipt store.
- Confirm outputs do not become a second contract.
- Confirm no provider secret or PR-controlled execution enters router steps.

## Rollback Points

Disable/remove explicit durable operations and on-demand example; existing
standalone event routing remains the supported fallback. Preserve historical
receipts and never compensate with another provider request.

## Follow-Ups

The pilot child validates the assembled runtime and immutable handoff. External
adapter quality/licensing work remains in its existing task.
