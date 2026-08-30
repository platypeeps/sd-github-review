# Implement — Reuse one current-head receipt snapshot during same-head rerequests (A-015)

## Ordered checklist

1. **Add the perf-lock test first** in `test/receipt.test.js` (mirrors the
   existing rerequest test at ~567, `FakeGitHubClient` tracks `client.calls`):
   - `same-head rerequest loads the current-head snapshot once before create (A-015)`:
     1. `begin` an `explicit cheap` request → establishes a prior receipt.
     2. Build the authorized `rerequest` (attempt 2, `rerequestOf` from the prior
        receipt) as in the existing test.
     3. Reset `client.calls.length = 0` to isolate the rerequest begin.
     4. `begin` with `cheapBeginOptions({ rerequestAuthorized: true })`.
     5. Assert `client.calls.filter(([n]) => n === "listCheckRuns").length === 2`
        and `second.dispatchAllowed === true`.
   Run `node --test test/receipt.test.js` — RED pre-fix (count is 3).

2. **Apply the fix** in `src/receipt.js` (see design.md):
   - Add `#selectElectedReceipt(elected, { logicalDispatchId, correlationId })`
     (pure: the current `query` filter + multi-match throw + empty-criteria guard).
   - Rewrite `query` as `#electedRecords(...)` + `#selectElectedReceipt(...)`.
   - Change `#validateRerequest` to accept the pre-loaded `elected` and use
     `#selectElectedReceipt` instead of `this.query`.
   - In `begin`, load `preElection = await #electedRecords(request.pullRequestNumber,
     request.headSha)` once, pass `preElection.elected` to `#validateRerequest`,
     and set `existing = preElection.elected.get(request.logicalDispatchId) ?? null`
     (inlining `#recordForIdentity`; remove it if now unused).
   - Leave the post-create `#electedRecords` (line ~544) untouched.

3. **Re-run targeted**: `node --test test/receipt.test.js` — new test GREEN and
   all existing rerequest tests still pass.

4. **Full suite**: `npm test` — expect 231 baseline + 1 = 232, 0 failures. Watch
   `shared-service-parity.test.js` and `operations.test.js` for any load-count
   or behavior drift.

5. **Full gate**: `npm run check:full` — 0 failures (plus expected changed
   Trellis-task-directory WARN).

## Validation commands

```bash
node --test test/receipt.test.js
npm test
npm run check:full
```

## Review gate

- Confirm the load-count table in design.md: rerequest 3 → 2, non-rerequest
  unchanged at 2.
- Confirm `query` behavior is byte-identical (helper extraction only) and all
  rerequest rejection paths still throw the same messages.

## Rollback point

- Single-commit fix in one source file + one test. Rollback = `git revert`. No
  schema/state migration.

## Finish steps

- Set `.trellis/audit/ledger.md` A-015 → `fixed` with verification note, owner
  reassigned to `08-04-reuse-rerequest-receipt-snapshot`; add the child
  reference to the parent PRD child map.
