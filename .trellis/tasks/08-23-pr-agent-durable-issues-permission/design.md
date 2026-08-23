# Design — drop the dead `issues: write` grant and gate the drift

## The seam that made the original D1 gate impossible, and why it is possible now

`scripts/validate-action-metadata.mjs` already has two permission gates:

- `assertSetupContract` (line 386) pins `requiredPermissions` to the union over
  `supportedOperations`. **Set equality**, both directions. This is the gate
  that rejected D1's reported fix.
- `assertJobPermissions` (line 465) is a **lower bound only**, and says so:

  > No upper bound — jobs hold extra permissions for comment/side-effect and
  > non-Action steps.

That justification is the thing the probe disproved. The "comment side-effect"
needs no permission beyond `pull-requests: write`, which every one of these jobs
already holds for other reasons. With `issues: write` removed, the durable
lane's permission union and the descriptor's `requiredPermissions` become
equal — so the upper bound that could not previously exist becomes expressible.

This is why the order matters: **correct the lanes first, then add the gate.**
Adding the gate first would require it to accept the current over-grant, which
is the defect.

## What the gate compares

`08-22` Phase 1 already specified the right shape and it still holds:

> Resolve the lane from the descriptor's own `workflow.path` basename; do not
> list lanes.

So the set-equality gate is scoped to **the descriptor's own lane**
(`.github/workflows/sd-review.yml`), because that is the only lane the
descriptor describes and the only one a consumer provisions permissions from.
Comparing the union across *all* lanes would be wrong: the event-driven router
and the generic durable example are not what `requiredPermissions` documents,
and folding them in would force the descriptor to describe workflows a consumer
may never install.

The union is taken over the lane's jobs, with each job's effective permissions
resolved the way `permissionMap`/`grantedLevel` already resolve them, so
`write-all`/`read-all` and workflow-level inheritance are handled by existing
code rather than a second implementation.

The other lanes are covered by a separate, simpler sweep: **no shipped lane
grants `issues: write` at all**, enumerated from `laneDocuments()`. That is a
sweep rather than a fixed list, so a lane added later is covered without anyone
remembering to add it — the same shape as the review-floor sweeps added in
`08-22`.

## Why not simply narrow the existing lower-bound gate into equality

Tempting, and wrong. `assertJobPermissions` is scoped to jobs that *run this
action*. The `pr-agent` job deliberately runs no action step and is explicitly
out of that gate's scope — which is correct, since its permissions are about the
third-party container, not the contract. But that job is exactly where the
over-grant question lives in the router lane. An equality rule bolted onto that
function would either skip the job that matters or drag isolated adapter
containers into a contract they have nothing to do with.

The new gate is therefore separate and descriptor-anchored, not a tightening of
the existing one.

## Compatibility and rollout shape

Removing a permission from a lane template is a **narrowing** change. Its
failure mode is a job that needed the scope losing it — which is why the live
`cheap`/`deep` confirmation is a real acceptance criterion and not a formality,
even though the permission question itself is settled.

Consumers take the change the same way they took v0.6.0: installer `update`
rewrites the lane blob and advances the pin. There is no variable to set first,
so unlike D2 there is no ordering hazard and no window where the fleet is
half-migrated into a broken state — an old lane with the new pin and a new lane
with the old pin both work, because nothing about the permission is negotiated
between them.

**Rollback** is reverting the lane to the previous pin. Unlike a bound, a grant
that is removed and then restored leaves no residue.

## The one thing the probe does *not* settle

The probes answer "may a token with these scopes reach the issue-scoped
endpoints". They do not answer "does PR-Agent, as invoked by this lane, in fact
publish successfully". Those differ if PR-Agent calls some endpoint no probe
covered — it is a pinned third-party container and its request surface is not
ours to enumerate from source.

Two facts narrow that gap without closing it. First, the second probe swept
every issue-scoped endpoint the `review` command could plausibly use — list,
reaction, events, comment update — and all were permitted. Second, both lanes
invoke PR-Agent **identically**: `--pr_url=… review`, a direct CLI call rather
than the comment-triggered app path that adds reactions. So there is no
behavioural difference between the lane that has the grant and the lane that
does not, which is itself evidence the grant was never load-bearing.

That gap is why `prd.md` keeps the live credentialed run as an acceptance
criterion. It is a *confirmation* step, not the experiment: the design decision
no longer depends on it. If the owner withholds approval, the change can still
ship with that criterion recorded unmet and the residual risk stated plainly.

**Do not reach for the tempting argument here.** It would be easy to write that
the durable lane's `pr-agent` job has held the reduced grant fleet-wide since
v0.5.0 without a single failure, and treat that as evidence. It is not evidence.
The fleet is installed `REVIEW_ROUTE_MODE=copilot` with
`REVIEW_INDEPENDENT_FLOOR=copilot`, which makes `cheap` and `deep` unreachable
by construction — that is the property that lets the fleet hold no provider
credential at all. The `pr-agent` job has therefore **never executed on any
consumer**. Its `if:` guard has evaluated false every time. A job that has never
run has proven nothing about its permissions, and "no consumer has reported a
failure" describes a code path no consumer has exercised.

So the honest statement of the residual is: the permission boundary is settled
by probe; PR-Agent's own end-to-end behaviour under the reduced grant is
unverified in *both* lanes, and the only thing that would verify it is a
credentialed run.
