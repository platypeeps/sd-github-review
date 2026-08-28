# Implement: verify the reviewer request landed

Ordered plan. Context order: this file, `design.md`, `prd.md`,
`research/divergence-point.md`, `research/blast-radius-audit.md`.

Run `node --test test/shared-service-parity.test.js test/operations.test.js`
after steps 1-3 rather than discovering breakage at the final gate.

**Naming note.** Steps 1, 2, and 4 below say `landed: true | false | null`. That
three-state field did not survive implementation — `null` conflated "no POST was
needed" with "the probe failed". It became the four-state `landing` enum
(`not-attempted` / `confirmed` / `absent` / `unverified`); see `design.md`,
"Deviation from the first draft". Read `landed: false` as `landing: absent` and
`landed: null` as `landing: unverified` throughout this file.

## Steps

1. **Write the failing regression test first** (AC2), in
   `test/shared-service-parity.test.js`. The existing `fakeClient` (`:41`) is
   already the right shape for this: its `requestReviewer` (`:53`) records the
   call and returns without mutating `requestedUsers`, and `getRequestedReviewers`
   (`:45`) returns that same unchanged array. That is exactly the
   POST-succeeds-adds-nobody case.

   Add a case asserting that after `requestCopilotReviewer` against such a
   client, the result reports `requested: false` / `landed: false`. Against
   current code it returns `requested: true` — the test fails, which is the
   point. **Verify it fails before proceeding**; a regression test that passes
   before the fix is testing nothing.

   Note the ordering dependency: step 3 changes this shared fake so its POST
   *does* land. When it does, migrate this case to the explicit
   `{ landsRequest: false }` fake step 3 introduces, so it keeps testing the
   non-landing path rather than silently becoming a duplicate of the happy path.

2. **Fix `src/reviewer-dispatch.js`.** Replace the `requested: !alreadyPresent`
   derivation (`:43`) with a post-probe, per `design.md`:

   - After `await client.requestReviewer(...)`, re-probe
     `client.getRequestedReviewers(pullRequestNumber)`.
   - `landed` = reviewer present in that post-probe.
   - `requested` = `landed`. Absent reviewer → `false`. Probe threw → `requested:
     false`, `landed: null`; do not let a probe failure masquerade as either
     outcome.
   - Leave the `alreadyPresent` short-circuit untouched: when the reviewer is
     already requested or already reviewed the head, no POST happens and no
     post-probe is needed. This is what keeps a merely-slow review from being
     re-requested (AC5).
   - `forceRerequest` (`:33-39`) posts unconditionally, so it needs the same
     post-probe rather than its current hardcoded `requested: true` (`:38`).

3. **Update the two now-wrong assertions in
   `test/shared-service-parity.test.js`.** The `dismissed` case (`:157`) and the
   `fresh` case (`:174`) both assert `requested: true` while using a fake whose
   POST does not land. Under the new contract that expectation is wrong, not the
   code.

   Fix the *fake*, not the assertion: give `fakeClient.requestReviewer` the
   landing behavior `test/operations.test.js:115` already models
   (`this.requestedUsers.push({ login: reviewer })`), so the happy-path cases
   genuinely land and keep asserting `requested: true`. Step 1's regression case
   then needs a fake that deliberately does *not* land — add a
   `{ landsRequest: false }` option rather than reverting the shared fake.

   Do not weaken these two cases to match current behavior; they are the healthy
   path and must stay green on their own terms.

4. **Fix the durable call site**, `src/operations.js:442-461`. Today it passes
   `alreadyPresent: !dispatch.requested` into `store.observe` unconditionally,
   which is what mints the satisfied receipt from an unverified claim.

   When `dispatch.requested` is false and `dispatch.alreadyPresent` is false —
   i.e. we posted and it did not land — take the failure path instead of
   `store.observe`, producing the same `reconciliation-required` result shape the
   existing `catch` block (`:464`, result shape at `:465`) already builds for a throwing
   `requestReviewer`. Reuse that shape; do not invent a second failure
   representation.

   `design.md` commits to recording a failed post-probe (`landed: null`)
   differently from an observed-absent reviewer (`landed: false`), so carry that
   distinction into the failure result rather than collapsing both to one state.
   The `error` field the catch path already sets (`:472`) is the natural carrier:
   an absent reviewer states that plainly, an unreadable probe says the outcome
   is unknown. Both fail closed; they must not read as the same fact.

   Leave the genuine `alreadyPresent` case on the `observe` path — that one is a
   real, verified presence.

