# Design: a pending reviewer request is never inherited across heads

## Decision

A pending reviewer request cannot be anchored to a head from anything GitHub
exposes, so the durable path stops trying to and uses the evidence it already
owns: its receipts. `route` dispatches only when `store.begin` finds no
receipt for the head. Any reviewer request found pending at that moment was
therefore not made by this action at this head — it belongs to an earlier
head, or someone else made it — and it is removed and re-requested so GitHub
notifies for this head. The receipt then records a request this run proved
landed (`requested`/`observed` via `probeLanding`), never an inherited
presence.

A review is still head-anchored by its `commit_id` and still short-circuits.

### Why not commit timestamps (the first draft)

The first draft compared the timeline's latest `review_requested`
`created_at` against `commit.committer.date` and treated "request before
commit" as a proof of staleness. Two independent review lanes rejected it,
correctly: author and committer dates are written by the committer, not
observed by the server. A backdated commit makes an old request read as
current — the exact bypass the task exists to close — and a future-dated one
makes a current request read as stale. Neither direction is a proof. The PRD's
directions 1 and 2 both need that evidence and fall with it.

### Why not `unverified` plus an anomaly (direction 3)

The first draft also kept the presence when the evidence could not be read,
wrote `presenceAnchor: unverified` on the receipt, and emitted a
`dispatch-anomaly` output. Review pointed out the receipt was still
`already-present`/`observed`, which `receiptState` reads as `existing`: the
gate passed on an unproven head and only a reader who looked for the field
would know. With the record-based rule there is no unproven-head case left in
the durable path, so the field, the output, and the timeline/commit reads are
removed rather than hardened.

## Cost

At most one extra Copilot review per head, and only when the reviewer was
already requested at this head by someone else before the action ran. The
first draft's concern — a duplicate review per transient API failure — does
not arise: the rule reads no extra evidence and is deterministic per head.

## Contracts

### `src/reviewer-dispatch.js`

```js
export const PRESENCE_ABSENT = "absent";               // probe readable, nobody present
export const PRESENCE_REVIEWED = "reviewed-head";      // review with commit_id === head
export const PRESENCE_UNANCHORED = "unanchored-request"; // pending request, head unknown
export const PRESENCE_UNVERIFIED = "unverified";       // pre-probe unreadable

requestCopilotReviewer({ ..., rerequestPending = false })
// every return gains `presence`
```

- `rerequestPending` is the caller's statement that it holds no record of a
  request for this head. With it, `alreadyRequested` takes the remove +
  request + probe path (`rerequested: landed`, `requested: landed`).
- Without it (standalone, or no head), a pending request keeps its presence
  and returns `landing: not-attempted`, `presence: unanchored-request`.
- `forceRerequest` unchanged.
- Unreadable pre-probe: unchanged path (POST, probe decides), but
  `presence: unverified` rather than `absent` — absence is a positive claim
  the probe could not make.

### `src/operations.js`

The durable Copilot dispatch passes `rerequestPending: true`. No new output;
`copilot-requested` is `true` on the re-request path as for any landed
request.

### Removed from the first draft

`GitHubClient.listIssueTimeline`, `GitHubClient.getCommit`,
`dispatch.presenceAnchor`, the `dispatch-anomaly` output, the `::warning::`
annotation, and their fixtures and tests.

## Validation

- `test/operations.test.js`: PR #157 replay — reviewer pending at a head with
  no receipt → `removeRequestedReviewer` then `requestReviewer` once each,
  receipt `requested/observed`, `copilot-requested: true`, no timeline or
  commit read; a replay at the same head reads `existing` with no further
  POST. An exact-head review still short-circuits with no POST.
- `test/shared-service-parity.test.js`: `rerequestPending` re-requests a
  pending reviewer; an exact-head review is never re-requested on that
  ground; without the flag the presence is kept and reported
  `unanchored-request`; unreadable pre-probe reports `presence: unverified`.
- `forceRerequest` test unchanged.

## Adversarial review ledger

- **C-1** (high, addressed): first draft re-requested on `unverified`
  anchor evidence. Superseded — no anchor evidence is read.
- **C-2** (high, addressed — review lanes codex + gito): committer date is
  client-controlled; neither direction of the comparison is a proof. Replaced
  by the record-based rule above.
- **C-3** (high, addressed — review lane codex): an unverified anchor was
  persisted as a satisfying `already-present` receipt. Removed with the
  anchor; the durable path now has no unproven-head case.
- **C-4** (high, addressed — review lane gito): an unreadable pre-probe was
  reported `presence: absent`. Now `unverified`.
- **C-5** (medium, accepted): a reviewer requested at this head by a human
  before the action runs is re-requested once. Cost recorded above.
