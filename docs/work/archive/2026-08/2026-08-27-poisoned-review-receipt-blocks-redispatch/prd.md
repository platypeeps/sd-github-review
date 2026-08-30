---
title: Durable review receipt records a request that never landed, then blocks re-dispatch
status: done
created: 2026-08-27
branch: task/08-27-poisoned-review-receipt
---
# Durable review receipt records a request that never landed, then blocks re-dispatch

## Goal

A durable routed-review receipt must never record `status: requested` for a
review request GitHub did not actually receive, and a receipt that claims a
request must never be able to permanently prevent the retry that would make the
claim true.

## Where this came from

Observed live on PR #156 (`chore/record-08-04-park-falsification`, head
`de440b6`), a 2-line bookkeeping change entirely under `.trellis/**`. Full
evidence in `research/pr-156-stall-evidence.md`.

The routed review lane dispatched at 18:02:15Z. Workflow run `33101443657`
completed **green**, with `request-copilot: true`,
`copilot-reviewer: copilot-pull-request-reviewer[bot]`,
`independent-review-floor: copilot`, and a final line
`Durable route observed for PR #156 at de440b6…`.

The receipt it produced records:

```
status:            requested
phase:             observed
selectedRoute:     copilot
idempotencyKey:    f8a606560dfd493c2bd3dc1416359233051dc7f05ada83d2befa93d6b35bcd6c
reason:            routine pull request within configured risk limits;
                   review floor required copilot
```

GitHub, at 20:50Z — 2h48m later — reports `reviews: []`, `reviewRequests: []`,
`comments: []`. No review-request event exists anywhere in the PR timeline. The
POST was issued and did not throw; it simply added no reviewer, and the lane
never checked.

This is not Copilot being unavailable or slow: `copilot-pull-request-reviewer`
reviewed PRs #148, #149, #150, #151, #152, and #153 in this same repository.

**That inference was wrong**, and it is kept here because it shaped the
investigation. Every one of those reviews predates the credit exhaustion, so
they say nothing about availability at the time of this observation — which was
in fact a form of unavailability. See `research/why-github-added-nobody.md`.

## Why it is self-sustaining

The receipt is keyed on head SHA plus `requestFingerprint`. Because it exists
and reads as satisfied (`requested`/`observed`), every later invocation resolves
to it and returns before dispatching. Confirmed empirically: invoking the
coordinator with `--attempt 2` returned **attempt 1's** receipt — same
`logicalDispatchId`, same `workflowUrl`, `attempt: 1` — and created no new
workflow run.

So the receipt asserts a fact about the outside world that is false, and that
same assertion is what prevents the retry that would correct it. The lane cannot
recover on its own, and no control the `sd-review` skill exposes can clear it:
the skill forbids deleting controller state and forbids a direct reviewer
fallback. Only the head SHA sits outside the receipt key, which is why an empty
commit is the only observed escape — a workaround that discards the evidence and
leaves the defect live for the next pull request.

The failure is silent in the worst way: every surface reports success. The
workflow is green, the receipt looks satisfied, the checks pass
(`route`, `test`, `sd-github-review/receipt` all SUCCESS), and the PR is
`MERGEABLE`/`CLEAN`. Only the absence of a review — which nothing alarms on —
distinguishes it from a healthy run. A required independent review floor was
configured, was reported as honored, and was silently not applied.

## Requirements

- **Divergence point is now identified** (`research/divergence-point.md`):
  `src/reviewer-dispatch.js:43` returns `requested: !alreadyPresent`, computed
  from the pre-call probe, while the `client.requestReviewer` response is
  awaited and discarded. Nothing re-probes afterwards, so a non-throwing
  response that adds no reviewer still reports success.
  `src/operations.js:449` feeds that unverified claim into `store.observe` as
  `alreadyPresent: !dispatch.requested`, producing the `observed` receipt. The
  `Durable route observed` line is `operations.js:241` rendering that state —
  a symptom, not the cause. `src/` is identical between the pinned `@6ba1eff0`
  and `main`, so this is the code that ran.
- A receipt may record `requested` only on positive evidence that GitHub
  accepted the request. Absent that evidence the dispatch is a failure and must
  be recorded as one; failing closed is required, since an unreviewed PR that
  reports a satisfied review floor is the harmful outcome.
- A receipt whose claimed request cannot be corroborated must be recorded as a
  failure and must not read as satisfied. It must not silently occupy the
  satisfied state that today blocks every retry.
  **Scope correction (adversarial review, C-8):** this must NOT be read as a
  requirement for automatic re-dispatch at an unchanged head. `receipt.js:217`
  (`mutationFailure`) sets `dispatchAllowed: false`, and `receipt.js:200-204`
  states the intent plainly — "A failed dispatch is known broken rather than
  running, so age is irrelevant to it and it always needs a human", with
  `reconciliation-required` "reserved for cases needing a human". Automatic
  recovery would contradict that deliberate decision. The deliverable is a
  correctly classified, loudly surfaced failure a human can act on, which
  `fail-on-reconciliation: true` already escalates.
- Re-dispatch recovery must stay idempotent for the healthy case: a genuinely
  delayed review must not be re-requested merely because it has not arrived yet.
  The skill's existing warning against incrementing the attempt for a delayed
  receipt stays correct and must not be weakened into a blanket retry.
- The divergence must be observable. A receipt claiming a request that no
  timeline event corroborates should surface as an anomaly rather than as a
  green run.

## Acceptance criteria

1. The exact divergence point is identified and demonstrated with a reproduction
   — a specific code path, with evidence, that produces `requested` without a
   landed request.
2. A regression test reproduces the poisoned-receipt state and fails against
   current behavior.
