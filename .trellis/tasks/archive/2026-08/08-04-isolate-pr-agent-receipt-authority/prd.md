# Isolate PR-Agent receipt authority (A-004)

## Goal

Close audit finding A-004 so a third-party PR-Agent reviewer can no longer forge
durable-receipt state used for dispatch deduplication. Separate reviewer
execution from the receipt-writing job and its token.

## Audit Finding

- ID: A-004 · severity P1 · effort M · confidence Verified · dimension security
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: The PR-Agent reviewer job holds `checks: write` and receives the same
  token that writes durable receipts. A compromised reviewer can forge receipt
  state that dispatch deduplication trusts.

## Evidence Boundary

- `examples/pr-agent-on-demand-review-router.yml:28` — reviewer job `permissions`
  block grants `checks: write` (and `pull-requests: write`).
- `examples/pr-agent-on-demand-review-router.yml:90` — the same `github.token`
  (`GITHUB__USER_TOKEN: ${{ github.token }}`) enters the third-party reviewer
  container.
- Confirmed still present on main @ a546883 (2026-08-04); last commit on the file
  is `4ca429b`, a feature change, not this isolation fix.

## Requirements

- The third-party PR-Agent reviewer step MUST NOT receive a token with
  `checks: write` (or any receipt-writing authority).
- Receipt writing MUST occur in a separate job/step whose token the reviewer
  container never sees.
- The reviewer retains only the least privilege it needs to post review output
  (e.g. `pull-requests: write` for comments) — no checks/receipt authority.
- Dispatch deduplication must continue to work with the split; receipts are
  written by the trusted job, keyed to the same logical dispatch identity.

## Acceptance Criteria

- [x] `examples/pr-agent-on-demand-review-router.yml` reviewer job no longer
      grants `checks: write` and no longer passes a receipt-authoritative token
      into the reviewer container. (The `pr-agent` job holds only
      `contents: read` + `pull-requests: write`.)
- [x] Receipt writing is performed by a distinct job/step with its own scoped
      token, documented in the workflow. (`review` + `finalize` jobs hold
      `checks: write`; the reviewer job does not; workflow default is
      `contents: read`.)
- [x] Any shipped/installed copy of this template is consistent with the
      isolated shape. The installer ships `pr-agent-router.yml`, which grants no
      `checks: write` and is therefore already receipt-safe; only the audited
      on-demand template needed the split. (Documented in design.md.)
- [x] Current-head verification recorded; `.trellis/audit/ledger.md` A-004 set to
      fixed only after that verification, per the parent epic rule.
      (`test/metadata.test.js` asserts the reviewer job lacks `checks`/`issues`;
      npm test 224/224, validate:metadata clean.)

## Out of Scope

- Copilot rerequest dispatch (A-001 owner).
- Broad PR-Agent adapter feature work in `07-25-integrate-pr-agent-review-adapter`.
- Changing the durable-receipt schema itself.
