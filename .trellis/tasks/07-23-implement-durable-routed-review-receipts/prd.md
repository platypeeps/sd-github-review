# Implement durable routed-review receipts

## Goal

Persist and reconcile the protocol core's exact-head receipt envelope through
one GitHub Check Run transport without introducing a second identity contract
or a duplicate-dispatch path.

## Requirements

- Extend `GitHubClient` with read-only live PR-head and compare operations plus
  Check Run create/update/list operations scoped to the exact head.
- Publish one `sd-github-review/receipt` Check Run whose external identity is
  the derived logical dispatch ID and whose output contains a bounded v1 marker
  plus canonical receipt JSON.
- Query receipts by owner/repository, PR, full head, logical identity, and
  correlation aliases; reject malformed, wrong-head, duplicate, or
  contradictory check evidence.
- Coordinate same-identity retries: matching fingerprint reconciles the
  existing receipt and appends a correlation alias; conflicting fingerprint
  fails before any caller is allowed to dispatch again.
- Represent `not-started`, `started`, `acknowledged`, and `observed` phases so
  ambiguous post-start failures demand reconciliation rather than fallback.
- Validate explicit same-head rerequest attempt/prior-receipt/capability/policy
  evidence before creating a new identity.
- Normalize GitHub compare metadata into bounded successor class/digest
  evidence without persisting raw paths or trusting caller classifications.
- Re-read the live head before receipt creation/update; a changed head fails
  closed and produces no current-head receipt.

## Acceptance Criteria

- [x] Receipt create, query, update, alias-retry, conflict, malformed-check,
  duplicate-check, and changed-head tests pass.
- [x] Same exact request cannot produce a second dispatch authorization; a new
  head or valid next attempt has a distinct identity.
- [x] Receipt lookup works after the original Action step and mirrors the
  protocol core envelope byte-for-byte after normalization.
- [x] Interrupted `started` and unacknowledged states return structured
  reconciliation-required outcomes, never a fallback recommendation.
- [x] Compare tests cover bookkeeping-only, mixed, oversized, rewritten,
  non-comparable, incomplete pagination, and head-changed cases.
- [x] Check output contains no raw paths, source, findings, prompts,
  credentials, configuration values, or sensitive pricing data.
- [x] Existing GitHub client and standalone routing tests remain green.

## Dependencies

Depends on `07-23-implement-routed-review-protocol-core`. Import its decoders,
canonical receipt, identity, and fingerprint functions; do not fork them.

## Out Of Scope

Action operation inputs, actual reviewer requests, external adapter execution
or acknowledgments, setup workflows, command-pack consumer changes, and pilot.
