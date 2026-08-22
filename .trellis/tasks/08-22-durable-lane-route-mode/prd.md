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

## Open questions

- **Where does the constraint live — the lane, the action, or the pack?**
  The lane can gate before dispatch; the action can refuse in
  `selectProtocolRoute`; the pack can refuse to send. Each has a different blast
  radius, and only the action's applies to dispatches the pack did not make.
- **Is a forbidden route an error or a downgrade?** Refusing is honest; silently
  lowering to the permitted mode is friendlier and matches how the review floor
  already behaves in the other direction. These are materially different
  contracts and the choice belongs to the user, not to the implementer.
- **Does this need a schema bump?** Probably not — schema 4 already records the
  field. Confirm rather than assume.

## Non-goals

- Changing `ROUTE_MODES`, the `high-risk-route: deep` default, or the
  `independent-review-floor` default.
- Distributing `PR_AGENT_MODEL_API_KEY` into consumer repositories. Unchanged
  and still settled.

## Evidence

Carried from `08-22-durable-backend-variable-gap/research/evidence.md`,
section "Route mode does not reach the durable lane", collected against `main`
at `f6b5388`.