5. **Add a durable-path test** in `test/operations.test.js` using its fake client
   (`FakeGitHubClient`, `:38`, with `requestedUsers` initialized at `:47`), with
   `requestReviewer` made non-landing, asserting the receipt does
   **not** reach `observed` and the operation reports failure (AC3). The fake
   currently always lands (`:115`), so this needs the same opt-out as step 3.

6. **Prove the failure is classified, not silent** (AC4 as corrected): assert the
   step-5 failure yields `state: "reconciliation-required"` with
   `reconciliationRequired: true` and `dispatchAllowed: false`, and that it is
   distinguishable from a satisfied `observed` receipt.

   Do **not** assert that a second dispatch at an unchanged head re-POSTs. An
   earlier draft of this step did; it contradicts `receipt.js:217`
   (`mutationFailure` sets `dispatchAllowed: false`) and the deliberate contract
   at `receipt.js:200-204` that a failed dispatch "always needs a human".
   Automatic recovery is explicitly out of scope — see `design.md`, "What this
   actually recovers, and what it does not".

7. **Full gate.** `npm run check:full`, which chains `npm test`,
   `npm run test:coverage`, `npm run check`, `npm run validate:metadata`, and
   `npm run validate:ci-parity`. An earlier draft of this step claimed
   `npm run check`'s syntax list omits `reviewer-dispatch.js` and recommended
   checking it by hand; that was wrong — `package.json`'s `check` script does
   include `node --check src/reviewer-dispatch.js`.

## Validation

- `node --test test/shared-service-parity.test.js` — step 1's case fails before
  step 2, passes after; the dismissed and fresh cases stay green.
- `node --test test/operations.test.js` — steps 5 and 6 green; step 6 asserts the
  failure classification, not automatic re-dispatch.
- `npm test` — full suite. Baseline re-verified on this task branch
  2026-08-27: `tests 751 / pass 751 / fail 0`. Expect 751 plus the cases added
  in steps 1, 5, and 6, with 0 failures.

Result, run 2026-08-27 after step 7: `tests 756 / pass 756 / fail 0` — the 751
baseline plus the three parity regressions (step 1) and the two durable-path
cases (steps 5 and 6). `npm run check:full` exits 0.

One test outside the planned set needed changing: `test/action.test.js:213`,
"automatic sensitive routing requests Copilot once and reports outputs",
asserted exactly one `getRequestedReviewers` call. The landing probe makes it
two. Its fake was also non-landing, so it was made stateful the same way step 3
handles the parity fake — otherwise the assertion would have been relaxed to
match a fake that reproduces the very defect under repair.

8. **Persist the failure** (added on review, AC3). The steps above classify the
   failure in memory but leave the stored receipt at
   `dispatch.status: "requested"` / `phase: "started"`, which `receiptState`
   reads as in-flight for `strandedAfterMinutes` (default 360). Add
   `ReceiptStore.dispatchFailed` in `src/receipt.js`, writing
   `status: "failed"` at `phase: "started"` — the state `receiptState`
   (`:199-209`) already treats as age-irrelevant reconciliation and that nothing
   wrote. Route both the non-landing branch and the throwing `catch` path in
   `src/operations.js` through one helper that calls it and still fails closed
   if the persist itself fails.

   Test it on the *stored* receipt, not the in-memory result: run `route`, then
   run `query` at the same head and assert `dispatch.status === "failed"` and
   `state === "reconciliation-required"` with the clock unmoved. Asserting the
   run's own outputs cannot distinguish the fixed code from the broken code.

   Result, run 2026-08-27: `tests 758 / pass 758 / fail 0`. Reverting only
   `src/receipt.js` and `src/operations.js` fails exactly the two new cases
   (33 of 35 pass in `test/operations.test.js`). `npm run check:full` exits 0.

## Rollback

No migration and no persisted-format change: a receipt written by the fixed
code is the same schema, and the only difference is which state it records.

The two edits do **not** revert independently, and an earlier version of this
section claimed they did. Step 4 imports `LANDING_ABSENT` and
`LANDING_UNVERIFIED` from `src/reviewer-dispatch.js` (`src/operations.js:13-16`),
so reverting step 2 alone removes exports that step 4 still names and the module
fails to link. Step 4 reverts alone if only the durable call site is in
question; a revert of step 2 has to take step 4 with it.

## Explicitly not in this task

- Re-pinning the 9 fleet consumers off `@6ba1eff0` so they receive the fix.
  Separate work, named in `design.md` under compatibility.
- Determining why GitHub added no reviewer on #156. Open question in `prd.md`;
  the fix is correct without it.
- Merging or unblocking PR #156. It was held as the live reproduction while
  this work ran, and an empty commit would have destroyed it. Its disposition
  was decided separately and is recorded in `prd.md`, AC6.
