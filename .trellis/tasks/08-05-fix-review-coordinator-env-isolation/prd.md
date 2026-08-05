# Fix sd-review coordinator subprocess env-isolation KB/scope false-positive

## Goal

Eliminate the recurring false-positive in `scripts/sd-ai-command-pack-review.py`
where the coordinator's nested `_run_check` / gh-fetch subprocess observes stale
`.obsidian-kb` state and an unreadable PR body, failing `knowledge.obsidian-kb`
and `pack.review-scope` even though the same checks pass exit 0 when invoked
directly.

## Background

Observed twice (obs 35854 during PR #41, and again during PR #45 /
`07-25-define-review-data-retention-policy`). The coordinator subprocess sees a
phantom stale KB manifest count (e.g. 525 vs disk 528) and cannot read the PR
body, so `sd-ai-command-pack-check.py --repo . --json` reports failures inside
the coordinator that do not reproduce under a direct invocation. Operators have
had to hand-verify green gates and proceed to merge, which defeats the point of
the automated coordinator gate.

## Requirements

- Diagnose why the nested subprocess environment diverges from the parent:
  working directory, `.gitignore`d KB path visibility, env var propagation, or
  a cached manifest read.
- Make the coordinator's nested check see the same on-disk KB and PR-body state
  the direct invocation sees, so `knowledge.obsidian-kb` and
  `pack.review-scope` pass or fail identically regardless of nesting depth.
- Do not weaken either check: the fix must remove the false-positive without
  suppressing a genuine stale-KB or missing-scope failure.

## Acceptance Criteria

- [ ] Root cause of the subprocess/direct divergence is identified and recorded.
- [ ] A regression test (or hermetic self-test) reproduces the nested-context
      divergence before the fix and passes after it.
- [ ] Coordinator-nested `knowledge.obsidian-kb` and `pack.review-scope` results
      match direct-invocation results for the same repository state.
- [ ] A deliberately stale KB or missing PR-scope section still fails the gate
      (no regression in detection).

## Out of Scope

- Redesigning the KB refresh helper or the review-scope contract itself.
- Changing merge-gate or housekeeping behavior.
