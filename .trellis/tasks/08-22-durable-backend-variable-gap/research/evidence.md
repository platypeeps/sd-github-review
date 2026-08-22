# Evidence

Collected 2026-08-22 against `main` at `f6b5388` (the `0.4.1` candidate).

> **Correction.** An earlier draft of this file and of `prd.md` claimed the
> defect fires on the default dispatch path and would fail canary 1. That was
> wrong. It was reasoned from `--remote` defaulting to `auto` without checking
> what the installed template does with `independent-review-floor`. The floor
> section below is the correction, and it lowers the severity from "rollout
> blocker" to "latent, conditional".

## The two variables are read but never written

`examples/sd-review.yml:62-63`:

```yaml
cheap-backend: ${{ vars.SD_REVIEW_CHEAP_BACKEND_V1 }}
deep-backend: ${{ vars.SD_REVIEW_DEEP_BACKEND_V1 }}
```

and separately at `:67`, `high-risk-route: deep`.

The installer's managed variable table (`scripts/consumer-installer/codecs.mjs:154-162`)
holds four names and neither backend variable:

```js
const LEGACY_CONFIG_VARIABLES = Object.freeze({
  PR_AGENT_MODEL_PROVIDER: "provider",
  CHEAP_REVIEW_MODEL: "cheapModel",
  DEEP_REVIEW_MODEL: "deepModel",
});
const CONFIG_VARIABLES = Object.freeze({ ...LEGACY_CONFIG_VARIABLES, REVIEW_ROUTE_MODE: "routeMode" });
```

```
$ grep -rn "SD_REVIEW_CHEAP_BACKEND_V1\|SD_REVIEW_DEEP_BACKEND_V1" scripts/
(no output)
```

Nothing in the installer creates, reads, checks, or removes them. That part of
the original finding stands.

## What happens when they are empty

`src/operations.js:131-138`:

```js
function selectedBackend(route, env) {
  if (route === "none") return null;
  if (route === "copilot") return copilotBackend(env);
  const backend = decodeBackend(jsonInput(`${route}-backend`, env), `${route}-backend`);
```

`jsonInput` throws on empty (`src/operations.js:52-56`), giving
`<route>-backend is required for durable operations`. So `cheap` and `deep`
fail; `copilot` and `none` do not.

## The review floor is why this has not fired

`selectedBackend` receives the **post-floor** route (`src/operations.js:381-405`
builds the decision, then `:405` calls `selectedBackend(decision.route, env)`).

`ROUTE_STRENGTH` (`src/router.js:15-20`) orders routes
`none=0 < cheap=1 < deep=2 < copilot=3`, and `selectProtocolRoute` applies
`route = strongerRoute(route, floor)` (`src/router.js:197`). `copilot` is the
*strongest* route, so a `copilot` floor raises everything to `copilot`.

The installed template declares `independent-review-floor` with default
`copilot` and passes `${{ inputs.independent-review-floor }}` to the action. The
pack never sends that input:

```
$ grep -rn "independent-review-floor" sd-ai-command-pack/scripts/ sd-ai-command-pack/plugins/
(no output)
```

which the template's own comment already states: "the routed-review caller does
not send this input … so this default is the repository's actual review policy,
not a fallback."

Measured directly against `selectProtocolRoute`, routine risk, `route: auto`:

```
floor=none     -> route=cheap
floor=cheap    -> route=cheap
floor=deep     -> route=deep
floor=copilot  -> route=copilot
```

**Therefore:** a pack-dispatched durable review in an installed consumer always
routes `copilot`, synthesizes its own backend, and never reads either variable.
Canary 1 would pass.

## When it does fire: the floor does not override an explicit route

Measured the same way, varying `request.route`:

```
request.route=auto   floor=none     -> cheap
request.route=auto   floor=copilot  -> copilot
request.route=cheap  floor=none     -> cheap
request.route=cheap  floor=copilot  -> cheap
request.route=deep   floor=none     -> deep
request.route=deep   floor=copilot  -> deep
```

`routeReview` returns early for an explicit mode, and the floor only raises the
automatic result. So the `copilot` floor masks the gap for `--remote auto` and
for nothing else.

`REMOTE_VALUES = frozenset({"auto", "cheap", "deep", "copilot", "none"})`
(`sd-ai-command-pack-review.py:53`), so `sd-review --remote cheap` is ordinary
documented usage. Against an installed consumer it routes `cheap`, reaches
`selectedBackend`'s external branch, and fails — no floor change and no
workflow edit required.

The `workflow_dispatch` floor input is a second, weaker route to the same
failure: lowering it to `none` or `cheap` exposes it for `auto` dispatches too.

## Why the pilot cannot detect it

`platypeeps/sd-github-review-pilot` has both variables set:

```
$ gh api repos/platypeeps/sd-github-review-pilot/actions/variables --jq '.variables[].name'
CHEAP_REVIEW_MODEL
DEEP_REVIEW_MODEL
PR_AGENT_MODEL_PROVIDER
SD_REVIEW_CHEAP_BACKEND_V1
SD_REVIEW_DEEP_BACKEND_V1
```

They are absent from that repository's own installer manifest
(`.github/sd-github-review.json`, `resources.variables` lists only the three
legacy names), confirming they were set by hand, not by an install.

Note also that `durable-review-pilot.yml` passes `cheap-backend` explicitly and
sets no floor, so the action's own `none` default applies and the pilot routes
`cheap`. The pilot therefore exercises the opposite configuration from the one
the installer ships.

## `check` cannot see it

The managed-variable table comment (`codecs.mjs:147-150`) states that
`variableValues` "feeds the install/update plan and the `check` drift loop".
Drift detection is scoped to managed variables, so a consumer missing both
reports healthy.

## The installer always has enough config to synthesize

`codecs.mjs:66-70`:

```js
export const DEFAULT_CONFIG = Object.freeze({
  provider: "openrouter",
  cheapModel: "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
  deepModel: "openrouter/moonshotai/kimi-k2.6",
});
```

Provider and both models are always present regardless of route mode.

## The workflow must equal its template

`codecs.mjs:360`:

```js
if (value.source.sha256 !== value.workflow.sha256) {
```

The decoder *requires* the installed workflow's hash to equal the source
template's. Any design that writes per-consumer content into `sd-review.yml`
violates a decoder invariant, not merely a convention.

## Backend descriptor schema

`decodeBackend` (`src/protocol.js:611-659`) requires `id`, `label`, `kind`, and
a non-empty `findingChannels` drawn from `FINDING_CHANNELS`, and requires
non-empty `reviewAuthors` whenever any non-`check` channel is declared. `kind`
must be `external` for a `{route}-backend` input (`src/operations.js:135-137`).

## Route mode does not reach the durable lane

`examples/sd-review.yml` never reads `REVIEW_ROUTE_MODE`. The durable route
comes from the dispatched request, so `--route-mode copilot` does not constrain
what a dispatch may select. Separable finding; see `design.md`.
