# Give the receipt a terminal state for a backend that declined the pull request

## Goal

A receipt can say a dispatch failed. It cannot say the backend looked at the
pull request and refused it. Both land in `failed`, so an operator reading a
blocked lane cannot tell a transport error from a reviewer that will never
accept this pull request no matter how many times it is retried.

## Context

Tracked upstream as platypeeps/sd-github-review#154, now narrowed. The issue
originally reported that a receipt claimed `dispatch.status: "requested"` for a
Copilot review GitHub had no record of — `se-ai-command-pack` PR #274, head
`037d613`, run 33066759070 `success` in 15s against zero `review_requested`
timeline events.

PR #157 (merged `b309830`) closed the first two of the three suggested fixes:
`requestCopilotReviewer` now derives `requested` from a post-POST re-read rather
than from intent, and a non-landing POST writes `dispatch.status: "failed"` at
`dispatch.phase: "started"`, which `receiptState` maps to
`reconciliation-required` regardless of age. The merge-visible symptom is gone.

The third is untouched. At `src/protocol.js:62`:

```js
const DISPATCH_STATUSES = new Set(["requested", "already-present", "skipped", "failed"]);
```

There is no `declined`. A backend refusal — the issue's lead is GitHub's own
size limits on Copilot review, reported but never confirmed — is now recorded as
`failed`: correct in that it blocks the remote gate, uninformative in that it
reads the same as a network error. The next occurrence is as opaque as the
first.

**Unconfirmed:** whether GitHub's size limit was in fact the trigger on PR #274.
The lead is recorded in the issue and was never verified. This task does not
depend on it — the receipt should distinguish a decline from a failure whatever
produced the decline — but do not write the size limit into the design as an
established cause.

## Requirements

- A backend that accepts the request and refuses the pull request must reach a
  terminal receipt state distinct from both `requested` and `failed`.
- That state must block the remote gate, exactly as `failed` does now. This is a
  legibility change, not a relaxation.
- The distinction must be derived from something observable. If the API response
  cannot be told apart from a transport failure, say so and record what would be
  needed rather than inferring a decline from a heuristic such as diff size.
- A decline must carry enough detail for an operator to read it as the specific
  refusal it was.

## Non-goals

- Re-opening items 1 and 2 of the original issue. Both shipped in PR #157 and
  the post-POST probe stays as it is.
- Making the lane retry or route around a decline. Naming the state is this
  task; deciding what a caller does with it is not.

## Acceptance Criteria

- [ ] `DISPATCH_STATUSES` carries a decline state, and `receiptState` maps it to
      a gate-blocking outcome.
- [ ] A declined dispatch and a transport failure produce different receipts,
      proven by a test over both paths.
- [ ] The decline receipt names the reason the backend gave.
- [ ] A test asserts the decline state does not open the remote gate.
- [ ] Issue #154 is closed by the change.
