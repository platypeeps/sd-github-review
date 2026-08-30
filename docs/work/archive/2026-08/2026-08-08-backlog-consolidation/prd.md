---
title: Consolidate the Trellis backlog to the thin-v1-core direction
status: done
created: 2026-08-08
---
# Consolidate the Trellis backlog to the thin-v1-core direction

## Goal

Record and execute the owner-directed backlog consolidation of 2026-08-08 that reduces the
active Trellis backlog from 38 tasks to 21: keep 1, park 16, drop 21, and create 3 new
distribution-focused tasks plus this consolidation record.

## Problem

The backlog encodes a v2 governance programme the repository never shipped, while the actual
blocker is distribution of the v1 core that already works.

Evidence gathered on 2026-08-08 in this repository:

- `npm test` reports `tests 595 / pass 595 / fail 0`. The shipped v1 core is correct.
- Eight modules — `src/protocol-v2.js`, `src/retention-policy.js`, `src/review-budget-ledger.js`,
  `src/review-candidate-catalog.js`, `src/review-deferred-recovery.js`,
  `src/review-plan-authorization.js`, `src/review-usage-reconciliation.js`, and
  `src/routed-review-compiler.js` — total 9,390 lines of the 13,136 lines under `src/` (71%)
  and are unreachable from the Action entrypoint `src/index.js`. A transitive relative-import
  walk from `src/index.js` reaches 11 of the 19 modules in `src/`; these eight are the
  remainder. The 07-25 v2-governance wave specifies exactly this unreachable surface.
- The discovery descriptor `config/routed-review-setup-v1.json` exists as an *installation*
  in no repository at all: across the 19 local `platypeeps` checkouts the only copy is the
  router's own published artifact in `sd-github-review`. Seven of the eight manifest consumers
  therefore probe `{"state":"absent","reason":"setup-descriptor-absent"}`; the eighth is
  `sd-github-review` itself, which self-matches its published descriptor rather than reporting
  absent — a distinct defect, not a deployment. Either way the routed lane runs nowhere.

Owner direction, 2026-08-08: keep the working v1 core thin, park or drop v2 governance, and
ship a minimal durable lane to the fleet.

## Disposition

### Keep unchanged (1)

| Task |
| --- |
| `08-07-deterministic-gates-router-defaults` |

### Park (16)

Parked tasks keep their content unchanged apart from two things: the `task.json` title and the
`prd.md` H1 gain a `PARKED: ` prefix, and the three parked tasks that parented a dropped task
lose those child entries as part of the boundary unlink below. These are well-defined v2 or
boundary work items, recoverable verbatim if the v2 direction revives.

| Task |
| --- |
| `07-25-budget-aware-review-degradation` |
| `07-25-deliver-routed-review-configuration` |
| `07-25-compile-and-execute-budget-aware-review-plans` |
| `07-25-finalize-budget-review-evidence` |
| `07-25-integrate-authorized-review-adapters` |
| `07-25-integrate-copilot-review-adapter` |
| `07-25-integrate-pr-agent-review-adapter` |
| `07-25-cheap-review-cost-controls` |
| `07-25-bound-cheap-review-token-usage` |
| `07-25-reduce-cheap-review-prompt` |
| `07-25-enforce-cheap-provider-cost-policy` |
| `07-25-support-local-attested-reviews` |
| `07-25-ingest-local-review-attestations` |
| `07-25-project-local-review-assurance` |
| `07-25-support-standalone-review-mode` |
| `08-04-define-v2-receipt-and-identity-contracts` |

### Drop as rejected (20)

Removed with `git rm -r`, not archived: archiving force-sets `status=completed`, which would be
false. Git history preserves the full content of every dropped directory.

