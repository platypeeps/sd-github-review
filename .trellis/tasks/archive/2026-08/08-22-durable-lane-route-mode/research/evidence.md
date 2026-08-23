# Evidence

Collected 2026-08-22 against `main` at `4f14bd3`, after the backend-variable fix
(`c08dfc6`) merged.

## The obvious fix is a dead end, three times over

The event-driven lane constrains itself with the repository variable
(`examples/pr-agent-router.yml:60`):

```yaml
mode: ${{ vars.REVIEW_ROUTE_MODE }}
```

Mirroring that line into `examples/sd-review.yml` looks like the whole task. It
is not, and each reason is independently fatal:

**1. `selectProtocolRoute` never reads `mode`.** It takes the route from the
request (`src/router.js:121-122`):

```js
const baseDecision = routeReview({
  configuredMode: request.route,
```

**2. `mode` is a `standalone`-only input.** Enumerated from
`src/operation-contract.js`:

```
standalone                   mode-input=True
route                        mode-input=False
acknowledge                  mode-input=False
finalize                     mode-input=False
query                        mode-input=False
```

**3. The metadata gate would reject it.** `scripts/validate-action-metadata.mjs:324`
requires `action.yml` inputs to equal the operation-contract union exactly and
errors with `inputs [...] are used by no operation`.

So passing `mode` on a `route` dispatch would be a no-op that also fails the
build. Recorded because it is the first thing anyone will try.

## The enforcement mechanism already exists — it is just not wired to the variable

`contract/routed-review-setup-v1.json` declares, per consumer:

```json
"supportedIntents": ["auto", "cheap", "deep", "copilot", "none"],
```

and the pack already refuses an intent outside that list
(external to this repository — sd-ai-command-pack 0.71.8, review script lines
886-889):

```python
intents = descriptor.get("supportedIntents")
if not isinstance(intents, list) or intent not in intents:
    return {"state": "incompatible", "reason": "intent-not-supported"}
```

That is a working, discoverable, already-shipped refusal path. Nothing narrows
the list, so every consumer advertises all five intents regardless of the route
mode it was installed under.

## Why the descriptor cannot simply be narrowed per consumer

The descriptor is a managed *file*, copied byte-identically from
`contract/routed-review-setup-v1.json`, and `check` compares the installed bytes
against that source (`MANAGED_RESOURCES`, and the freshness comparison
`recorded.sha256 !== sha256(sources[field])`). An existing test names the
requirement outright: *"migrating a schema-2 install adopts a byte-identical
`config/routed-review-setup-v1.json` without rewriting it"*.

This is the **same structural trap** that rejected option B in the
backend-variable task: per-consumer content in a byte-compared managed file is
not a trade-off, it breaks an invariant. Any design that writes a
consumer-specific `supportedIntents` has to dismantle that first.

A descriptor field that *points at* the policy — constant across consumers, so
byte-identity still holds — does not have this problem.

## Adding an input to `route` is cheap and well-supported

`src/operation-contract.js` is the single source of truth: runtime decoding,
metadata validation, permissions, and docs all read it. Adding an input to the
`route` operation is one entry there plus the matching `action.yml` block, and
the gate at `validate-action-metadata.mjs:324` enforces that the two agree.

The `route` operation already declares nineteen inputs — measured, not
estimated: `route.inputs.length === 19`. Several are policy values of exactly
this shape: `independent-review-floor`, `high-risk-route`,
`low-confidence-route`, `allow-bookkeeping-none`. A route-policy input would be
the twentieth, not a new kind of thing.

## Only an action-side constraint covers non-pack dispatch

`sd-review.yml` is a `workflow_dispatch` workflow. Anyone with write access can
run it from the Actions UI or `gh workflow run` with an arbitrary
`review-request`, exactly as this session did while testing. A pack-side or
descriptor-side constraint does not see those dispatches at all.

If the requirement is "the repository's recorded policy governs what its lane
will do", the constraint has to be enforced where the routing decision is made.

## What the floor does and does not do

Measured previously and unchanged: `independent-review-floor` raises an
*automatic* route and returns early for an explicit one
(`src/router.js:138-146`). It is a **minimum**, and route mode would be a
**maximum**. They are orthogonal, compose without conflict, and neither
substitutes for the other.

## Current blast radius

Because `--route-mode` is what lets a consumer install with **no**
`PR_AGENT_MODEL_API_KEY` (`PROVIDER_SECRET_OPTIONAL_ROUTE_MODES = {copilot,
none}`), the gap today is self-limiting rather than dangerous: a `--remote cheap`
dispatch against a secret-less consumer routes `cheap`, finds no credential, and
the adapter step fails. Nothing is billed.

Verified during the backend-variable end-to-end: the scratch consumer was
installed `--route-mode copilot`, held zero secrets throughout, and an explicit
`cheap` dispatch still routed `cheap` — the declared policy did not constrain it.

The failure is therefore loud, late, and in the wrong place, and it stops being
harmless the moment such a consumer gains the secret for any other reason.
