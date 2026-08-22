# Design

## Decision

**The `route` operation gains a `route-policy` input carrying the consumer's
recorded `REVIEW_ROUTE_MODE`. `selectProtocolRoute` refuses a request whose
*declared* route the policy forbids, naming the policy. An empty policy permits
everything.**

Enforcement is action-side only. That is the only layer that also governs
dispatches the pack did not make — the Actions UI and `gh workflow run` are
`workflow_dispatch` callers with write access, and this session used exactly
that path while testing.

## The policy governs the *requested* route, not the *resolved* one

This is the load-bearing decision, and getting it backwards breaks the fleet.

`independent-review-floor` is a **minimum** and route mode is a **maximum**. Applied
to the same value they can be mutually unsatisfiable, and the installed default
makes that immediate rather than theoretical: the shipped floor is `copilot`.

A consumer installed `--route-mode cheap` would then have every `auto` dispatch
raised to `copilot` by its own floor and refused by its own policy. Every default
review on that consumer would fail, caused by nothing the caller did.

So:

- `request.route === "auto"` is **always permitted**. `auto` declares no intent;
  it hands the choice to the repository, and the repository's floor and risk
  rules then decide. Policing the outcome would mean policing the repository
  against itself.
- An **explicit** `request.route` must be permitted by the policy.

This also matches the problem statement exactly: the defect is that a
`copilot`-mode consumer can still be dispatched `--remote cheap`. It is the
*declared intent* that escapes the policy today.

Floor and mode stay orthogonal and can never contradict.

## Permitted sets

```
policy = ""        -> {auto, cheap, deep, copilot, none}   (no policy recorded)
policy = "auto"    -> {auto, cheap, deep, copilot, none}
policy = <m>       -> {auto, m}
```

`auto` is in every set for the reason above. Otherwise the recorded mode names
the only explicit route the lane will run — the same reading the event-driven
lane already gives it, where `mode: ${{ vars.REVIEW_ROUTE_MODE }}` *is* the route.

### `none` is not implicitly permitted

Tempting, since "don't review" looks like it can never be worse. It can: under
`policy = copilot` an explicit `none` would evade the independent review the
consumer declared it wanted. `none` is permitted only when it is the recorded
policy.

### Do not reuse `ROUTE_STRENGTH` for this

`ROUTE_STRENGTH` orders `none 0 < cheap 1 < deep 2 < copilot 3`. That is an
**assurance/independence** ordering, not a cost ordering — `copilot` ranks
strongest while `deep` is the expensive one. Any "permit anything weaker than
the policy" rule built on it would permit `deep` under a `copilot` policy, which
is precisely the paid route the provider-free path exists to exclude.

Membership, not ordering. Written down because the constant is right there and
reads like it fits.

## Refusal, not downgrade

A forbidden explicit route fails with an error naming the variable, its value,
and the permitted routes. Chosen over silently lowering because the caller asked
for a specific reviewer at a specific cost; substituting a different one and
recording it only in the receipt makes the substitution discoverable only by
someone already suspicious.

The refusal must happen **before any receipt is written**, so a refused dispatch
leaves no durable state to reconcile. It is input validation, in the same class
as a malformed `review-request`, not a routing outcome.

## Empty policy permits everything

Covers two cases with one rule, which is why no schema bump is needed:

- a consumer at manifest schema < 4, which records no route mode at all;
- a consumer whose `REVIEW_ROUTE_MODE` variable is unset for any other reason.

`${{ vars.REVIEW_ROUTE_MODE }}` expands to `''` in both. Those consumers keep
working exactly as they do today, and `check` already reports the schema
migration that would give them a policy. Tightening silently would break lanes
on consumers that never opted into a policy — and the `routeModeNeedsProviderSecret`
precedent for failing closed on `undefined` governs **install** time, where the
cost of being wrong is a refused install, not **review** time, where it is a
broken lane.

An *invalid* recorded value is different from an absent one and must still be
rejected, or a typo silently disables the policy.

## Why not the descriptor or the pack

`contract/routed-review-setup-v1.json` already declares `supportedIntents`, and
the pack already refuses an intent outside it with `intent-not-supported`. That
looks like the ready-made answer and is not:

- Narrowing `supportedIntents` per consumer writes consumer-specific content
  into a byte-compared managed file. `check` compares the installed descriptor
  against this repository's source copy, so this is the **same structural trap**
  that rejected the inline-the-descriptor option in the backend-variable task —
  an invariant to dismantle, not a trade-off.
- A pack-side constraint is invisible to every non-pack dispatch, so the
  repository's declared policy still would not govern its own lane.

A constant descriptor field pointing at the variable (so the pack could refuse
earlier with a better message) remains available later. It is strictly an
error-quality improvement on top of this, never a substitute, and it costs a
contract change plus a coordinated pack release. Explicitly out of scope.

