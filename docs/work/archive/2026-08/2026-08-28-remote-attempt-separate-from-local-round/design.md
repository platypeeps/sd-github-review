# Design: `request.attempt` is the remote dispatch counter

## Ownership split

The defect has two halves in two repositories:

- **Coordinator (sd-ai-command-pack, `sd-ai-command-pack-review.py`)** derives
  `request.attempt` from its stored per-head local round state. That is where
  the local round counter leaks into the remote field, and only that code can
  stop forwarding it, populate `rerequestOf` from the prior *remote* attempt,
  and make recovery not need `--attempt-id`. Tracked there as
  platypeeps/sd-ai-command-pack#589.
- **This action** owns the field's meaning and the rejection. It can make the
  contract unambiguous — one shape, documented — and make the rejection name
  the counter that is wrong, so the next operator who hits it is sent to the
  coordinator's counter rather than to re-request handling.

This task delivers the action half. The PRD's acceptance criteria are split
accordingly; the coordinator half is parked on #589 and issue #155 stays open
until it lands.

## Shape decision

**Unified field, remote semantics.** `request.attempt` is, and stays, the
number of dispatches to the routed backend for this exact head: `1` on the
first dispatch regardless of local rounds, `n+1` only for an authorized
same-head re-request of remote attempt `n`. No `localRounds` field is added:
the action would carry it nowhere, and adding a field to the request moves the
fingerprint for every consumer for no gate the action can enforce.

The PRD's third requirement ("pick one shape; do not leave the field
ambiguous") is met by writing that semantics down where the contract lives —
`src/protocol.js` beside the guard, `DESIGN.md`'s durable-identity paragraph,
and the `review-request` input description in `action.yml` — rather than by
a schema change.

## Rejection message

Before:

```
request.attempt above 1 requires request.rerequestOf identifying the prior attempt
```

After:

```
request.attempt is the remote dispatch counter for this head and must be 1 on the first dispatch; 6 without request.rerequestOf claims a same-head re-request of remote attempt 5 that was never made. Local review rounds must not be forwarded as request.attempt.
```

The message names the counter, states its rule, and says what the caller's
value would have to mean to be valid. The `rerequestOf`-vs-`priorAttempt`
mismatch message is unchanged: it fires only when a `rerequestOf` *is* present
and is about re-request handling.

## Contracts

`src/protocol.js` `normalizeReviewRequest`: guard unchanged, message replaced,
comment extended with the counter semantics and the #155 shape.

`action.yml` `review-request` description gains one sentence: `attempt` counts
remote dispatches for the head, not local review rounds.

`DESIGN.md` durable-identity paragraph gains the same sentence.

## Validation

- `test/protocol.test.js`: attempt `6` without `rerequestOf` is rejected with
  a message matching `/remote dispatch counter/u` and `/must be 1 on the first
  dispatch/u` and not matching `/identifying the prior attempt/u`; attempt `2`
  with a matching `rerequestOf` still decodes; the fixtures' existing
  invalid-request entry for this case updates its expected message.
- `test/metadata.test.js` already reads `action.yml` descriptions; no new
  binding is needed for a prose sentence.

## Adversarial review ledger

- **C-1** (high, parked → #589): the counter fix is not in this repository.
  Parked with owner and trigger recorded in the PRD; blocks *closing #155*,
  not implementing this task's half.
- **C-2** (medium, rebutted): "accept `attempt > 1` without `rerequestOf`
  when no prior receipt exists for the head, since the action can see the
  store." The guard exists because a bare bump mints a fresh identity and
  skips the whole rerequest authorization chain (comment at
  `src/protocol.js:558-567`); relaxing it on store state re-opens that bypass
  for anyone who can dispatch the workflow. The PRD's non-goal agrees.
- **C-3** (low, addressed): the first draft of the message still ended with
  "identifying the prior attempt", which is the phrase that misdirected the
  operator. Removed.
