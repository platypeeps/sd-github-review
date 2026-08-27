# Divergence point: `requested` is derived from the pre-state probe, never verified

Confirmed by reading the source at `main`. `src/` is byte-identical between the
pinned action `@6ba1eff0` and `main` (`git diff 6ba1eff0..main -- src/` is
empty), so the code that ran on PR #156 is the code below.

## The claim is computed before the call, from the wrong thing

`src/reviewer-dispatch.js:40-43`:

```js
if (!alreadyPresent) {
  await client.requestReviewer(pullRequestNumber, reviewer);
}
return { alreadyRequested, alreadyReviewed, alreadyPresent, requested: !alreadyPresent, rerequested: false };
```

`requested` is `!alreadyPresent` — a fact about the state **before** the POST.
The POST's own result is awaited and then discarded. `src/github.js:401-406`
returns the response body, so the information is available and simply unused:

```js
requestReviewer(number, reviewer) {
  return this.request(`/repos/${this.owner}/${this.repo}/pulls/${number}/requested_reviewers`, {
    method: "POST",
    body: { reviewers: [reviewer] },
  });
}
```

Nothing re-probes `requested_reviewers` afterwards. So any outcome where GitHub
returns a non-throwing response without actually adding the reviewer yields
`requested: true` — a claim with no evidence behind it.

## How that becomes a durable lie

`src/operations.js:449-461` feeds the unverified claim straight into the receipt,
inverted:

```js
alreadyPresent: !dispatch.requested,
...
result = await store.observe({ ... });
```

`store.observe` moves the receipt to `observed`, which `src/operations.js:241`
renders as the log line seen on the run:

```js
`Durable ${details.operation} ${details.result.state} for PR #${receipt.pullRequestNumber} at ${receipt.headSha}`
```

→ `Durable route observed for PR #156 at de440b6…`, and a receipt reading
`status: requested`, `phase: observed`. The run is green because nothing in this
path can fail: the only failure branch is the `catch`, which requires
`requestReviewer` to throw. A 2xx that adds nobody takes the success path.

## Why the retry cannot fix it

The receipt is keyed on head SHA + `requestFingerprint`. Once it reads satisfied,
the coordinator resolves to it and returns before re-entering the action, so the
probe that would notice the reviewer is still absent never runs again. Verified
empirically: `--attempt 2` returned attempt 1's receipt (same
`logicalDispatchId`, same `workflowUrl`, `attempt: 1`) and created no new run.

The verification gap is what converts a GitHub behavior into a silent one.

**Correction, 2026-08-27.** An earlier version of this paragraph called that
behavior *transient* and claimed "the next attempt would re-probe, find the
reviewer absent, and re-POST." Both are wrong. The behavior was the steady
state for as long as the licensing account's Copilot credits were exhausted,
and a re-POST at a fresh head was tried and changed nothing. See `why-github-added-nobody.md`. The gap
is still real and still worth closing — it is what makes a permanent condition
look green — but it is not the difference between recovering and stalling.

## What is confirmed vs still unknown

**Confirmed:** `requested: true` can be, and on PR #156 was, reported without any
positive evidence that GitHub accepted the request. This is structural and
head-independent.

**Not confirmed:** *why* GitHub did not add the reviewer on this particular PR.
`copilot-pull-request-reviewer` reviewed PRs #148-#153 in this same repository,
so it is not a blanket ineligibility. The POST did not throw — a throw would have
produced `reconciliation-required`, not `observed` — so it returned a
non-error response and added nobody. Determining that cause is separate from,
and not a prerequisite for, closing the verification gap.
