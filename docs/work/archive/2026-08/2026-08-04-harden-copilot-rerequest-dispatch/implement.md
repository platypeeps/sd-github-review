# Implement — Harden Copilot rerequest dispatch (A-001)

## Ordered steps

1. **Failing test first** (`test/operations.test.js`)
   - Add: "policy-authorized Copilot rerequest issues a new native review while
     replay stays suppressed."
   - Model the realistic scenario: after attempt 1, move the reviewer from
     `client.requestedUsers` into `client.reviews` with
     `{ user: {login}, commit_id: headSha, state: "APPROVED" }` so the rerequest
     hits `alreadyReviewed`.
   - Assert: unauthorized rerequest rejected (`not authorized by repository
     policy`) and no new `requestReviewer`; authorized rerequest →
     `copilot-requested` "true", a second `requestReviewer` call, attempt 2, new
     `logicalDispatchId`.
   - Run: `node --test test/operations.test.js` → the new test FAILS (red).

2. **Client method** (`src/github.js`)
   - Add `removeRequestedReviewer(number, reviewer)` — DELETE
     `.../pulls/{number}/requested_reviewers` body `{ reviewers: [reviewer] }`.
   - Tolerate a 404/not-found remove as success (reviewer already gone).

3. **Force logic** (`src/reviewer-dispatch.js`)
   - Add `forceRerequest = false` option to `requestCopilotReviewer`.
   - When true: skip `alreadyReviewed` suppression; when `alreadyRequested`, call
     `removeRequestedReviewer` then `requestReviewer`; return `rerequested: true`
     and `requested: true` whenever a POST was issued.
   - When false: unchanged.

4. **Plumb the durable call site**
   - `src/operations.js:395`: pass
     `forceRerequest: Boolean(request.rerequestOf) && booleanInput("rerequest-authorized", false, env)`.
   - Change the same block's `store.observe` call to
     `alreadyPresent: !dispatch.requested` so a forced rerequest records as
     `requested`, not `already-present`.
   - `src/index.js:258` (standalone) carries no rerequest — left unchanged.

5. **Fake parity** (`test/operations.test.js` `FakeGitHubClient`)
   - Add `removeRequestedReviewer(number, reviewer)` removing from
     `requestedUsers`, recording the call.

6. **Green + full suite**
   - `node --test test/operations.test.js` → new test passes.
   - `npm test` (or `node --test`) whole suite → 0 failures.

7. **Verify + ledger**
   - Record current-head verification.
   - Set `.trellis/audit/ledger.md` A-001 → fixed with evidence
     (`reviewer-dispatch.js` force-rerequest + test names). Only after step 6.
   - Tick prd.md acceptance checkboxes.

## Validation commands

- `node --test test/operations.test.js`
- `npm test`
- `grep -n forceRerequest src/reviewer-dispatch.js src/operations.js src/index.js`

## Review gates

- Red-before-green confirmed at step 1.
- Whole-suite green before touching the ledger.

## Rollback points

- After step 1: `git checkout -- test/operations.test.js`.
- After code: revert `src/github.js`, `src/reviewer-dispatch.js`,
  `src/operations.js`, `src/index.js`; receipt/identity layer untouched.
