# Implement on-demand routed-review dispatch

## Goal

Expose the completed protocol and receipt store through explicit, noninteractive
Action operations that coordinate one native or delegated dispatch and publish
one canonical durable receipt without breaking standalone event routing.

## Requirements

- Add explicit `route`, `finalize`, and `query` operations (or an equivalent
  reviewed operation model) with versioned JSON inputs and exact PR/head scope.
- Re-read the live head before dispatch and finalization and use only the
  protocol core plus receipt-store authorization; never derive parallel IDs.
- For Copilot, preserve pending/current-head review deduplication and write the
  native result into the shared receipt envelope.
- For `cheap`/`deep`, output exactly one bounded adapter request and require a
  versioned success/failure acknowledgment before final receipt completion.
  Missing or ambiguous acknowledgment must not invite fallback dispatch.
- Mirror the durable receipt JSON and bounded fields to Action outputs and the
  step summary; findings remain on declared GitHub review/comment/check
  channels owned by the backend.
- Publish a versioned setup descriptor and on-demand workflow example with
  workflow identity, contract major, supported intents, durable-receipt
  support, required permissions, and immutable Action placeholder.
- Preserve existing pull-request, label, and trusted issue-comment behavior.
- Keep the router noninteractive, credential-free, and checkout-free; external
  adapter secrets remain only in consumer-owned adapter steps.

## Acceptance Criteria

- [ ] Standalone examples and current event tests are unchanged or explicitly
  compatible.
- [ ] Native Copilot, external comment, external check, and `none` paths emit
  the same canonical receipt envelope with correct finding channels.
- [ ] Same-head replay, new-head, explicit rerequest, conflicting retry,
  missing/unacknowledged adapter, and changed-head finalization fixtures pass
  without duplicate dispatch.
- [ ] Action outputs exactly mirror the persisted receipt and expose backend,
  reason, tier, phase, latency, workflow URL, channels, and limitations.
- [ ] Setup fixtures make ready, absent, missing/disabled/incompatible, and
  metadata-unavailable states unambiguous through read-only discovery.
- [ ] Workflows grant `checks: write` only for durable mode and never check out
  or execute PR-controlled code with provider credentials.
- [ ] README, DESIGN, action metadata, examples, and release checklist agree.
- [ ] Full repository and command-pack checks pass.

## Dependencies

Depends in order on `07-23-implement-routed-review-protocol-core` and
`07-23-implement-durable-routed-review-receipts`.

## Out Of Scope

Provider runtime implementation, command-pack consumer changes, live adapter
licensing/credential validation, private pilot execution, and release tagging.
