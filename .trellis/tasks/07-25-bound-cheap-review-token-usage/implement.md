# Cheap Review Token-Budget Implementation Plan

1. Qualify the pinned PR-Agent/LiteLLM/provider versions for input counting,
   output-cap enforcement, finish-reason reporting, pricing, and usage evidence.
2. Extend catalog, compiled-policy, authorization, acknowledgment, receipt, and
   reconciliation fixtures with hard input/output/cost limits and explicit
   units.
3. Implement provider-compatible or conservative input counting over the fully
   prepared request and reject oversized or unverifiable candidates before
   reservation.
4. Compute and reserve the conservative maximum request cost from prepared
   input, output cap, pinned pricing, unit conversion, and safety margin.
5. Apply the immutable output cap at invocation and map length-limit completion
   to `incomplete_token_limit` without authoritative partial publication.
6. Reconcile full actual usage and distinguish soft `budget_overrun`, hard
   `policy_violation`, candidate quarantine, and pool `overdrawn` state.
7. Publish bounded evidence and documentation, then run focused adapter,
   routing, ledger, receipt, privacy, and installer checks.

## Validation

- Exact, under-, and over-boundary input and output fixtures.
- Automatic same-chain continuation versus explicit-candidate hard block.
- No silent truncation, deep escalation, or post-dispatch fallback.
- Normal completion, output-cap termination, soft overrun, hard violation,
  unknown usage, and overdrawn-pool recovery.
- Tokenizer, price, unit, capability, digest, and provider mismatch failures.
- `npm test`, `npm run check`, and `npm run validate:metadata`.

## Rollback Gate

Do not enable a cheap candidate until its tokenizer/count bound, output cap,
finish reason, pricing, and usage evidence are proven together. Roll back by
disabling the candidate; never fall back to an unenforced token policy.
