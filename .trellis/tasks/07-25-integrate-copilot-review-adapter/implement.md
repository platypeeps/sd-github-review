# Copilot Review Adapter Implementation Plan

> Re-verified against `main` @ `40df292` on 2026-08-20 (`npm test`: 647/647
> pass). Steps the shipped code already satisfies are marked **DELIVERED** with
> evidence rather than removed. Full analysis:
> `research/2026-08-20-research.md`.

1. Add authorized, handler-managed/referenced-profile, existing, completed,
   timeout, and ambiguity fixtures.

   **PARTIAL.** The v1 fixtures for existing/completed/replay/changed-head cases
   exist and are exercised (`fixtures/protocol/v1/requests.valid.json:66-74`
   "explicit copilot", driven by `test/operations.test.js:485-540` and
   `test/shared-service-parity.test.js:170-215`). A `copilot-native`
   handler-managed candidate fixture exists at
   `fixtures/protocol/v2/review-candidate-catalog.valid.json:128-147` but is only
   reachable from v2 unit tests. **Missing:** timeout and referenced-profile
   rejection fixtures for the native adapter — neither has a code path to drive.

2. Gate native request on matching durable authorization.

   **PARTIAL.** The *rerequest* gate is delivered: `#validateRerequest`
   (`src/receipt.js:419-440`) checks prior receipt identity, attempt,
   `supportsRerequest`, policy version, and route/backend match, and
   `src/operations.js:423-425` only forces a fresh request when
   `rerequestOf` is present *and* `rerequest-authorized` is set.
   **Missing:** candidate-bound authorization. The v1 request carries no
   candidate and no prompt-profile field (`src/protocol.js:340-580`), so there is
   nothing to match a durable authorization against. Blocked on making part of
   the v2 authorization stack (`src/review-plan-authorization.js:713`, `:928`,
   `:958-960`) reachable from `src/index.js` — 71% of `src/` is currently
   unreachable from the entrypoint, unchanged since 2026-08-15.

3. Implement idempotent request and exact-head completion observation.

   **DELIVERED.** Presence probe and conditional request in
   `requestCopilotReviewer` (`src/reviewer-dispatch.js:9-44`); receipt-level
   idempotency keyed on `logicalDispatchId` (`src/receipt.js:453,459`);
   exact-head observation writing the `requested` / `already-present`
   discriminator and moving `phase` to `observed`
   (`src/receipt.js:661-703`, discriminator at `:694`); head re-assertion before
   any mutation (`src/receipt.js:310-317`, `:396-399`).

4. Emit bounded `handler-managed` shared acknowledgments and reconciliation
   states.

   **NOT DELIVERED, and two distinct pieces.**

   *Acknowledgment:* the native path never builds one — it goes request →
   `store.observe` (`src/operations.js:427-437`). `buildAdapterAcknowledgment`
   (`src/operations.js:242-259`) is reachable only from the `acknowledge`
   operation, whose contract requires the external-adapter inputs
   `adapter-request` + `adapter-outcome` (`src/operation-contract.js:93-101`).
   `ACK_STATUSES` (`src/protocol.js:60`) carries no prompt-profile field.
   Delivering this means either widening the `acknowledge` contract or adding a
   native-specific operation — an open decision.

   *"Bounded":* no window exists anywhere
   (`grep -n "timeout\|deadline\|window" src/receipt.js src/operations.js src/protocol.js`
   returns nothing) because observation is synchronous in the same job step. A
   real window requires a second job or a scheduled re-entry.

   *Reconciliation states, partially delivered:* uncertain request →
   `src/operations.js:440-450`; head change → `src/receipt.js:396-399`.
   **Missing:** timeout (no window) and unmatched/late completion (correlation
   IDs merge on replay at `src/receipt.js:513-527`, but no state exists for a
   completion matching no attempt).

5. Add permissions, logging, replay, and rollback documentation.

   **PARTIAL.** Permissions are declared per operation in the authoritative
   contract (`src/operation-contract.js:26-129`; `acknowledge` is
   `permissions: {}` at `:101`), and the shipped durable workflow already
   isolates credentials — the `review` job's only credential is
   `github-token: ${{ github.token }}` (`examples/sd-review.yml:59`, in the
   `with:` block at `:58-67`; its `permissions` are `:43-47`), while every
   `*__KEY` provider secret is scoped to the `pr-agent` job (`:121-133`). The
   job also reads two `vars.SD_REVIEW_*` backend descriptors (`:62-63`), which
   are configuration, not credentials. **Missing:** replay and rollback
   documentation rewritten against installer-managed route mode
   (`.trellis/spec/backend/consumer-installer.md:146,153-171`) — the original
   "restore the prior workflow version" rollback is no longer accurate; see
   `design.md`.

## Validation

Original: validate no duplicate request, exact-head isolation, changed-head
behavior, observer deadline, and absence of management secrets.

**DELIVERED:** no-duplicate-request, exact-head isolation, and changed-head
behavior are covered by `test/operations.test.js:485-540` and
`test/shared-service-parity.test.js:170-215` (the A-001 regressions), green in
the 647-test suite.

**NOT COVERED:** observer deadline (nothing to test — no deadline exists) and
absence of management secrets on the Copilot lane. The secret boundary is
structurally correct but has **zero test coverage** for this lane. The repo's
only substantive secret-boundary assertion is `test/metadata.test.js:281-289`,
which pins the per-provider `secrets.PR_AGENT_MODEL_API_KEY` expression and the
`--env NAME` form on the **PR-Agent** step; nothing asserts that the `review`
job's inputs and outputs carry no `*__KEY`. This is the one acceptance criterion
with no v2 dependency and no coverage, and is the cheapest remaining item to
close.

> **Corrected 2026-08-20 (adversarial review, C-5).** This paragraph previously
> cited `grep -rn "secret" test/*.js` as hitting "only
> `test/consumer-installer.test.js`". At `40df292` that grep matches 13 test
> files, `test/metadata.test.js` among them. The conclusion survives — the
> matching assertion is on the PR-Agent lane, not the Copilot lane — but the
> stated evidence did not, and would have looked falsified to anyone re-running
> it. The same wrong grep result appears at `research/2026-08-20-research.md:149`.

## Note on PRD acceptance criterion 1 (A-001)

The replay-versus-authorized-rerequest clause is closed and owned elsewhere.
`.trellis/audit/ledger.md:4-17` records A-001 as `status: fixed` under
`08-04-harden-copilot-rerequest-dispatch`, explicitly reassigned away from this
task on 2026-08-04, with the two regression tests named above. Leaving it as an
open acceptance criterion here overstates the remaining work; it should be
struck or restated as a regression guard before implementation starts.

## Constraint added since this plan was written

`dispatch.status` is now consumed downstream. From sd-ai-command-pack 0.71.24
the coordinator attaches `remote-evidence-not-dispatch-caused` to terminal
reports when the receipt says `already-present`
(`.trellis/spec/backend/consumer-installer.md:580-635`; PR #93). Any change to
*when* `alreadyPresent` is computed changes what every downstream report claims
about attribution, so it must be preserved exactly. Do not add a
`submitted_at`-based guard — PR #93 established it cannot discriminate here
(`consumer-installer.md:600-606`).
