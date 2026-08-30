---
title: Provision the durable backend variables no install creates
status: done
created: 2026-08-22
branch: feat/durable-backend-variables
---
# Provision the durable backend variables no install creates

## Goal

An install produces a durable review lane that serves every route it
offers. Today it produces one that fails on two of them, masked by defaults
that happen to steer callers elsewhere.

## Problem

`examples/sd-review.yml` — the workflow the consumer installer writes into every
consumer — supplies its backends from two repository variables:

```yaml
cheap-backend: ${{ vars.SD_REVIEW_CHEAP_BACKEND_V1 }}
deep-backend:  ${{ vars.SD_REVIEW_DEEP_BACKEND_V1 }}
```

Nothing creates them. The installer's managed variable table holds four names —
`PR_AGENT_MODEL_PROVIDER`, `CHEAP_REVIEW_MODEL`, `DEEP_REVIEW_MODEL`,
`REVIEW_ROUTE_MODE` — and neither backend variable is among them.
`grep -rn "SD_REVIEW_.*_BACKEND_V1" scripts/` returns nothing at all.

An unset variable expands to the empty string, and `selectedBackend` rejects
that for the `cheap` and `deep` routes with
`<route>-backend is required for durable operations`.

### Severity: real, but not a rollout blocker

An earlier draft of this PRD claimed the failure fires on the default dispatch
path and would fail canary 1. **That was wrong**, and the correction matters
enough to state rather than quietly fix.

`selectedBackend` receives the route *after* the review floor is applied.
`copilot` is the strongest route in `ROUTE_STRENGTH`
(`none=0 < cheap=1 < deep=2 < copilot=3`), and the installed template declares
`independent-review-floor` with default `copilot` — a default the pack never
overrides, because it dispatches only `operation`, `review-request`, and
`rerequest-authorized`. Measured against `selectProtocolRoute` on routine risk
with `route: auto`:

```
floor=none     -> route=cheap
floor=cheap    -> route=cheap
floor=deep     -> route=deep
floor=copilot  -> route=copilot
```

So a review dispatched at the **default** `--remote auto` always routes
`copilot`, synthesizes its own backend, and never reads either variable.
**Canary 1 would pass.** This is not a rollout blocker.

But the floor only raises an *automatic* route. It does not override an
explicit one:

```
request.route=auto   floor=copilot  -> copilot
request.route=cheap  floor=copilot  -> cheap
request.route=deep   floor=copilot  -> deep
```

`--remote` accepts `auto`, `cheap`, `deep`, `copilot`, `none`. So
`sd-review --remote cheap` against an installed consumer routes `cheap`,
reaches `selectedBackend`'s external branch, and fails with
`cheap-backend is required for durable operations` — no floor change, no
workflow edit, ordinary documented usage of the pack's own CLI.

That is the real severity: not a rollout blocker, but a defect any operator
reaches by selecting a route explicitly, with nothing on the consumer side to
diagnose it. The lane ships two routes it cannot serve.

Two things make it worse than an ordinary bug:

- **`check` cannot detect it.** Drift detection is scoped to the managed
  variable table, so a consumer with a non-functional durable lane reports
  healthy. That is the same silent-failure shape as the
  `setup-descriptor-absent` problem the fleet rollout exists to eliminate.
- **The pilot cannot detect it.** `sd-github-review-pilot` has both variables
  set by hand — they are absent from its own installer manifest's
  `resources.variables`. Its `durable-review-pilot.yml` also passes
  `cheap-backend` directly and sets no floor, so it exercises the opposite
  configuration from the one the installer ships. The pilot was configured
  around the defect from both directions.

Left alone, the rollout succeeds and nine consumers carry a lane whose `cheap`
and `deep` routes fail the first time anyone selects them.

## Secondary finding: route mode does not reach the durable lane

`examples/sd-review.yml` never reads `REVIEW_ROUTE_MODE`. The installer manages
that variable as the repository's route policy and brought it under management
at manifest schema 4, but the durable lane takes its route from the dispatched
request instead. Installing with `--route-mode copilot` therefore does not stop
a `--remote cheap` dispatch from routing `cheap`. (Not `--remote auto`, which
the review floor raises to `copilot` — the two masks are independent, and only
the explicit route escapes both.)

