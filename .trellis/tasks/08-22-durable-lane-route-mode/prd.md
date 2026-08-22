# Make the durable lane honor the repository's managed route policy

Split out of `08-22-durable-backend-variable-gap` during its planning. That task
changed what a consumer is *provisioned* with; this one changes what a consumer
is *permitted* to be dispatched to. They were separated deliberately — see
"Why this is not folded into the backend-variable task" below.

## Problem

The installer manages `REVIEW_ROUTE_MODE` as the repository's route policy and
brought it under management at manifest schema 4. `install` writes it, the
manifest records its ownership, `check` reports it drifted, and `uninstall`
removes it.

`examples/sd-review.yml` — the durable lane the installer writes into every
consumer — never reads it:

```
$ grep -n "REVIEW_ROUTE_MODE" examples/sd-review.yml
(no output)
```

The durable route comes from the dispatched request instead. So installing a
consumer with `--route-mode copilot` does not stop `sd-review --remote cheap`
from routing `cheap` on that consumer.

The event-driven lane (`examples/pr-agent-router.yml`) *does* gate on it, with a
`case` statement over exactly `ROUTE_MODES` — a test extracts that pattern and
asserts set equality against the installer's list, so the two cannot drift.
The durable lane has no equivalent binding. The repository therefore has one
managed policy variable that one of its two installed lanes obeys and the other
ignores.

### Why this matters beyond tidiness

`--route-mode` is the mechanism by which a consumer declares it will not reach a
PR-Agent provider. `PROVIDER_SECRET_OPTIONAL_ROUTE_MODES` is `{copilot, none}`,
and a consumer installed under either **installs with no
`PR_AGENT_MODEL_API_KEY` at all** — that is the whole basis of the provider-free
fleet path.

For those two modes the gap is currently self-limiting rather than dangerous: a
`--remote cheap` dispatch against a secret-less consumer routes `cheap`, the
adapter step finds no credential, and the job fails. It does not bill anyone. But
the failure is loud in the wrong place and contradicts what the operator
declared at install time, and the moment such a consumer gains the secret for any
other reason, the declared policy stops holding.

### Not the same as the review floor

`independent-review-floor` is a separate, weaker mask that happens to cover the
`auto` case: it raises an *automatic* route to `copilot` but leaves an explicit
one alone. The two masks are independent and only an explicit route escapes
both. Do not treat the floor as a substitute for this.

## Why this is not folded into the backend-variable task

Their acceptance criteria contradict each other unless separated in time:

- that task must show "the lane routes `cheap` successfully" on a consumer
  installed under `copilot`;
- this task must show "the lane refuses to route `cheap`" on a consumer
  installed under `copilot`.

Both cannot be true of one build. The backend task landed first and proved the
provisioning works; this one changes what is allowed on top of it.

## Requirements

- The durable lane's selected route is constrained by the consumer's recorded
  route mode, not only by the dispatched request.
- The constraint is *bound* to the installer's `ROUTE_MODES` the way the
  event-driven lane's is — by a test that reads the lane rather than restating
  the list — so the two cannot drift apart in one direction.
- A dispatch that names a route the repository's policy forbids fails in a way
  that says so, rather than failing later as a missing credential or a missing
  backend.
- A consumer at schema < 4 records no route mode. Decide explicitly what happens
  there and write the reason down; do not let "no recorded mode" silently mean
  "everything permitted" without saying so.
- `--route-mode auto` must keep permitting every route, since that is what it
  means.

## Open questions — all resolved

Answered by the user on 2026-08-22 after `research/evidence.md`. Rationale for
each is in `design.md`; recorded here so this section is not read as open.

- **Where does the constraint live — the lane, the action, or the pack?**
  → **The action only.** A new `route-policy` input on the `route` operation,
  enforced in `selectProtocolRoute`. It is the only layer covering dispatches
  the pack did not make. No pack release, no descriptor change.
- **Is a forbidden route an error or a downgrade?** → **Refuse**, naming the
  variable, its value, and the permitted routes.
- **Does this need a schema bump?** → **No.** Confirmed: schema 4 already
  records `routeMode` and nothing new is stored. A consumer at schema < 4
  records no policy, and an absent policy permits everything — stated
  deliberately, per the requirement above, with `check` already reporting the
  migration that would give them one.

One question the design surfaced that this PRD did not ask: **does the policy
constrain the requested route or the resolved one?** → **the requested route.**
Constraining the resolved route would let a consumer's own `independent-review-floor`
raise an `auto` dispatch above its own policy and refuse it, breaking every
default review on that consumer. See `design.md`.

## Scope expansion — 2026-08-22, approved by the user

Verifying the route-policy change against the fleet uncovered defects that
each block the same rollout this task exists to unblock. The user approved
widening rather than deferring: *"do what needs to be done to make the rollout
great. We can wait a little longer."* Recorded here so the artifacts match the
branch.

Every item below was found by checking the original change's blast radius, not
by broadening the search:

- **A same-head retry could skip the whole rerequest authorization chain.**
  `attempt: 2` with no `rerequestOf` bypassed `rerequest-authorized`, the
  prior-receipt identity check, `supportsRerequest`, and the policy/route
  match. Because `attempt` is part of the logical identity, it minted a fresh
  dispatch rather than colliding. Reachable by anyone able to dispatch the
  workflow. Now refused at decode.
- **A recorded skip wedged its exact head.** A pull request routed while a
  draft records `none`; marking it ready does not change the head SHA, and
  `draft` reaches neither the fingerprint nor the identity, so the next
  dispatch matched the stale skip forever.
- **An interrupted `started` receipt was permanently `reconciliation-required`.**
  Split into `in-flight` (younger than `stranded-receipt-minutes`, default 360
  — GitHub's own job ceiling, derived not tuned) and stranded. `route` now
  fails the step on a genuine reconciliation, since a receipt needing a human
  means no review was dispatched and reporting that only on an output leaves a
  green job and a silently unreviewed pull request.
- **The route policy reached only two of four dispatching lanes.** The first
  guard checked only lanes that already complied, so it was green. Replaced
  with one that enumerates every lane that dispatches.
- **A stale manifest wedged a consumer whose files already matched source.**
  `update`, `uninstall`, and `adopt` all refused; hand-editing the manifest was
  the only recovery. `sd-github-review` itself was in this state and would have
  failed its own rollout cohort.
- **The release could not be cut at all.** `assertPinFreshness` compared the
  pin's action code against the previous tag in both windows, so the mandatory
  pin-advance commit could never go green for any release that changes `src/`.
  `0.4.1` shipped only because it was action-code neutral.
- **Four drift paths that no gate could see**: prose SHAs in Markdown, release
  tags named in lane comments, lane inputs the pinned action never declared,
  and an unregistered historical template hash. Each is now enumerated from the
  filesystem, git, or the release tags rather than restated.

## Non-goals

- Changing `ROUTE_MODES`, the `high-risk-route: deep` default, or the
  `independent-review-floor` default.
- Distributing `PR_AGENT_MODEL_API_KEY` into consumer repositories. Unchanged
  and still settled.

## Evidence

Carried from `08-22-durable-backend-variable-gap/research/evidence.md`,
section "Route mode does not reach the durable lane", collected against `main`
at `f6b5388`.
