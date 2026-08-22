# Roll the durable lane out to the 9 fleet consumers with a per-repo smoke PR

## Goal

Deploy the routed review lane to every repository in the fleet manifest and prove each
deployment with one smoke pull request that publishes a real receipt Check Run.

## Problem

One of nine manifest consumers carries the lane. Probed 2026-08-22 against every consumer
checkout resolved from the manifest `pathHint`:

| consumer | mode | `config/routed-review-setup-v1.json` | `.github/workflows/sd-review.yml` |
| --- | --- | --- | --- |
| rwbp-coordinator | thin | absent | absent |
| loadsmith | thin | absent | absent |
| hoa-manager | thin | absent | absent |
| rwbp-website | thin | absent | absent |
| mezmo_benchmark | thin | absent | absent |
| se-ai-command-pack | thin | absent | absent |
| sd-github-review | thin | present | present |
| people-profiles | thin | absent | absent |
| anomaly-metric-creator | thin | absent | absent |

All nine checkouts exist and resolve. `sd-github-review` is legitimately deployed: it is both
the router and a manifest consumer at priority 70, and since `08-09-descriptor-contract-path`
the published source lives at `contract/routed-review-setup-v1.json` while the installed
consumer copy lives at `config/`. The two paths no longer collide, so its `present` row is a
real installation and not the old self-match defect.

The eight remaining consumers probe
`{"state":"absent","reason":"setup-descriptor-absent"}`. The routed review lane no-ops without
erroring: the failure mode is silence, which is why it went unnoticed.

## Fleet shape

The fleet is the schema-version-5 manifest at `docs/fleet/consumers.json` in
`sd-ai-command-pack`. Rollout order and cohort policy:

- **canary** — sequential: `rwbp-coordinator`, `loadsmith`, `hoa-manager`
- **post-canary** — bounded-parallel, max concurrency 2: `rwbp-website`, `mezmo_benchmark`,
  `se-ai-command-pack`, `sd-github-review`
- **final** — sequential: `people-profiles`, `anomaly-metric-creator`

Every consumer is `mode: thin`. Thin governs whether the consumer vendors the pack tree; the
review lane is a separate consumer artifact installed by a different tool, so thin does not by
itself preclude the lane. `sd-github-review` is thin and fully deployed, which is one
confirming datapoint but not a general proof — the canary is what establishes it.

## Installation mechanism

The lane is **not** installed by the `sd-ai-command-pack` fleet-refresh mechanism. Fleet
refresh installs the pack. The durable lane is installed by this repository's own consumer
installer:

```
node scripts/install-consumer.mjs install --route-mode MODE ...
```

Lifecycle commands are `install`, `update`, `adopt`, `check`, `uninstall`. `check` is
read-only and is the authoritative probe. The installer also drives GitHub-side setup
(`set-variable`, `create-label`, `set-secret`).

`--route-mode` is **required on install and has no default**. Valid values: `auto`, `cheap`,
`deep`, `copilot`, `none`. It may alternatively be read from the repository's
`REVIEW_ROUTE_MODE` GitHub variable. Each consumer therefore needs an explicit route-mode
decision before its install (see Open Decisions).

## Requirements

- Install the discovery descriptor and the durable `sd-review.yml` workflow into each manifest
  repository through this repository's consumer installer. Do not hand-place files; a
  hand-placed lane is what made the pilot look deployed while nothing was installed.
- Respect the manifest's rollout order and cohort policy: canaries strictly sequential, the
  post-canary cohort at concurrency two, the final cohort sequential.
- Open one smoke pull request per repository and confirm the `sd-github-review/receipt` Check
  Run is published against it.
- Stop the rollout on the first canary that fails to produce a receipt, and record what failed
  before continuing.
- Treat `sd-github-review` as already deployed: verify it with `check` rather than reinstalling,
  and still require its smoke PR receipt.

## Acceptance Criteria

- [ ] All 9 manifest repositories contain `config/routed-review-setup-v1.json` and
      `.github/workflows/sd-review.yml`, both installer-produced.
- [ ] `check` in each of the 9 returns a state other than `absent`/`setup-descriptor-absent`.
- [ ] Each of the 9 has one smoke pull request on which the `sd-github-review/receipt` Check
      Run appears, with the run URL recorded per repository.
- [ ] Every installed descriptor pins the same first-party SHA as the current release.
- [ ] Every installed manifest records the route mode chosen for that consumer.
- [ ] Any repository that failed is reported with its failure, not silently skipped.
- [ ] The count in every criterion above is 9. A run reporting success over 8 repositories is a
      failed run, not a passing one.

## Resolved Decisions

- **Route mode per consumer.** Decided 2026-08-22 by the owner: `copilot` for all eight
  undeployed consumers, revised from an initial `auto` once the installer's own help surfaced
  that `auto` can bill the provider key and is the stated reason the lane refuses to default.
  This matches the mode `sd-github-review` already runs. `sd-github-review` is not reinstalled.
  The flag is passed explicitly on every install rather than relying on an ambient
  `REVIEW_ROUTE_MODE` variable, so the mode is recorded in each local manifest.

## Open Decisions

- **External-repo scope approval.** Granted 2026-08-22.
- **Provider-key distribution under `copilot`.** The installer's secret gate is unconditional
  and mode-blind: `planResources` refuses without `PR_AGENT_MODEL_API_KEY` for every route
  mode, including `copilot` and `none`, neither of which spends a PR-Agent provider key.
  Proceeding as planned therefore copies a live provider credential into eight repositories
  that will not use it, one of which (`answerbook/mezmo_benchmark`) is in a different GitHub
  org. That widens credential exposure with no corresponding benefit. Two paths:
  1. Supply the key and proceed. Spend risk under `copilot` is near zero because the key sits
     unused, but eight more copies of the credential exist.
  2. Make the secret gate mode-aware first, so `copilot` and `none` install without a
     PR-Agent key. This is a change to the consumer installer and belongs in its own task;
     the rollout would then need no credential distribution at all.

  This is an owner decision and blocks the first canary.

## Scope and Authority

Execution mutates nine external repositories, opens a pull request in each, and sets GitHub
variables, labels, and secrets in each. That is outside the autonomous work-loop's run-level
authority and requires explicit per-run approval for that scope.

## Notes

2026-08-22: Refreshed against live manifest and a probe of all nine checkouts. Three
corrections to the prior revision, each of which would have produced a wrong run:

1. Fleet is schema 5 with **9** consumers, not schema 4 with 8. `people-profiles` was added at
   priority 80 and the final cohort is now `[people-profiles, anomaly-metric-creator]`
   sequential, not `anomaly-metric-creator` alone. Every acceptance criterion previously read
   "all 8" and would have reported green at 8/9 with one repository silently unrolled — the
   exact silent-skip failure this task exists to close.
2. The install mechanism was recorded as the `sd-ai-command-pack` fleet-refresh. It is not;
   fleet refresh installs the pack. The lane installer is this repository's
   `scripts/install-consumer.mjs`.
3. `--route-mode` is required with no default, so the rollout cannot begin until the per-consumer
   route modes are chosen. The prior revision did not mention route mode at all.

2026-08-09: Both prerequisites are closed and archived — `08-08-installer-durable-lane` and
`08-09-descriptor-contract-path`. Verified 2026-08-22 that the emitting artifacts are real and
present in this repository: `contract/routed-review-setup-v1.json` and `examples/sd-review.yml`
are the sources, mapped by `scripts/consumer-installer/codecs.mjs` to `config/` and
`.github/workflows/` respectively. The `blockedOn` marker was stale and has been cleared.