This is separable from the variable gap and must not be silently folded into
it. It is recorded here because it determines whether the fix can be scoped to
"always provision both variables" or must also constrain the lane. See
`design.md` for the decision.

## Requirements

- A consumer installed by `install` has a durable lane that completes a `route`
  operation for the `cheap` and `deep` routes without any manual variable
  setup.
- Whatever carries the backend descriptors is covered by `check`, so a consumer
  that drifts or is missing them is reported rather than silently broken.
- `uninstall` removes anything `install` created, with no new orphans.
- Existing consumers — including manifests at schema 1 through 4 — migrate
  through `update` without manual intervention. `sd-github-review` itself is
  already installed and is in the post-canary cohort.
- The backend descriptors produced must satisfy `decodeBackend` and must be
  `kind: external`, since `selectedBackend` rejects anything else for a
  `{route}-backend` input.
- The `REVIEW_ROUTE_MODE` finding is explicitly dispositioned: fixed here,
  or split into its own task with a written reason. Not left implicit.

## Non-goals

- Changing routing behavior, the `high-risk-route: deep` default, or the
  `independent-review-floor` default.
- Distributing `PR_AGENT_MODEL_API_KEY` into consumer repositories. The
  provider secret question is settled and unchanged: `copilot` and `none`
  install without a credential, and nothing here alters that.
- Running the fleet rollout itself. That stays in `08-08-fleet-rollout-smoke`.

## Acceptance criteria

- [ ] A fresh install into a scratch repository, then a durable `route`
      dispatch with an **explicit `cheap` route** at the shipped
      `independent-review-floor: copilot`, produces a receipt with
      `selectedRoute: cheap` rather than
      `cheap-backend is required for durable operations`.
      The explicit route is what makes this test meaningful — an `auto`
      dispatch is raised to `copilot` by the floor and would pass without
      exercising `selectedBackend`'s external branch at all.
- [ ] The same with an explicit `deep` route, producing `selectedRoute: deep`.
- [ ] An `auto` dispatch at the shipped floor still succeeds and still yields
      `selectedRoute: copilot`, confirming the change did not disturb the path
      the fleet actually uses.
- [ ] `check` reports an issue on a consumer whose backend descriptors are
      absent or drifted, and reports clean once they are correct.
- [ ] `uninstall` leaves no backend variable behind.
- [ ] `update` migrates an existing schema-4 consumer, and a pre-schema-4
      manifest still decodes.
- [ ] `npm test` passes with new coverage for the synthesized descriptors and
      the migration path; `npm run check` and `validate:metadata` exit 0.
- [ ] The `REVIEW_ROUTE_MODE` finding is resolved or split, with the decision
      written down.

## Resolved during planning

- **Installer or template?** Installer. The template cannot carry per-consumer
  content: the manifest decoder requires `source.sha256 === workflow.sha256`
  (`codecs.mjs:360`), so an inlined descriptor breaks a decoder invariant.
- **Schema bump?** Yes, 4 to 5, gated on a new `BACKEND_MIN_SCHEMA_VERSION`
  rather than on equality with `MANIFEST_SCHEMA_VERSION`, matching how
  `REVIEW_ROUTE_MODE` joined at 4.
- **Provision for `copilot`/`none` consumers too?** Yes, unconditionally.
  Neither route mode nor the review floor durably constrains which route a
  dispatch may select, so conditional provisioning would leave the gap
  reachable and add a mode-dependent migration for nothing.
- **`REVIEW_ROUTE_MODE` not reaching the lane.** Split into its own task; it
  changes which routes are *permitted*, while this task changes what is
  *provisioned*. Their acceptance tests contradict each other unless separated.

## Open questions

- None blocking. `reviewAuthors` for the synthesized descriptor must be
  verified against what PR-Agent actually posts as before implementation —
  tracked as step 0 of `implement.md`, not left to assumption.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/08-22-durable-backend-variable-gap`:

- research/evidence.md
