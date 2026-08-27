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
- A receipt whose claimed request cannot be corroborated must not block
  re-dispatch. Recovery must not require changing the head SHA, and must not
  require deleting controller state or a direct reviewer fallback, both of which
  the review skill forbids.
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
4. After the fix, a receipt in the stalled state permits re-dispatch at an
   unchanged head, without deleting state and without a direct reviewer
   fallback.
5. A genuinely pending review is still not re-requested — the healthy
   idempotent path is proven unchanged by test.
6. PR #156 is either reviewed through the recovered lane or explicitly closed
   out, with its disposition recorded.

## Out of scope

- Merging PR #156. It stays open and unmerged until this defect is understood
  or its disposition is deliberately decided; it is the live reproduction.
- The 08-04 v2-governance clause-B decision, which #156 only records.
- The plugin version conflict (0.71.33 / 0.71.60) and the fleet pin gap
  (9 consumers at `@6ba1eff0`, 24 commits behind `main`). Both are real and both
  are unrelated.

## Open questions

- Does this reproduce on a non-bookkeeping diff? The observed case was 100%
  `.trellis/**`, which the lane classifies via `bookkeeping-paths`, and
  `allow-bookkeeping-none: false` was set. Whether that classification is
  implicated or incidental is unknown.
- Why did GitHub not add the reviewer on this PR? Still unknown, and separate
  from the verification gap. `copilot-pull-request-reviewer` reviewed #148-#153
  in this repository, so it is not blanket ineligibility. The POST did not throw
  (a throw yields `reconciliation-required`, not `observed`), so it returned a
  non-error response and added nobody. Closing the verification gap does not
  require answering this, but an audit probably should.
- Is this the same root cause as the 2026-08-26 CI-trigger gaps on
  sd-ai-command-pack PR #564, where pushes produced no run and an empty commit
  was the escape? The shapes rhyme; that was attributed to a GitHub Actions
  outage, and this one has no outage to blame.
- How many past PRs recorded a satisfied review floor without an actual review?
  Worth an audit — the failure is silent, so prior occurrences would look green.
