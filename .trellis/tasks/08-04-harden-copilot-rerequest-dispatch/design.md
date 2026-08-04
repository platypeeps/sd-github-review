# Design — Harden Copilot rerequest dispatch (A-001)

## Problem

`requestCopilotReviewer` (`src/reviewer-dispatch.js:9`) treats an already-present
reviewer as a completed dispatch:

```
alreadyPresent = alreadyRequested || alreadyReviewed
if (!alreadyPresent) requestReviewer(...)
return { ..., requested: !alreadyPresent }
```

An authorized rerequest (attempt+1, `rerequest-authorized=true`) reaches this
function with `dispatchAllowed=true` from the receipt layer, but the reviewer is
already requested (pending) or has already reviewed this head, so no new review
is issued. The authorization intent is not carried into this layer.

## Approach

Carry an explicit `rerequest` intent into `requestCopilotReviewer` and, when set,
force a fresh review instead of no-oping. Keep all force logic in one place so
both dispatch call sites (`src/operations.js:395`, `src/index.js:258`) behave
identically.

### Contract change: `requestCopilotReviewer`

Add a `forceRerequest` (boolean, default false) option.

Behavior when `forceRerequest` is true:
- `alreadyReviewed` is **not** a reason to suppress — a re-review is the point.
- `alreadyRequested` (reviewer still pending): remove then re-add the reviewer to
  re-trigger, via `removeRequestedReviewer` then `requestReviewer`. GitHub does
  not re-notify a reviewer that is already in the requested set, so the
  remove+add is required to force a new review.
- when the reviewer is neither requested nor reviewed: behaves exactly as today
  (single `requestReviewer`).

Return shape gains `rerequested` (boolean) so callers/outputs can distinguish a
forced re-review from a first dispatch. `requested` stays true whenever a
`requestReviewer` POST was issued (first dispatch or forced re-add).

When `forceRerequest` is false, behavior is byte-for-byte unchanged (retains
pending-request and already-reviewed deduplication for non-rerequests).

### Client surface: `src/github.js`

Add `removeRequestedReviewer(number, reviewer)`:

```
DELETE /repos/{owner}/{repo}/pulls/{number}/requested_reviewers
body: { reviewers: [reviewer] }
```

Mirrors the existing `requestReviewer` POST. Bounded by the existing `request`
timeout/abort wrapper (A-012), no new remote-operation policy needed.

### Plumbing

The rerequest flow is durable-only: the request carries `rerequestOf` and
`rerequest-authorized` is parsed on the durable path (`src/operations.js`). Pass
`forceRerequest = Boolean(request.rerequestOf) && booleanInput("rerequest-authorized", false, env)`
into `requestCopilotReviewer` at `src/operations.js:395`.

The standalone path (`src/index.js:258`) has no rerequest concept — it dispatches
directly from an event without a durable review request or `rerequestOf` — so it
keeps the default `forceRerequest=false` and is not changed.

The durable copilot branch also passes `alreadyPresent: !dispatch.requested` to
`store.observe` (was `dispatch.alreadyPresent`), so a forced rerequest that
issued a real request is recorded as `requested`, not `already-present`. The two
are equivalent on the non-force path, so existing dedup behavior is unchanged.

`#validateRerequest` (`src/receipt.js:417`) already rejects an unauthorized
rerequest before dispatch, so `forceRerequest` is only ever true for an
authorized rerequest — the reviewer-dispatch layer does not re-authorize.

## Data flow

route/dispatch → begin (attempt-keyed identity, dispatchAllowed) →
copilot branch → requestCopilotReviewer({..., forceRerequest}) →
 if forceRerequest && alreadyRequested: removeRequestedReviewer then requestReviewer
 else existing logic → observe(alreadyPresent)

## Failure modes / edge cases

- Remove succeeds, re-add fails: surfaces as the existing dispatch error /
  reconciliation path (the POST is the same call already handled). No partial
  "removed but not re-requested" masking — a thrown error propagates.
- Race: reviewer submits a review between our getRequestedReviewers read and the
  remove — DELETE of a non-requested reviewer is a no-op/404-tolerant; treat a
  not-found remove as success and proceed to POST. (Implement.md pins the exact
  tolerance.)
- Non-rerequest replay: `forceRerequest` false → unchanged suppression. No
  regression to the existing dedup tests.

## Compatibility / rollback

- Additive option with a false default; no caller that omits it changes behavior.
- New client method is additive.
- Rollback: revert the three source files; the receipt layer is untouched.

## Out of scope

- Receipt/identity layer (already correct via attempt-keyed logicalDispatchId).
- PR-Agent / external backends (A-004 and adapter owners).
- Same-head authorization policy itself (A-015).
