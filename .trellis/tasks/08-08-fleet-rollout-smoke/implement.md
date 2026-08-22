# Implement — fleet rollout smoke

## Preconditions (all must hold before step 1)

- [x] Route mode chosen for each of the eight undeployed consumers: **`copilot` for all eight**
      (owner decision, 2026-08-22; revised from `auto` on the billing finding below).
      `sd-github-review` keeps its existing `copilot` install. Pass `--route-mode copilot`
      explicitly on every install; do not rely on an ambient `REVIEW_ROUTE_MODE` variable.
- [ ] `PR_AGENT_MODEL_API_KEY` available to pipe via `--secret-stdin`. **Required for every
      install regardless of route mode** — verified 2026-08-22 that `--route-mode none` is
      refused identically, and that `planResources` (`plan.mjs:118`) never consults `routeMode`
      when deciding the secret gate at line 148. See the open question below before supplying it.
- [ ] Explicit owner approval for the external-repo scope: nine repositories mutated, nine pull
      requests opened, GitHub variables/labels/secrets set in each.
- [ ] `npm run check:full` green in this repository — the installer being rolled out is the
      code under test.
- [ ] Every consumer checkout clean. A dirty checkout is skipped and reported, never
      force-installed over.

## Rollout log

Maintain `research/rollout-log.json` in this task directory, appended after every consumer.
One record per consumer: name, cohort, route mode, `check` state before, command run, descriptor
SHA after, smoke PR URL, receipt Check Run URL, outcome. This file is the evidence for the
acceptance criteria; a criterion with no log record is unmet.

## Step 1 — canary 1: rwbp-coordinator (sequential, stop-on-fail)

- [ ] `node scripts/install-consumer.mjs check --repo <path>` — record prior state; expect
      `absent`/`setup-descriptor-absent`
- [ ] `install --route-mode <mode>` for that consumer
- [ ] Verify both files present and installer-produced
- [ ] Open smoke PR
- [ ] Confirm `sd-github-review/receipt` Check Run appears on the PR head; record URL
- [ ] Append log record

**Gate.** If the receipt does not appear, stop the entire rollout. Record the failure and
whether it is attributable to `mode: thin`. Do not start canary 2.

## Step 2 — canaries 2 and 3, strictly sequential

- [ ] `loadsmith` — same sequence as step 1, full stop-on-fail
- [ ] `hoa-manager` — same sequence

**Gate.** All three canaries green before any post-canary work.

## Step 3 — post-canary cohort, max concurrency 2

- [ ] `rwbp-website`
- [ ] `mezmo_benchmark`
- [ ] `se-ai-command-pack`
- [ ] `sd-github-review` — **already installed**: run `check` to confirm, do not `install`;
      still open a smoke PR and confirm its receipt

Concurrency ceiling is two. On failure the failing consumer stops, in-flight peers finish, the
next cohort does not start.

## Step 4 — final cohort, sequential

- [ ] `people-profiles`
- [ ] `anomaly-metric-creator` — slower CI feedback loop; allow for it rather than treating a
      slow receipt as a missing one

## Step 5 — verification

Run the same probe used to write the PRD, expanded to use `check` rather than file existence:

- [ ] `check` in all 9 returns a non-absent state — **9/9, not 8/9**
- [ ] All 9 carry both `config/routed-review-setup-v1.json` and `.github/workflows/sd-review.yml`
- [ ] All 9 have a recorded smoke PR with a recorded `sd-github-review/receipt` run URL
- [ ] All 9 installed descriptors pin the same first-party SHA as the current release —
      compare pairwise, do not spot-check one
- [ ] All 9 local manifests record the route mode used
- [ ] Failures, if any, are listed explicitly with their failure text

The count check is not ceremonial. The prior PRD revision said 8; a verification that counts to
8 and stops passes while leaving a repository unrolled.

## Rollback points

- After any single consumer: `uninstall --repo <path>` reverses local files, local manifest, and
  remote actions. Close the smoke PR unmerged.
- After a cohort: consumers are independent; roll back only the affected ones.
- Whole rollout: uninstall in reverse manifest order. `sd-github-review` was installed before
  this task and must **not** be uninstalled by a rollback of it.

## Out of scope

- Merging any smoke PR
- Modifying `docs/fleet/consumers.json`
- Changing the consumer installer or the descriptor/workflow sources
- Converting any consumer between thin and fat
