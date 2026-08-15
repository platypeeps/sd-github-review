# PARKED: Gate `task.py start` on curated context manifests

## Goal

Make the manifest ready gate that `workflow.md` already states actually refuse
a `task.py start` that violates it.

## Problem

`.trellis/workflow.md:424` states the rule plainly:

> Ready gate: both `implement.jsonl` and `check.jsonl` must contain at least one
> real `{"file": "...", "reason": "..."}` entry before `task.py start`. The seed
> `_example` row alone is not ready.

Nothing enforces it. `task.py start` accepts a task whose manifests hold only
the seed row, and the preflight's context-file check passes them too — its own
message calls a lone untouched `_example` scaffold "exempt (advisory/unfilled)",
which is correct for a task nobody has started and wrong for one that has been.

Observed on PR #81, 2026-08-15: `task.py start` ran against seed-only manifests
and the run reached remote review before anything objected. Copilot caught it,
on both files. A rule stated in the workflow and enforced by nothing is a rule
that gets found by a reviewer instead of a gate — and only when a reviewer
happens to look.

The gap is narrow and the signal is unambiguous: task status is `in_progress`
or later, and a manifest contains no row without an `_example` key. Both facts
are already on disk at the moment `task.py start` writes the status.

## Requirements

- A deterministic check refuses to leave a task started when either manifest
  lacks a real entry. Refusing inside `task.py start` is preferable to catching
  it afterwards, because the point is to stop the state from existing.
- The check keys on task status, not on the file alone. An unstarted task's
  seed row stays exempt — that is the scaffold working as intended, and the
  current advisory exemption must survive for `planning` tasks.
- The diagnostic names both the offending file and the rule, so the fix is
  obvious without reading `workflow.md`.
- Existing started tasks with seed-only manifests, if any remain, are reported
  rather than silently failing an unrelated run.

## Acceptance Criteria

- [ ] Starting a task whose manifests hold only the seed row fails, and the
      diagnostic names the file and the ready gate.
- [ ] Starting a task with one real entry in each manifest succeeds unchanged.
- [ ] A `planning` task with seed-only manifests still passes every check —
      the advisory exemption is preserved, not deleted.
- [ ] The upstream change ships with test coverage for all three cases above.
- [ ] This repository consumes the behavior through a pack refresh, with the
      install audit reporting a pristine payload.

## Why this is parked

The enforcing code belongs to the vendored pack, not this repository.
`scripts/sd-ai-command-pack-review-preflight.mjs` and the Trellis
`task.py` surface are both installed copies; `pack.install-audit` fails any
local edit and the next refresh would overwrite it. Per
`.trellis/spec/backend/directory-structure.md`, change pack behavior upstream
and consume it through a refresh.

Filing the upstream change is outside this run's authority — an upstream
Trellis pull request needs explicit approval for that PR.

## Out of scope

- Editing any vendored `scripts/sd-ai-command-pack-*` path in this repository.
- Widening the check into general task-metadata validation. This is one rule
  that `workflow.md` already states; a broader gate is separate work.
- Retroactively auditing archived tasks.
