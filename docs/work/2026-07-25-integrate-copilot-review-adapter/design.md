# Copilot Review Adapter Design

> Re-verified against `main` @ `40df292` on 2026-08-20. Statements the shipped
> code already satisfies are marked **DELIVERED** with evidence; statements that
> assume a world that has since moved are marked **STALE** with the correction.
> Intent is unchanged. Full analysis:
> `research/2026-08-20-research.md`.

## Boundary

This child owns only the native Copilot request and bounded completion observer.
It consumes durable authorization and returns the shared acknowledgment shape;
selection, budget, aggregate assurance, and final receipt logic remain outside.

**DELIVERED (lane separation).** The native handler is already structurally
distinct from the logical cheap/deep lane: `selectedBackend`
(`src/operations.js:131-137`) maps `copilot` to the fixed `copilotBackend`
record (`src/operations.js:110-128`) and requires `kind === "external"` for
cheap/deep, and `src/protocol.js:867-873` enforces the same invariant on the
receipt.

**NOT DELIVERED (acknowledgment shape).** The Copilot path goes request →
`store.observe` directly (`src/operations.js:427-437`) and emits no
acknowledgment. `buildAdapterAcknowledgment` (`src/operations.js:242-259`) is
reachable only from the `acknowledge` operation, whose contract requires
`adapter-request` + `adapter-outcome` (`src/operation-contract.js:93-101`) —
inputs the native path never produces.

Copilot prompt behavior is explicitly `handler-managed`. The adapter rejects a
referenced PR-Agent profile and does not claim access to GitHub's native prompt,
model, or effort internals.

**STALE as written.** The v1 request and receipt carry no `promptProfile` field
at all (`src/protocol.js:340-580`), so the shipped adapter neither declares
`handler-managed` nor has anything to reject. The enforcement exists — a native
candidate must be `handler-managed` (`src/review-candidate-catalog.js:737-738`,
`src/protocol-v2.js:505-510`) and a `copilot-native` fixture candidate exists
(`fixtures/protocol/v2/review-candidate-catalog.valid.json:128-147`) — but that
code is unreachable from `src/index.js`. Reachability re-derived 2026-08-20 by
walking import edges: 9,390 of 13,136 lines under `src/` (71%) are unreachable
from the entrypoint, unchanged since 2026-08-15. Making this statement true
requires wiring some part of the v2 stack into the entrypoint first.

The request is exact-head-bound and idempotent against existing requests or a
completed same-head review.

**DELIVERED.** `requestCopilotReviewer` (`src/reviewer-dispatch.js:9-44`) probes
the requested-reviewer set, then head-commit reviews with a case-insensitive
`commit_id` match skipping `DISMISSED` (`:16-27`), and requests only when
neither shows Copilot present (`:40-42`). Receipt-level idempotency is keyed on
`logicalDispatchId` (`src/receipt.js:453,459`).

**DELIVERED (A-001, and owned elsewhere).** An authorized same-head rerequest is
distinguished from a replay: `forceRerequest`
(`src/reviewer-dispatch.js:33-39`) removes a still-pending reviewer before
re-requesting, plumbed as
`Boolean(request.rerequestOf) && rerequest-authorized`
(`src/operations.js:423-425`), gated by `#validateRerequest`
(`src/receipt.js:419-440`) and the attempt-ordering rule
(`src/protocol.js:551-553`). Audit finding A-001 is `status: fixed` under owner
`08-04-harden-copilot-rerequest-dispatch`, to which it was reassigned from this
task on 2026-08-04 (`.trellis/audit/ledger.md:4-17`). Regressions:
`test/operations.test.js:501`, `test/shared-service-parity.test.js:179-215`.

Observation correlates within a fixed window. Uncertain request or
unmatched/late completion enters reconciliation and never causes adapter-local
fallback.

**STALE — no window exists.** `grep -n "timeout\|deadline\|window"` over
`src/receipt.js src/operations.js src/protocol.js` returns nothing. Observation
is synchronous inside the same `route` job step (`src/operations.js:427-437`),
so there is no elapsed window to bound and no late-completion path to correlate
against. Delivering a real window means a second job or a scheduled re-entry;
which is intended is not recorded anywhere and is an open question.

**DELIVERED (uncertain request, head change, no fallback).** A throw from the
request or observation becomes a `reconciliation-required` result requesting
nothing further (`src/operations.js:440-450`). A head change mid-flight is
caught by `#assertLiveHead` before any mutation
(`src/receipt.js:310-317`, `:396-399`).

**NOT DELIVERED (unmatched/late completion).** Correlation IDs merge on replay
(`src/receipt.js:513-527`), but there is no reconciliation state for a
completion that matches no attempt.

## Constraint added since this design was written

`dispatch.status` — `"requested"` when the Action summoned the reviewer,
`"already-present"` when something else had (`src/receipt.js:694`) — is no
longer a write-only field. From sd-ai-command-pack **0.71.24** the coordinator
attaches `remote-evidence-not-dispatch-caused` to every terminal report produced
after remote observation when the receipt says `already-present`
(`.trellis/spec/backend/consumer-installer.md:580-635`, delivered by
`08-16-bind-copilot-review-evidence` / PR #93).

Two consequences for this design:

- **Preserve the discriminator exactly.** Changing *when* `alreadyPresent` is
  computed silently changes what every downstream report claims about
  attribution.
- **Do not add a timestamp guard.** PR #93 established that
  `submitted_at >= dispatch.startedAt` cannot discriminate here: the `main`
  ruleset's `copilot_code_review` rule requests Copilot seconds after a PR opens
  and Copilot submits well after the dispatch starts, so a timestamp guard admits
  the foreign review anyway (`consumer-installer.md:520-534`, `:600-606`). Any
  observation-window design keys off `dispatch.status`, not time.

## Rollback

**STALE.** "Restore the prior workflow version" predates installer-managed route
mode. `REVIEW_ROUTE_MODE` has been installer-managed since manifest schema 4
(`.trellis/spec/backend/consumer-installer.md:146`), a fresh install *requires*
`--route-mode` with no default, and the mode resolves from the flag, then the
active manifest's recorded value (`:153-171`). This repository's own manifest is
`schemaVersion: 4` with `configuration.routeMode: "copilot"`
(`.github/sd-github-review.json`).

Corrected rollback: move the consumer off the Copilot route through the
installer (`--route-mode`, which rewrites the manifest and the GitHub
configuration variable together), or restore the prior pinned Action release.
A hand-edited workflow is not a supported rollback — the installer's modification
guard refuses a managed file that no longer matches its recorded `sha256`.
Existing reviews and receipts remain historical evidence either way.
