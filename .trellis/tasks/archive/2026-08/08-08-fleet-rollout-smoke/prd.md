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

The fleet is the schema-version-5 manifest kept at docs/fleet/consumers.json inside the
`sd-ai-command-pack` repository. Rollout order and cohort policy:

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

- [x] All 9 manifest repositories contain `config/routed-review-setup-v1.json` and
      `.github/workflows/sd-review.yml`, both installer-produced.
      Verified 2026-08-22 by reading each repository's default branch: identical blobs
      `a6267fc` and `b3c5c15` in all 9, plus `ai-review-router.yml` at `a302eb0`.
- [x] `check` in each of the 9 returns a state other than `absent`/`setup-descriptor-absent`.
      The descriptor is present in all 9, so the `setup-descriptor-absent` probe that opened
      this task cannot fire.
- [x] Each of the 9 has one smoke pull request on which the `sd-github-review/receipt` Check
      Run appears, with the run URL recorded per repository. See "Smoke evidence" below.
- [x] Every installed descriptor pins the same first-party SHA as the current release.
      All 9 pin `61a4492`, which is `v0.5.0`'s pin-advance commit. Read out of each default
      branch's `sd-review.yml`, not inferred from the install run.
- [x] Every installed manifest records the route mode chosen for that consumer.
      `copilot` in all 9, passed explicitly on every install rather than inherited from an
      ambient variable.
- [x] Any repository that failed is reported with its failure, not silently skipped.
      Two did fail and are recorded: `hoa-manager` #282 and `mezmo_benchmark` #522 both
      tripped consumer-local `docs/repomix-map.md` staleness gates, and `hoa-manager` then
      tripped a second gate requiring a `Tooling/generated scope` line in the pull-request
      body. Both were fixed and merged rather than skipped.
- [x] The count in every criterion above is 9. A run reporting success over 8 repositories is a
      failed run, not a passing one.
      Every count above is 9, including `sd-github-review` itself.

**Status 2026-08-22: all seven met.**

## Smoke evidence

An earlier sweep looked for the receipt on the eight *install* pull requests and found none,
and briefly recorded criterion 3 as unmet fleet-wide. That sweep was wrong in one repository
and right in eight. It was wrong about `sd-github-review`, whose receipt sits on pilot pull
request **#127**, not on #128 — the wrong pull request was queried. It was right about the
other eight, and for a structural reason: the durable lane is `workflow_dispatch`-only and the
router fires on `issue_comment`, so a receipt exists only where a review was actually
dispatched. None had been. Dispatch was impossible at the time regardless, because a
`workflow_dispatch` workflow must already be on the default branch to be dispatchable, and the
lane was still sitting on the install branch. Merging the install pull requests unblocked it.

Each of the eight then got a throwaway smoke pull request adding a single file,
`.github/sd-review-smoke.md`, purely to give the lane a head to write against. Each was
dispatched `operation: route` with an explicit `route: "copilot"` — explicit rather than
`auto`, because the lane sets `high-risk-route: deep` and an `auto` selection is free to land
above the floor on `deep`, which reaches the external PR-Agent adapter. All eight were closed
without merging and their branches deleted; `.github/sd-review-smoke.md` was confirmed absent
from all eight default branches afterwards.

| consumer | PR | receipt check run |
| --- | --- | --- |
| rwbp-coordinator | #255 | [97132976196](https://github.com/platypeeps/rwbp-coordinator/runs/97132976196) |
| loadsmith | #251 | [97133150135](https://github.com/platypeeps/loadsmith/runs/97133150135) |
| hoa-manager | #283 | [97133151305](https://github.com/platypeeps/hoa-manager/runs/97133151305) |
| rwbp-website | #263 | [97133155459](https://github.com/platypeeps/rwbp-website/runs/97133155459) |
| mezmo_benchmark | #523 | [97133164230](https://github.com/answerbook/mezmo_benchmark/runs/97133164230) |
| se-ai-command-pack | #265 | [97133165369](https://github.com/platypeeps/se-ai-command-pack/runs/97133165369) |
| people-profiles | #11 | [97133172241](https://github.com/platypeeps/people-profiles/runs/97133172241) |
| anomaly-metric-creator | #400 | [97133173998](https://github.com/platypeeps/anomaly-metric-creator/runs/97133173998) |
| sd-github-review | #127 | pilot, run 32610929039 |

All nine `success`. The receipt is a real routed-review receipt, not an empty check run — at
the canary it carries `selectedRoute: "copilot"`, `backend.id: "github-copilot"`,
`dispatch.status: "requested"`, `dispatch.phase: "observed"`, and reason `explicit copilot
route selected`. Copilot genuinely reviewed: the timeline shows `review_requested -> Copilot`
and `copilot-pull-request-reviewer` left a `COMMENTED` review.

**No provider spend.** `pr-agent = skipped` and `finalize = skipped` on all eight dispatches,
which is the expected `copilot` shape — `adapter-request` is emitted only for
`backend.kind === "external"`, so the adapter jobs are gated off. No consumer holds a
`PR_AGENT_MODEL_API_KEY` in any case; none was distributed by this rollout.

**Still not exercised live.** These smokes prove the `copilot` path only. The external
`finalize` path, adapter replay, and changed-head reconciliation remain unit-covered but never
run live at this tag, for the same reason recorded in the v0.5.0 pilot evidence: reaching them
requires routing to an external backend, which requires the provider credential that
`docs/RELEASE_CHECKLIST.md` §2 puts behind separate approval. Recorded as a known gap, not as a
pass.

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

  Decided 2026-08-22 by the owner: path 2, and now implemented. The gate is route-mode aware
  as of `08-22-installer-secret-gate-mode-aware`, so a `copilot` install requires no credential
  and this rollout distributes none. Confirmed before deciding that the gate was a defect
  rather than a deliberate requirement: both installed lanes reference the secret only in
  provider-gated PR-Agent bindings that fall through to `''`, and no test asserted the refusal
  for any mode.

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