## The policy must not be a `workflow_dispatch` input

Every neighbouring policy value in `examples/sd-review.yml` is wired
`independent-review-floor: ${{ inputs.independent-review-floor }}`, declared as a
dispatch input with `default: copilot`. Copying that pattern would make the
feature self-defeating: the caller the policy exists to constrain is a
`workflow_dispatch` caller, and they would simply set `route-policy` to whatever
route they wanted.

`route-policy` is wired **directly to the variable**, with no `inputs.`
indirection:

```yaml
route-policy: ${{ vars.REVIEW_ROUTE_MODE }}
```

Repository variables are not settable from a dispatch form, so the value is the
repository's, not the caller's. This is the one place where diverging from the
surrounding pattern is mandatory rather than stylistic, and the workflow needs a
comment saying so — otherwise a later tidy-up "for consistency" silently removes
the enforcement.

### Related gap, deliberately not fixed here

The same reading shows `independent-review-floor` **is** caller-overridable
today: its `copilot` default is the repository policy only for callers who omit
it, and the file's own comment says the pack omits it. Anyone dispatching from
the Actions UI can lower the floor to `none`.

That is a real weakness in the same area, but it is a different change with a
different blast radius — the floor is a legitimate per-dispatch knob for some
callers, so removing the input is a behaviour change needing its own decision.
Out of scope here; recorded so it is not lost, and so nobody reads this task as
having closed it.

## Naming hazard

The action already has a `mode` input, `standalone`-only, whose value is a route.
A new input also called `mode`-something invites exactly the confusion that makes
someone wire `mode:` into `sd-review.yml` and watch it do nothing.

`route-policy` is the proposed name: it reads as a constraint rather than a
selection, and it will not autocomplete next to `mode`. The input's description
must say it is a *maximum* and that `independent-review-floor` is the minimum,
because the two will otherwise be confused on sight.

## Contract and compatibility

Adding an input to `route` is one entry in `src/operation-contract.js` plus the
matching `action.yml` block; `validate-action-metadata.mjs:324` enforces that the
two agree. The `route` operation already declares nineteen inputs (measured:
`route.inputs.length === 19`), several of them policy values of exactly this
shape (`independent-review-floor`, `high-risk-route`, `low-confidence-route`,
`allow-bookkeeping-none`), so this is the twentieth, not a new kind of thing.

The value is validated **in the codec**, not in the router.
`decodeRoutingInputs` states its own rule: it validates everything except the
route-*strength* fields `independentReviewFloor` and `localEvidenceRoute`, which
pass through raw because they resolve through `ROUTE_STRENGTH`. `route-policy`
resolves by membership, not strength, so it belongs in the validated class and
is returned typed. An unrecognised value fails there — which is also where the
"reject an invalid recorded value" requirement above is satisfied.

No manifest schema bump. Schema 4 already records `routeMode`; nothing new is
stored.

**But the workflow template changes**, and that has fleet consequences worth
stating rather than discovering:

- every installed consumer's recorded workflow hash goes stale, so `check`
  reports `a newer source .github/workflows/sd-review.yml is available; run
  update` across the fleet. Normal for a template change, and `update` resolves
  it — but it lands on top of the schema-5 migration the backend-variable fix
  already queued, so consumers should be updated once, after both.
- the first-party `actionReference` pin in the descriptor must advance with the
  release, per `docs/RELEASE_CHECKLIST.md` section 5.

## Rollout and rollback

Ships in the source repository only. No consumer behaviour changes until that
consumer runs `update`, because the constraint lives in the workflow template
they have not yet taken.

Rollback is reverting the commit while no consumer has updated; afterwards it is
an `update` from a reverted version. There is no persisted state to unwind — the
policy is evaluated per dispatch and nothing records it.

The blast radius on the fleet is bounded by two things, one measured and one
still pending:

- The pack dispatches `--remote auto` by default — measured, `sd-review/SKILL.md:47`,
  `remote=auto|cheap|deep|copilot|none` (default `auto`). `auto` is always
  permitted, so the default review path on every consumer is untouched no matter
  what policy it carries.
- Route mode `copilot` **is decided** for the fleet — `08-22-release-for-fleet-rollout/prd.md`
  records it under satisfied preconditions, alongside external-repo scope and
  nine verified-clean checkouts. But the fleet is **not installed yet**, so
  "every fleet consumer is installed `--route-mode copilot`" describes an
  approved plan, not observed state, and this design must not lean on it as a
  measurement. Nothing here changes if a consumer lands on another mode — the
  permitted set is computed from whatever that consumer recorded.

The consumers that would newly refuse anything are the ones someone deliberately
dispatches an explicit off-policy route at.