| Task | Cluster |
| --- | --- |
| `07-25-scaffold-routed-review-source` | routed-config promotion |
| `07-25-migrate-routed-review-configuration-v2` | routed-config promotion |
| `07-25-manage-compiled-review-configuration-promotion` | routed-config promotion |
| `07-25-define-consumer-review-control-plane` | control-plane stores |
| `07-25-define-finding-adjudication-evidence-store` | control-plane stores |
| `07-25-govern-cheap-review-fallbacks` | provider failover governance |
| `07-25-qualify-cheap-review-candidates` | provider failover governance |
| `07-25-enforce-same-model-provider-failover` | provider failover governance |
| `07-25-evaluate-cheap-provider-failover-pilot` | provider failover governance |
| `07-25-control-cheap-review-reasoning-effort` | provider failover governance |
| `07-25-configurable-parallel-reviewers` | parallel reviewer quorum |
| `07-25-reserve-parallel-review-budgets` | parallel reviewer quorum |
| `07-25-orchestrate-parallel-review-dispatch` | parallel reviewer quorum |
| `07-25-aggregate-parallel-review-assurance` | parallel reviewer quorum |
| `07-25-report-parallel-review-evidence` | parallel reviewer quorum |
| `07-25-establish-trusted-finding-adjudication` | finding adjudication |
| `07-25-define-finding-adjudication-contract` | finding adjudication |
| `07-25-implement-trusted-finding-adjudication-workflow` | finding adjudication |
| `07-25-publish-finding-adjudication-evidence` | finding adjudication |
| `08-06-deep-freeze-v2-contract-outputs` | v2 contract freeze |

Rationale: this is governance elaboration for a solo-operator eight-repository fleet. Parallel
reviewer quorum mathematics, adjudication trust models that presume a second party, provider
failover governance across a single OpenRouter key, and promotion pipelines for configurations
no repository has installed all model coordination problems this deployment does not have.

### Drop as relocated (1)

| Task | Destination |
| --- | --- |
| `08-05-fix-review-coordinator-env-isolation` | sd-ai-command-pack, as .trellis/tasks/08-08-review-coordinator-env-isolation |

The review-coordinator environment isolation defect is a bug in the command pack, not in this
Action. It was filed in the wrong repository and has been recreated in `sd-ai-command-pack`;
the work is not cancelled, only relocated.

### Create (4)

| Task | Priority |
| --- | --- |
| `08-08-backlog-consolidation` (this record) | P1 |
| `08-08-release-v0-3-0-pin-freshness` | P1 |
| `08-08-installer-durable-lane` | P1 |
| `08-08-fleet-rollout-smoke` | P2 |

## Requirements

- Unlink every parent/child edge that would cross the survivor/dropped boundary before any
  directory is removed, enumerating the edges from the filesystem rather than from assumption.
- Remove dropped directories with `git rm -r`. Do not use `task.py archive`.
- Prefix parked titles in both `task.json` and `prd.md`. Beyond that prefix, the only permitted
  edit to a parked task is removing a `children` entry naming a dropped task, which the
  boundary unlink above requires; make no other edit.
- Give each created task a non-empty `task.json` description and a `prd.md` that cites the
  evidence above rather than restating the direction.
- Correct the `base_branch` of every created task to `main`. Trellis 0.6.7 seeds `base_branch`
  from the checked-out branch at creation time, which is the consolidation branch here.

## Acceptance Criteria

- [ ] `node scripts/sd-ai-command-pack-review-preflight.mjs` reports 0 failures.
- [ ] A topology scan over every active `task.json` finds no `parent`, `children`, or
      `subtasks` entry naming a directory removed by this consolidation.
- [ ] `.trellis/tasks` contains exactly 21 active task directories excluding `archive`.
- [ ] All 16 parked tasks have a title beginning `PARKED: ` in both `task.json` and `prd.md`.
- [ ] All 21 dropped directories are absent from the working tree.
- [ ] The 3 new non-record tasks each have a non-empty description and an evidence-citing
      `prd.md`.
- [ ] `git diff --name-only main` touches only `.trellis/` paths.

## Notes

Six surviving-parent to dropped-child edges were unlinked before removal:
`07-25-budget-aware-review-degradation` to `07-25-define-consumer-review-control-plane`;
`07-25-cheap-review-cost-controls` to `07-25-govern-cheap-review-fallbacks` and to
`07-25-control-cheap-review-reasoning-effort`; and `07-25-deliver-routed-review-configuration`
to `07-25-scaffold-routed-review-source`, `07-25-migrate-routed-review-configuration-v2`, and
`07-25-manage-compiled-review-configuration-promotion`. The scan found no dropped-parent to
surviving-child edges.

Five child references on surviving tasks point into `.trellis/tasks/archive` rather than at an
active directory — `07-25-define-budget-review-v2-contracts`,
`07-25-compile-routed-review-configuration`, `07-25-authorize-budget-aware-review-plans`,
`07-25-define-local-review-attestation-contracts`, and
`07-26-route-high-risk-to-external-reviewer`. All five resolve to completed archived tasks,
predate this consolidation, and are left untouched.
