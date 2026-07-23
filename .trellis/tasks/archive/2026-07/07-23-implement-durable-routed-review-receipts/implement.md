# Durable Routed-Review Receipts Implementation Plan

## Execution Order

1. Add failing GitHub transport tests for PR head, compare pagination, and
   Check Run endpoints.
2. Implement transport methods without changing existing request behavior.
3. Add receipt marker/lookup fixtures and implement strict decoding through the
   protocol core.
4. Implement begin/reconcile, aliases, conflicts, phase transitions, and
   rerequest validation.
5. Add successor compare normalization/digest logic and head rechecks.
6. Run focused/full gates and update backend code-specs.

## Validation Plan

- Assert method/path/API-version/auth/payload and surfaced error text.
- Assert no second dispatch authorization after retry, ambiguous create, or
  conflicting evidence.
- Assert raw compare paths never enter serialized receipts.
- Run all repository checks and install/review gates.

## Documentation And Spec Updates

Document Check Run signatures, phase/error matrix, ambiguity semantics, size
limits, and exact-head invariants in backend specs. Public setup/usage docs wait
for the on-demand dispatch child.

## Review Notes

- Review every network mutation for idempotency and ambiguous-result behavior.
- Confirm pagination and duplicate evidence fail closed.
- Confirm this PR cannot request a reviewer.

## Rollback Points

Receipt modules remain unused by standalone Action orchestration until the next
child. Reverting them restores the current output-only runtime.

## Follow-Ups

The on-demand dispatch child consumes `ReceiptStore.begin()` authorization and
must finalize through the same store after native or delegated acknowledgment.
