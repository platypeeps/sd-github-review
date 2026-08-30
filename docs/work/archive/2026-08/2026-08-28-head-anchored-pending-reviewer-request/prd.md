---
title: Anchor a pending reviewer request to the head it was made for
status: done
created: 2026-08-28
branch: task/08-28-review-dispatch-fixes
---
# Anchor a pending reviewer request to the head it was made for

## Goal

`requestCopilotReviewer` treats any pending reviewer request as presence,
whatever head it was made for. When the head moves while a request is still
outstanding, the run at the new head short-circuits, writes a satisfied receipt,
and the lane then waits forever for an exact-head review nobody ever asked for.

## Context

Tracked upstream as platypeeps/sd-github-review#158. Observed live on this
repository's own PR #157, while shipping the fix for the sibling receipt defect.

Timeline (UTC):

- `00:41:08` — `d594433` pushed
- `00:41:21` — `review_requested` Copilot, for `d594433`
- `00:43:06` — `c5e94e0` pushed; Copilot's request still outstanding
- `00:44:21–24` — router runs at `c5e94e0`, sees Copilot in
  `requested_reviewers`, issues **no POST**, logs a durable route as observed
- `00:44:28` — Copilot submits its review with `commit_id: d594433`, and drops
  off `requested_reviewers`

The issue timeline carries no `review_requested` event for `c5e94e0`; the last
one is `00:41:21`. The receipt written at `c5e94e0` nonetheless reads
`status: requested`, `phase: observed`, `attempt: 1`.

### Divergence point

`src/reviewer-dispatch.js:67-78` at current `main` — the issue cites `:43-55`,
which moved when PR #157 landed. The defect is unchanged by that PR:

```js
const alreadyRequested = Boolean(requested?.users?.some((user) => sameLogin(user?.login, reviewer)));
const alreadyReviewed = Boolean(
  !alreadyRequested && headSha
    && (await client.listPullRequestReviews(pullRequestNumber)).some(
      (review) => sameLogin(review.user?.login, reviewer)
        && review.commit_id?.toLowerCase() === headSha.toLowerCase()
        && review.state !== "DISMISSED",
    ),
);
const alreadyPresent = alreadyRequested || alreadyReviewed;
```

`alreadyReviewed` is head-anchored on `commit_id === headSha`, correctly.
`alreadyRequested` is not, and cannot be from this data alone: a pending
reviewer request carries no commit anchor in the requested-reviewers payload. So
a request made for any earlier head satisfies presence at every later one, and
`if (!alreadyPresent)` at `:99` skips the POST.

### Why it is self-sustaining

The receipt at the new head reads satisfied, so every later invocation resolves
to it and returns before dispatching. The review that request actually produced
is anchored to the previous commit, so no exact-head review will ever arrive to
match it. Nothing alarms: workflow green, receipt satisfied, checks passing, PR
`MERGEABLE`/`CLEAN`.

This is distinct from the defect PR #157 fixed, and that fix does not reach it.
There, the POST was issued and added nobody, and `requested` was derived from
the pre-call probe. Here no POST is issued at all — correctly, the reviewer *is*
present — but presence belonging to a different head is read as coverage of this
one. `landing` is only computed on a path that performs a POST; the
`alreadyPresent` short-circuit returns `landing: not-attempted` and never
reaches it.

### Escapes

Only the head SHA sits outside the receipt key, so an empty commit escapes —
discarding evidence while leaving the defect live for the next pull request. The
sanctioned control is an authorized rerequest (`attempt: 2` with `rerequestOf`
and `rerequest-authorized: true`), which removes and re-adds the reviewer. That
works, but requires a human to notice that a green pull request is silently
unreviewed at its head.

## Requirements

- Presence from a pending request must be established for the head under
  review, not inherited from an earlier one.
- A head that has no corresponding request must dispatch one rather than
  short-circuit.
- Preserve the `forceRerequest` path's behavior, including removing a pending
  reviewer before re-adding so GitHub re-notifies.
- Preserve the fail-closed reading of an unreadable pre-probe: unreadable means
  "not known to be present", the POST still happens, and `probeLanding` renders
  the verdict.
- Detection must not depend on an operator noticing. No receipt may reach
  `observed` through `alreadyPresent` on the strength of a pending request
  whose head is unproven. (Amended during review: the first draft asked for
  such a receipt to be written and flagged as an anomaly; a satisfied receipt
  the gate reads as `existing` is not a detectable anomaly, so the case is
  removed rather than flagged.)

## Non-goals

- Re-opening the PR #157 fix. The post-POST landing probe stays as it is.
- The empty-commit workaround. Removing the need for it is the point; blocking
  it is not.

## Design question (resolved)

Resolved during review — see `design.md`. All three directions below were
rejected: 1 and 2 depend on commit timestamps, which are committer-written and
prove nothing in either direction; 3 leaves the gate passing on an unproven
head. The shipped rule is record-based: the durable path re-requests any
pending request it holds no receipt for at the head. Recorded for history:

Three directions were recorded on the issue, none validated:

1. Anchor the pending request from the timeline's `review_requested`
   `created_at`, compared against the head commit's timestamp. Costs an extra
   API call on a path that currently makes none.
2. Treat `alreadyRequested` as presence only when no push has occurred since the
   request, and otherwise force a rerequest.
3. At minimum, surface the anomaly without changing dispatch behavior.

1 and 2 need the same evidence and differ mainly in where the comparison lives.
3 is strictly weaker but independently worth having. (Decision and rejection
reasons are above and in `design.md`.)

## Acceptance Criteria

- [x] A pending request made for an earlier head does not satisfy presence at a
      later head, proven by a test reproducing the PR #157 timeline.
- [x] A review already anchored to the current head by `commit_id` still
      satisfies presence, with no duplicate POST. (Amended during review: a
      *pending* request cannot be proven to be for the current head from any
      server-observed evidence, so the durable path re-requests it once rather
      than inherit it; see `design.md`.)
- [x] The `forceRerequest` path is unchanged, proven by a test.
- [x] An unreadable pre-probe still takes the fail-closed path.
- [x] No receipt reaches `observed` via `alreadyPresent` on the strength of a
      pending request at a head with no matching `review_requested` event.
      (Amended during review: the durable path no longer has that case, so
      there is no anomaly to surface; the receipt records a proven request.)
- [x] Issue #158 is closed by the change.
