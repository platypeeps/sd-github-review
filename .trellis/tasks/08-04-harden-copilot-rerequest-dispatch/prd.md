# Harden Copilot rerequest dispatch (A-001)

## Goal

Close audit finding A-001 so an authorized Copilot rerequest actually issues a
new review, while replayed (unauthorized) same-head requests remain suppressed.

## Audit Finding

- ID: A-001 · severity P1 · effort S · confidence Verified · dimension correctness
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: Authorized Copilot rerequests are suppressed as duplicates. A valid
  rerequest writes a new receipt but never requests a new review.

## Evidence Boundary

- `src/receipt.js:476` — a new authorized attempt can permit dispatch.
- `src/operations.js:401` — a prior exact-head review suppresses the new request.
- Why: the exact-head suppression path does not distinguish an authorized
  rerequest from an unauthorized replay, so the authorized case silently no-ops.

Note: since the audit, rerequest scaffolding has appeared
(`rerequest-authorized` input at `src/operations.js:388`, `#validateRerequest`
at `src/receipt.js:417`). The remediation must first confirm whether that
machinery already routes an authorized Copilot rerequest to a real new review,
or only governs same-head authorization (A-015 territory), then close the gap.

## Requirements

- An authorized rerequest (repository-policy `rerequest-authorized` true) for an
  already-reviewed exact head MUST result in a new Copilot review request, not a
  suppressed no-op.
- An unauthorized same-head request MUST still be suppressed (retain
  pending-request deduplication; no replay-driven duplicate dispatch).
- The authorization decision and the dispatch decision must be traceable in the
  receipt/log so an operator can distinguish a suppressed replay from an issued
  rerequest.

## Acceptance Criteria

- [ ] A test proves: prior exact-head review + `rerequest-authorized=true` →
      a new Copilot review is requested.
- [ ] A test proves: prior exact-head review + unauthorized request → suppressed,
      no new dispatch.
- [ ] Current-head verification recorded; `.trellis/audit/ledger.md` A-001 set to
      fixed only after that verification, per the parent epic rule.

## Out of Scope

- Same-head rerequest authorization policy itself (A-015 owner).
- PR-Agent adapter changes (A-004 owner).
- Broad Copilot-adapter feature work in `07-25-integrate-copilot-review-adapter`.
