# Roll the durable lane out to the 8 fleet consumers with a per-repo smoke PR

## Goal

Deploy the routed review lane to every repository in the fleet manifest and prove each
deployment with one smoke pull request that publishes a real receipt Check Run.

## Problem

Zero deployments have been observed. Across the 19 local `platypeeps` checkouts:

- `config/routed-review-setup-v1.json` — the path `scripts/sd-ai-command-pack-review.py:31`
  probes for an installed descriptor — exists in exactly one repository, `sd-github-review`
  itself, which is the router's own published artifact rather than a consumer installation.
- The .github/workflows/sd-review.yml lane the descriptor names — a `workflow_dispatch`
  workflow — exists in exactly one repository, `sd-github-review-pilot`, where it was
  hand-placed. That repository is not in the fleet manifest.

So no manifest consumer carries an installed copy of either half of the contract. Seven of the
eight probe `{"state":"absent","reason":"setup-descriptor-absent"}`; the eighth is
`sd-github-review` itself, whose probe matches its own published descriptor at the discovery
path instead of reporting absent — the separate defect that
`08-08-installer-durable-lane` closes. In both cases the routed review lane no-ops without
erroring: the failure mode is silence, which is why it went unnoticed.

The fleet is the schema-version-4 manifest at docs/fleet/consumers.json in
`sd-ai-command-pack`, whose rollout order is: rwbp-coordinator, loadsmith, hoa-manager,
rwbp-website, mezmo_benchmark, se-ai-command-pack, sd-github-review, anomaly-metric-creator.
The first three are sequential canaries; the next four form a bounded post-canary cohort with
concurrency two; anomaly-metric-creator is a solo final cohort because its CI feedback loop is
materially slower.

## Requirements

- Install the discovery descriptor and the durable `sd-review.yml` workflow into each manifest
  repository through the existing `sd-ai-command-pack` fleet-refresh mechanism. Do not
  hand-place files; a hand-placed lane is what made the pilot look deployed while the
  installer shipped nothing.
- Respect the manifest's rollout order and cohort policy: canaries strictly sequential, the
  post-canary cohort at concurrency two, anomaly-metric-creator last and alone.
- Open one smoke pull request per repository and confirm the `sd-github-review/receipt` Check
  Run is published against it.
- Stop the rollout on the first canary that fails to produce a receipt, and record what failed
  before continuing.

## Acceptance Criteria

- [ ] All 8 manifest repositories contain `config/routed-review-setup-v1.json` and
      .github/workflows/sd-review.yml, both installer-produced.
- [ ] A probe run in each of the 8 returns a state other than
      `absent`/`setup-descriptor-absent`.
- [ ] Each of the 8 has one smoke pull request on which the `sd-github-review/receipt` Check
      Run appears, with the run URL recorded per repository.
- [ ] Every installed descriptor pins the same first-party SHA as the current release.
- [ ] Any repository that failed is reported with its failure, not silently skipped.

## Notes

2026-08-09: Both prerequisites below are closed and archived — `08-08-installer-durable-lane`
and `08-09-descriptor-contract-path`. The `blockedOn` marker was stale and has been cleared;
the sequencing rationale is retained for context. Execution still mutates eight external
repositories and opens a pull request in each, which is outside the autonomous work-loop's
run-level authority and requires explicit approval for that scope.

Sequence after `08-08-installer-durable-lane`. Until the installer actually emits the
descriptor and the `sd-review.yml` lane, a rollout would have nothing to roll out, and
reproducing the pilot's hand-placement would recreate exactly the undetectable drift this task
exists to close.

`sd-github-review` appears in the manifest as a consumer of the command pack as well as being
the router. Its own rollout depends on the descriptor relocation in
`08-08-installer-durable-lane`; until the published descriptor moves off the consumer
discovery path, the router self-matches as an installed consumer.
