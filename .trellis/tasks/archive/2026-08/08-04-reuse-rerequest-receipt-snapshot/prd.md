# Reuse one current-head receipt snapshot during same-head rerequests (A-015)

## Goal

Close audit finding A-015 so a same-head rerequest `begin` loads the current-head
elected receipt set once before create instead of twice — cutting one full
`listCheckRuns` pagination round-trip per authorized rerequest.

## Audit Finding

- ID: A-015 · severity P2 · effort S · confidence Plausible · dimension performance
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: Same-head rerequests load the same receipt set twice. Rerequests
  duplicate Check Run latency and quota use.

## Evidence Boundary

In `src/receipt.js`, `begin` for a rerequest performs two pre-create loads of the
same `(pullRequestNumber, headSha)` elected set:

- `#validateRerequest` (current line 420) calls `this.query({...})`, which loads
  `#electedRecords(pullRequestNumber, headSha)`.
- `#recordForIdentity` (current line 381), called from `begin` (line 510),
  loads `#electedRecords(pullRequestNumber, headSha)` again.

Both call `#electedRecords` → `#records` → `client.listCheckRuns(headSha, ...)`
for the identical current head. A third load after `createCheckRun` (line 544)
is a genuinely separate post-mutation reread and is out of scope.

Confirmed on main @ HEAD (2026-08-04): an authorized rerequest `begin` issues
three `listCheckRuns` calls (validate, identity, post-create); a non-rerequest
`begin` issues two (identity, post-create).

## Requirements

- An authorized same-head rerequest `begin` MUST load the current-head elected
  receipt set at most once before `createCheckRun`, shared by rerequest
  validation and identity lookup.
- The post-create reread (observing the newly created Check Run) is unchanged.
- All rerequest validation semantics are unchanged: unauthorized rerequests,
  prior-identity/attempt/policy/route/backend mismatches, and multi-match
  detection still reject exactly as today.
- Non-rerequest `begin`, `query`, `acknowledge`, and finalize load behavior are
  unchanged.

## Acceptance Criteria

- [x] A test proves: an authorized same-head rerequest `begin` issues exactly two
      `listCheckRuns` calls (one pre-create snapshot + one post-create reread),
      down from three. (`test/receipt.test.js` A-015 test.)
- [x] Existing rerequest tests (authorization required, unsupported backend,
      identity/attempt/policy mismatches) still pass unchanged. (receipt.test.js
      17/17.)
- [x] Full suite green (baseline 231/231 → 232/232 with the new test).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-015 set to fixed after verification; owner
      reassigned to this dedicated child.

## Out of Scope

- The post-`createCheckRun` reread (line 544) — required to observe the new
  record and elect the authoritative one.
- `query`/`acknowledge`/finalize load paths beyond the shared helper extraction.
