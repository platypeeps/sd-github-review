---
title: Resume installer updates interrupted before workflow replacement (A-013)
status: done
created: 2026-08-04
---
# Resume installer updates interrupted before workflow replacement (A-013)

## Goal

Close audit finding A-013 so an installer `install`/`update` that was
interrupted mid-transaction (pending manifest written, workflow not yet
replaced) can resume on rerun instead of failing as if an operator modified the
managed workflow.

## Audit Finding

- ID: A-013 · severity P2 · effort M (reassessed S) · confidence Plausible · dimension correctness
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: An interrupted update can leave pending state that cannot resume.
  Installer-owned interrupted state is indistinguishable from operator drift.

## Evidence Boundary

The update sequence in `scripts/consumer-installer.mjs` `installOrUpdate`
(current lines 981-988) is, in order:

1. `atomicWrite` manifest `state: "pending"` — records the **new**
   `workflow.sha256` (`templateSha`).
2. `atomicWrite` workflow = new `templateSource`.
3. `applyRemoteActions` (GitHub mutations).
4. `atomicWrite` manifest `state: "active"`.

If the process dies between step 1 and step 2, the pending manifest holds the
**new** hash while the on-disk workflow is still the **old** content. On rerun,
`assertWorkflowCanBeManaged` (current lines 789-796) computes
`sha256(local.workflow) !== local.manifest.workflow.sha256` and throws
`.github/workflows/pr-agent-router.yml was modified after installation; preserve
or reconcile it manually before update`. That guard exists to protect an
**active** install from clobbering operator edits, but it also fires for a
**pending** (mid-transaction) manifest, so recovery is impossible.

Confirmed on main @ HEAD (2026-08-04): step 2 (`installOrUpdate`) rewrites the
workflow unconditionally, so for a pending manifest any on-disk workflow content
is about to be overwritten regardless — the strict equality guard serves no
protective purpose in the pending state and only blocks resume.

## Requirements

- A rerun of `install`/`update` against a `pending` manifest whose on-disk
  workflow hash does not match the manifest's recorded hash MUST resume (rewrite
  the workflow to the current template and reach `active`), not throw.
- An `active` manifest whose on-disk workflow hash does not match the recorded
  hash MUST still throw the modification error (operator-drift protection is
  unchanged).
- The `uninstalling` guard and the `active`-with-missing-workflow guard are
  unchanged.
- No manifest schema change; recovery relies on the existing `state` field.

## Acceptance Criteria

- [x] A test proves: an update interrupted before workflow replacement (pending
      manifest recording the new hash, old workflow on disk) resumes on rerun —
      manifest ends `active`, on-disk workflow equals the new template.
      (`test/consumer-installer.test.js` "resumes an update interrupted before
      the workflow was replaced (A-013)".)
- [x] A test proves: an `active` manifest with an operator-modified workflow
      still throws `modified after installation` (guard not over-broadened).
      (`test/consumer-installer.test.js` "active install still rejects an
      operator-modified workflow (A-013 lock)".)
- [x] Full suite green (baseline 227/227 → 229/229 with 2 new tests).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-013 set to fixed after verification; owner
      reassigned to this dedicated child.

## Out of Scope

- Reworking the update transaction into a staged/journaled two-phase commit
  (the audit's alternative "stage artifacts" suggestion); scoping the guard to
  active state satisfies the resume requirement with no schema change.
- `adopt` command flow (separate command; its pending state resumes through the
  same guard once this fix lands, and is covered by existing adopt tests).
