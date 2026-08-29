# Design: anchor a pending reviewer request to its head

## Decision

Direction **1** from the PRD, with direction **3** kept as the fallback when
the evidence cannot be read: anchor a pending request from the timeline's
`review_requested` event against the head commit's committer date, and
surface an anomaly when that comparison could not be made.

Why not 2 alone: "no push since the request" needs a push timestamp, and
GitHub exposes none. The timeline's `committed` events and the commit object
carry the committer date, which is the closest observable — and it is the same
evidence direction 1 uses, so 2 collapses into 1. Why not 3 alone: the PRD's
first requirement is that a head with no corresponding request dispatches one;
a warning does not.

## Evidence and comparison

Two reads, both only on the path that currently makes none (a pending
reviewer at a known head, no `forceRerequest`):

1. `GET /repos/{o}/{r}/issues/{n}/timeline` (paginated, 100/page) — filter
   `event === "review_requested"` whose `requested_reviewer.login` matches the
   reviewer (case-insensitive). Take the latest `created_at`.
2. `GET /repos/{o}/{r}/commits/{headSha}` — `commit.committer.date`.

| latest request vs head commit                      | reading          | action                                  |
|----------------------------------------------------|------------------|-----------------------------------------|
| `created_at >= committer.date`                     | `current-head`   | present; no POST (as today)             |
| `created_at < committer.date`                      | `stale`          | remove reviewer, request, probe landing |
| no matching event, either read throws or unreadable| `unverified`     | present; no POST; **anomaly surfaced**  |

A request made before the commit existed cannot have been for it: committer
date is a lower bound on when the commit could have been pushed, so
`created_at < committer.date` is a proof of staleness. The reverse is not a
proof of currency — a commit created locally before the request and pushed
after it reads as current — and that residual is accepted and documented; it
is strictly narrower than today's "any pending request is current".

The PR #157 timeline decides correctly: the request at `00:41:21` predates
`c5e94e0`'s commit at `00:43:06`, so the run at `c5e94e0` re-requests.

### Why `unverified` does not re-request

An unreadable pre-probe falls to a POST because a POST is cheap and its
landing is proven afterwards. Here the reviewer *is* proven present; what is
unknown is which head. Re-requesting on a transient timeline read failure would
remove and re-add a reviewer whose request may well be for this head, buying a
duplicate Copilot review for every API blip. The PRD's own fifth requirement
names the alternative: surface it so it cannot pass silently. `unverified`
therefore keeps today's behaviour and adds the anomaly.

## Contracts

### `src/github.js`

```js
async listIssueTimeline(number)   // -> event[]  (all pages, 100 per page)
getCommit(sha)                    // -> commit object
```

### `src/reviewer-dispatch.js`

```js
export const PRESENCE_REVIEWED = "reviewed-head";     // alreadyReviewed, commit_id-anchored
export const PRESENCE_CURRENT = "current-head";       // pending request anchored to this head
export const PRESENCE_STALE = "stale-request";        // pending request predates this head
export const PRESENCE_UNVERIFIED = "unverified";      // pending, anchor evidence unreadable
export const PRESENCE_ABSENT = "absent";

// every return gains
{ ..., presence: <one of the above> }
```

- `alreadyReviewed` short-circuits as today (`presence: reviewed-head`).
- `alreadyRequested && headSha`: run the comparison. `stale-request` takes the
  rerequest path (`removeRequestedReviewer`, `requestReviewer`, `probeLanding`)
  and returns `rerequested: true`, `requested: landed`. `current-head` and
  `unverified` return `landing: not-attempted`.
- `alreadyRequested && !headSha` (standalone without a head): `unverified`.
- `forceRerequest`: unchanged; its return carries `presence` for symmetry but
  the anchor reads are skipped — the caller already decided to re-request.
- Unreadable pre-probe: unchanged (`alreadyRequested` false → POST).

### `src/protocol.js`

`dispatchValue` accepts optional `presenceAnchor` ∈ {`head`, `unverified`},
valid only when `status === "already-present"`. The receipt is the durable
place a later reader — a coordinator, a human — looks, so the anomaly is
written there rather than only into a job log.

### `src/receipt.js`

`observe({ …, presenceAnchor })` writes the field when `alreadyPresent`.

### `src/operations.js`

- Passes `presenceAnchor: dispatch.presence === "unverified" ? "unverified" : "head"`
  on the `alreadyPresent` observe path.
- New output `dispatch-anomaly` (bounded string, empty when none). For an
  `unverified` presence it reads
  `pending reviewer <login> could not be anchored to head <sha>; a review for this head may never arrive`.
  The logger also emits it as a `::warning::` annotation so it appears on the
  run without opening outputs.
- `copilot-requested` is `true` on the stale-request rerequest path, as for
  any landed request.

### `action.yml`

Declares `dispatch-anomaly`; the operation contract lists it for `route`.

## Rejected alternatives

- **Compare against `pull_request.updated_at`.** Moves on comments and labels;
  a comment after the request would read a stale request as current.
- **Timeline `head_ref_force_pushed` events.** Only force pushes are recorded;
  the PR #157 case was an ordinary push.
- **Always re-request when `unverified`.** See above.

## Rollout / rollback

Two extra GET reads on one path; both retried by the client's existing read
policy. `presenceAnchor` is optional and additive. Rollback leaves receipts
carrying the field undecodable by the older action (fails closed), the same
posture as every protocol addition.

## Validation

- `test/operations.test.js`, each with `FakeGitHubClient` gaining `timeline`,
  `commitDates`, `timelineError`, `commitError`:
  - PR #157 replay: request event at `00:41:21`, head commit at `00:43:06`,
    reviewer pending → `removeRequestedReviewer` then `requestReviewer`
    called once each, `copilot-requested: true`, receipt `requested/observed`.
  - Current head: request event at or after the commit date → no POST, receipt
    `already-present/observed`, `presenceAnchor: head`, `dispatch-anomaly` empty.
  - `forceRerequest` (authorized attempt 2): call sequence identical to the
    existing test, no timeline or commit read.
  - Unreadable pre-probe: unchanged path, still POSTs, still verdict by probe.
  - Timeline read throws: no POST, receipt `already-present/observed` with
    `presenceAnchor: unverified`, `dispatch-anomaly` names reviewer and head,
    logger received a `::warning::` line.
- `test/protocol.test.js`: `presenceAnchor` rejected on any status but
  `already-present`; fixtures gain both valid values.
- `test/github.test.js`: timeline pagination stops after a short page;
  `getCommit` path.
- `test/metadata.test.js` binds the new output through the operation contract
  as it does for every other output.

## Adversarial review ledger

- **C-1** (high, addressed): first draft re-requested on `unverified`, turning
  every timeline API blip into a duplicate Copilot review. Changed to
  present-plus-anomaly; rationale recorded above.
- **C-2** (medium, addressed): committer date is not push time, so
  `created_at >= committer.date` is not a proof of currency. Documented as the
  accepted residual; the design claims only that it is strictly narrower than
  the current rule and that the stale direction is a proof.
- **C-3** (medium, addressed): the anomaly lived only in a log line, which the
  PRD's "must not depend on an operator noticing" rules out. Added
  `dispatch.presenceAnchor` to the receipt and a declared output.
- **C-4** (low, rebutted): "the timeline read costs a page per 100 events on
  long-lived PRs." It runs only when a reviewer is already pending, which is
  the path that today makes zero calls and previously wedged; the read policy
  bounds retries. Cost accepted.
