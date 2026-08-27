# Design: verify the reviewer request landed

## Boundary

One function changes behavior: `requestCopilotReviewer` in
`src/reviewer-dispatch.js`. Its callers — `src/index.js:266` (standalone) and
`src/operations.js:442` (durable) — keep their current shape. The receipt store,
the routing decision, the idempotency key, and the coordinator are untouched.

This is deliberate. The defect is that one function reports an outcome it never
checked; the smallest correct fix is to make it check. Widening the change into
receipt-store or coordinator recovery semantics would couple this fix to the
`sd-review` skill's state rules, which forbid deleting controller state, and to
the receipt store's deliberate human-in-the-loop contract. Recording the failure
correctly is the whole of this change; recovering from it is a separate question
kept out of scope on purpose (see "What this actually recovers").

## Current contract

```js
if (!alreadyPresent) {
  await client.requestReviewer(pullRequestNumber, reviewer);
}
return { alreadyRequested, alreadyReviewed, alreadyPresent,
         requested: !alreadyPresent, rerequested: false };
```

`requested` is a restatement of the pre-call probe. The POST's response is
discarded and no post-state is read, so the return value carries no information
about whether the request landed.

## New contract

`requested: true` means, and may only mean: **the reviewer was observed present
after the call**. Concretely — re-probe `getRequestedReviewers` once after the
POST, and derive `requested` from that observation instead of from
`!alreadyPresent`.

Four outcomes, all explicit, carried on a new `landing` field:

| post-probe | meaning | `requested` | `landing` |
|---|---|---|---|
| no POST was needed | reviewer already present | `false` | `not-attempted` |
| reviewer present | request landed | `true` | `confirmed` |
| reviewer absent | POST returned 2xx and added nobody | `false` | `absent` |
| probe itself failed | unknown, do not guess | `false` | `unverified` |

The distinction between `absent` and `unverified` matters: an absent reviewer is
a *known* failure, while a failed probe is *unknown* and must not be reported as
either success or a clean failure. Both are non-success, so both fail closed —
but they are recorded differently so the receipt does not overclaim in either
direction, and so a human reconciling the failure can tell "GitHub accepted the
call and added nobody" from "we could not find out".

**Deviation from the first draft, adopted during implementation.** This design
originally specified a three-state `landed: true | false | null`. That is
ambiguous: `null` would have meant both "no POST was attempted" and "a POST
happened and the probe failed" — the one case where nothing is wrong and the one
case where something might be badly wrong, sharing a value. The call site has to
tell them apart to decide between `observe` and the failure path, so `landed` was
replaced with the four-state `landing` enum above, exported from
`src/reviewer-dispatch.js` as `LANDING_NOT_ATTEMPTED`, `LANDING_CONFIRMED`,
`LANDING_ABSENT`, and `LANDING_UNVERIFIED`. Same contract, one more state, no
overloaded null.

Callers must be able to tell "already there, nothing to do" from "we asked and it
worked". `alreadyPresent` already carries the first, so the existing fields stay;
`landing` is added rather than overloading `requested`.

## What this actually recovers, and what it does not

`src/operations.js:449` currently passes `alreadyPresent: !dispatch.requested`
into `store.observe`, which is what mints the satisfied receipt. With `requested`
now false on a non-landed request, that call must instead take the failure path —
the same one the existing `catch` block uses for a throwing `requestReviewer`,
producing `reconciliation-required` rather than `observed`.

**This makes the failure loud. It does not make it self-healing**, and an earlier
draft of this design claimed otherwise. `receipt.js:217` (`mutationFailure`) sets
`dispatchAllowed: false`, and `receipt.js:200-204` records the reasoning: "A
failed dispatch is known broken rather than running, so age is irrelevant to it
and it always needs a human", with `reconciliation-required` "reserved for cases
needing a human". Automatic re-dispatch would contradict that deliberate
decision, so this design does not attempt it.

The real improvement is therefore a change of failure *class*, which is worth
having on its own:

| | before | after |
|---|---|---|
| receipt state | `observed` (satisfied) | `reconciliation-required` |
| run result | green | fails, via `fail-on-reconciliation: true` |
| operator sees | nothing | an escalated, correctly-named failure |
| review floor | silently unapplied | visibly unmet |

A silent false success becomes a loud, correctly classified failure a human can
act on. That is the whole deliverable. Whether the lane should additionally
self-recover at an unchanged head is a separate question that touches the receipt
store's human-in-the-loop contract, and it needs its own decision rather than
being smuggled in here.

Note this also means the fix does not repair PR #156. Its receipt was already
written at `de440b6` and already read satisfied; nothing in this change rewrites
an existing receipt, so #156 needed its own disposition. It got one: merged
without a Copilot review on 2026-08-27 by owner decision. See `prd.md`, AC6.

## Why the healthy idempotent path is unaffected

The pending-review case never reaches the new probe: if Copilot is already a
requested reviewer, `alreadyPresent` is true, the POST is skipped, and the
function returns as it does today. A genuinely slow review is `alreadyRequested`,
so nothing re-requests it. This is what keeps the skill's warning against
retrying a merely-delayed receipt correct — the fix distinguishes *absent* from
*slow*, and only acts on absent.

## Cost

One extra GitHub API call per dispatch that actually POSTs, on a path that
already makes one or two. Nil in practice, and only on the branch that changes
state.

## Rejected alternatives

- **Trust the POST response body.** GitHub returns the pull request object; a 2xx
  that added nobody still returns a plausible body. Reading it would restate the
  same unverified claim in a new place.
- **Clear or expire poisoned receipts in the store.** Rejected *for this task*,
  not dismissed: it adds recovery semantics to a durable-state component and
  collides both with the skill's prohibition on deleting controller state and
  with the store's deliberate "always needs a human" contract
  (`receipt.js:200-204`). It is also the only thing that would recover an
  already-poisoned receipt such as #156's, so it is deferred as a real open
  question rather than as unnecessary work.
- **Re-probe with retry/backoff for eventual consistency.** Speculative. There is
  no evidence GitHub's reviewer set is eventually consistent here, and #156 stayed
  absent for hours, not milliseconds. If a single post-probe proves flaky in
  practice, add backoff then, with evidence.

## Compatibility and rollout

The return value gains a field and changes the meaning of `requested` in exactly
the case where it was previously wrong. Both call sites are in this repository.
No consumer reads this function directly — the fleet consumes the action through
`action.yml`, whose inputs and outputs are unchanged.

Note the deployment shape: all 9 fleet consumers pin `@6ba1eff0`, and `src/` is
byte-identical between that pin and `main`, so every consumer runs this defect
today. They do not pick the fix up until they are re-pinned, which is a separate
piece of work and out of scope here.

## Risk

Low, because the failure direction is the safe one: the fix turns a silent
success into a loud failure, so a mistake surfaces as a blocked review lane
rather than an unreviewed merge.

How often the changed branch is taken is not bounded here. The blast-radius
audit (`research/blast-radius-audit.md`) establishes that every merged PR in
this repository's history carries a Copilot review, so none shipped claiming a
review floor it did not receive — but per that file's own correction it counts
reviews that exist, not dispatches that landed, so it cannot say how often the
POST added nobody.