3. After the fix, a dispatch that does not land is recorded as failed, not
   `requested`, and the run does not report success.

   **Note, 2026-08-27.** The first implementation met the second half and missed
   the first: the run failed, but the stored receipt kept
   `dispatch.status: "requested"` at `phase: "started"`, which `receiptState`
   reads as in-flight until `strandedAfterMinutes` (default 360) elapses. The
   failure was real for one run and then read as possibly-running for six hours.
   Copilot caught it on PR #157. `ReceiptStore.dispatchFailed` now writes the
   `failed` status the store already knew how to read, and both the non-landing
   branch and the throwing `catch` path go through it.
4. After the fix, a dispatch that does not land produces a receipt that reads as
   a failure needing reconciliation — not as satisfied — so it no longer
   silently blocks the lane, and `fail-on-reconciliation: true` surfaces it.
   Automatic re-dispatch at an unchanged head is explicitly NOT claimed; see the
   scope correction above.
5. A genuinely pending review is still not re-requested — the healthy
   idempotent path is proven unchanged by test.
6. PR #156's disposition is explicitly decided and recorded. Note (adversarial
   review, C-10): the fix does **not** retroactively repair #156's existing
   receipt. That receipt is already written at head `de440b6` and still reads
   satisfied, so the coordinator will keep short-circuiting to it regardless of
   this change. #156 needs a deliberate owner decision — reconciliation, a new
   head, or closing it out — and that decision is not a deliverable of the fix.

   **Disposition, 2026-08-27.** Owner chose a fresh head: #156's two commits
   were squashed into one (`de440b6` -> `70379db`, branch diff verified
   byte-identical) and force-pushed, clearing the poisoned receipt's key. The
   lane re-dispatched and still added no reviewer, which ruled out the
   receipt as the live blocker. PR #157 — this task's own fix — behaved
   identically from a clean start, ruling out anything specific to #156.
   Root cause is the credit exhaustion recorded under Open questions.

   **Resolved 2026-08-27, after credits were restored.** #157 took the reviewer
   request immediately and received a clean Copilot review. #156 did not: five
   requests across three heads and both reviewer identities each returned HTTP
   200 with zero `review_requested` events, in the same minutes that #157 worked
   as a control. So the credit exhaustion explains the outage, not #156's own
   refusal, and why that PR specifically is unreviewable was not established
   here. The leading hypothesis — untested, and recorded as a hypothesis — is
   that Copilot declines a PR with nothing reviewable in it; #156 is a one-line
   change to a single `.trellis/**` JSON file.

   Owner then decided to merge #156 without a Copilot review. It went through
   the `sd-housekeeping` gate and merged at 2026-08-27T23:05:26Z (merge commit
   `5972e7d`). Worth recording precisely, because the framing going in was
   wrong: the gate has no review floor to waive. Its first run refused with
   `finish_work_missing`, and once a `planning`-mode finish-work receipt existed
   (`planningSubtype: journal-only-recovery`, over a journal session citing the
   work commit) it merged on green checks, zero unresolved review threads, and
   exact head agreement. No waiver was exercised and none was needed.

## Out of scope

- Merging PR #156. It was held open as the live reproduction until its
  disposition was deliberately decided. Decided and merged 2026-08-27 by owner
  decision; see AC6.
- Restoring Copilot credits on the licensing account. It is the actual remedy
  for the review lane and only the owner can do it; no change in this
  repository substitutes for it.
- The 08-04 v2-governance clause-B decision, which #156 only records.
- The plugin version conflict (0.71.33 / 0.71.60) and the fleet pin gap
  (9 consumers at `@6ba1eff0`, 24 commits behind `main`). Both are real and both
  are unrelated.

## Open questions

- Does this reproduce on a non-bookkeeping diff? The observed case was 100%
  `.trellis/**`, which the lane classifies via `bookkeeping-paths`, and
  `allow-bookkeeping-none: false` was set. Whether that classification is
  implicated or incidental is unknown.
- ~~Why did GitHub not add the reviewer on this PR?~~ **Answered 2026-08-27:
  the personal Copilot seat licensing these repositories hit its credit
  limit.** While credits are exhausted GitHub accepts a reviewer request and
  adds nobody. A direct `POST .../requested_reviewers` returns HTTP 200 with an
  empty `requested_reviewers`, with this action's code entirely out of the
  path, for both `copilot-pull-request-reviewer[bot]` and `Copilot`. Not
  specific to #156, to a head, or to a diff shape.

  Confirmed by restoration: credits returned the same day, and #157 took the
  request and was reviewed within a minute. The answer holds for the outage.
  It does not cover #156, which stayed unreviewable after the restore; see AC6.

  An interim version of this answer named the organization's zero Copilot seat
  count as the cause. It is not: that is the normal state for a personally
  licensed user and was equally true while reviews were landing on 08-25 and
  08-26. See `research/why-github-added-nobody.md`, which also corrects the
  "transient" framing in `research/divergence-point.md` and the "exactly one
  instance" conclusion in `research/blast-radius-audit.md`.
- Is this the same root cause as the 2026-08-26 CI-trigger gaps on
  sd-ai-command-pack PR #564, where pushes produced no run and an empty commit
  was the escape? The shapes rhyme; that was attributed to a GitHub Actions
  outage, and this one has no outage to blame.
- How many past PRs recorded a satisfied review floor without an actual review?
  Worth an audit — the failure is silent, so prior occurrences would look green.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/08-27-poisoned-review-receipt-blocks-redispatch`:

- research/blast-radius-audit.md
- research/divergence-point.md
- research/pr-156-stall-evidence.md
- research/why-github-added-nobody.md
