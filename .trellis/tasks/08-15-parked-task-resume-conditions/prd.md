# Record machine-readable resume conditions on the 17 parked backlog tasks

## Goal

Make every parked task state what would unpark it, in a field the backlog
ranker reads, with a verification recipe the next sweep can run.

## Problem

Seventeen of the eighteen active tasks that predate this one are parked; only
`08-08-fleet-rollout-smoke` is actionable. Sixteen of the seventeen carry
**only** a `PARKED:` title prefix: no `blocked`, no `blockedOn`, empty `notes`,
and no park rationale anywhere in `prd.md` beyond the same prefix echoed in its
H1. Their rationale exists in exactly one place —
the message of merged commit `e2872da` ("consolidate Trellis backlog 38 -> 21
tasks (thin v1 core)", PR #60, 2026-08-08), which parked all sixteen in one
change — fifteen from the 07-25 wave plus
`08-04-define-v2-receipt-and-identity-contracts`, which the message's "07-25
wave" phrasing does not name but which belongs to the same v2-governance scope:

> The 07-25 v2-governance wave specifies 9,390 of 13,136 lines under `src/`
> (71%) that are unreachable from the Action entrypoint `src/index.js`, while
> npm test is 595 passing / 0 failing: the shipped v1 core is correct and the
> real blocker is distribution.

Two concrete costs, both observed:

- `work-loop rank` reports `blockedReason: "parked"` for all sixteen. That is
  the literal fallback at `scripts/sd-ai-command-pack-work-loop.py:868` —
  `return True, reason_text or "parked"` — reached when a candidate matches the
  `PARKED:` prefix and supplies no `blockedReason`/`blockedOn`. It carries no
  information, so a backlog report cannot distinguish a deliberate scope park
  from a dependency block. The helper reads those fields off the candidate
  entry, which the inventory step builds from `task.json`, so `task.json` is
  where the reason has to live for `rank` to surface it.
- Answering "is this park still valid?" required reading git history to find
  the parking commit. A sweep should not be archaeology.

The seventeenth, `08-09-review-gate-advisory-convergence`, has the opposite
defect: it has a `blockedOn`, and that `blockedOn` is now **wrong**. It says the
task "resumes on a pack refresh carrying a category-aware gate", but the
rebuttal channel half already arrived — `--local-disposition '<id>=rebutted'`
exists (`scripts/sd-ai-command-pack-review.py:1790`) and
`scripts/sd-ai-command-pack-review-local.py:1956` gates on `outstanding` only,
so rebutted findings no longer block. Three of that task's four requirements are
met; only the severity/category requirement remains.

This is the same defect class the `08-09-review-coordinator-stale-check` closure
named in `.trellis/spec/backend/directory-structure.md`: a park is only as good
as the resume condition someone can re-check. That rule tells a future session
to re-verify; these sixteen records give it nothing to verify against.

## Requirements

- Every parked task records a resume condition in `blockedOn`, the field the
  ranker surfaces as `blockedReason`.
- Each resume condition names how to falsify it — the command or artifact that
  proves the park still holds — not just prose.
- `08-09-review-gate-advisory-convergence`'s `blockedOn` is corrected to say the
  rebuttal channel landed and only the category-aware gate remains.
- No task is unparked by this change. The sweep that produced it verified all
  sixteen premises still hold; this is a bookkeeping correction, not a
  re-prioritization.
- The `PARKED:` title prefixes stay. They remain the carrier the convention
  documents; `blockedOn` supplies the reason the prefix cannot.

## Acceptance Criteria

- [x] All 17 parked `task.json` records have a non-empty `blockedOn`.
      Verified: `rank` reports 17 blocked candidates, none with an empty reason.
- [x] A `work-loop rank` over an inventory built from those records reports a
      specific `blockedReason` for each of the 17 — no candidate still reports
      the bare fallback `parked`.
      Verified: bare-`parked` count went 16 (at `9dbed23`) to 0.
- [x] That same `rank` reports every one of the 17 still `blocked: true`, and
      `08-08-fleet-rollout-smoke` still the only actionable candidate among the
      pre-existing tasks: nothing was unparked. `actionableCount` is 2 while
      this task is open — itself plus fleet-rollout-smoke — and returns to 1
      once this task archives.
      Verified: `blocked` count 17, actionable ids exactly
      `08-15-parked-task-resume-conditions` and `08-08-fleet-rollout-smoke`.
- [x] `08-09-review-gate-advisory-convergence`'s `blockedOn` names the shipped
      rebuttal channel and the outstanding severity/category gate.
      Verified: its `blockedOn` contains both `--local-disposition` and the
      severity-or-category gap, with file:line evidence for each.
- [x] Each of the 16 scope-park records cites `e2872da` and the two checks that
      falsify it: reachability from `src/index.js`, and probes of the consumer
      repositories for `config/routed-review-setup-v1.json` — a path in those
      repositories, not in this one.
      Verified: 16 records checked, none missing a required citation.

## Verification evidence gathered 2026-08-15

Both premises behind the sixteen-task park were re-derived, not assumed:

- Reachability, by walking `import`/`export ... from` edges from
  `src/index.js`: 3,746 of 13,136 lines reachable (28%), **9,390 unreachable
  (71%) across 8 files** — `protocol-v2.js`, `retention-policy.js`,
  `review-deferred-recovery.js`, `review-budget-ledger.js`,
  `review-candidate-catalog.js`, `review-plan-authorization.js`,
  `review-usage-reconciliation.js`, `routed-review-compiler.js`. Identical to
  the figure in `e2872da`; `src/` is still exactly 13,136 lines.
- Distribution, probed in the consumer repositories rather than here — neither
  path is expected to exist in this repository: `rwbp-coordinator`,
  `loadsmith`, `hoa-manager`, and `anomaly-metric-creator` each return 404 for
  a routed-review setup config under their `config/` and for an `sd-review`
  workflow under their `.github/workflows/`. Zero consumers deployed.

Upstream `08-07-local-finding-rebuttal-channel` is still `PARKED:` with all five
acceptance criteria unchecked even though its functionality shipped, so upstream
task status is not a trustworthy signal for the seventeenth record. Verify
against the vendored file instead.

## Out of scope

- Unparking anything, including `08-09-review-gate-advisory-convergence`.
- Fixing upstream's own stale task record.
- The `08-08-fleet-rollout-smoke` authority question.

## Notes

Lightweight: seventeen uniform metadata edits under `.trellis/tasks/`, no code,
no contracts, no cross-layer surface. PRD-only per the workflow's lightweight
path.
