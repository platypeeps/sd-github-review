# Invoke the seeded-task gate before starting a Trellis task

## Goal

Run the manifest ready gate that already exists, at the moment it is meant to
run.

## Problem

`.trellis/workflow.md:424` states the rule:

> Ready gate: both `implement.jsonl` and `check.jsonl` must contain at least one
> real `{"file": "...", "reason": "..."}` entry before `task.py start`. The seed
> `_example` row alone is not ready.

The enforcing check **already exists** in the installed pack.
`scripts/sd-ai-command-pack-review-preflight.mjs:617` accepts a `seeded-task`
command whose entire purpose is this rule. Verified in both directions on
2026-08-15 against the installed copy:

```bash
node scripts/sd-ai-command-pack-review-preflight.mjs seeded-task \
  --task-dir .trellis/tasks/08-04-define-v2-receipt-and-identity-contracts --json
# status: invalid
#   task_context_seed | .../implement.jsonl | line 1 contains a generated _example scaffold row
#   task_context_seed | .../check.jsonl     | line 1 contains a generated _example scaffold row

node scripts/sd-ai-command-pack-review-preflight.mjs seeded-task \
  --task-dir .trellis/tasks/08-15-task-manifest-ready-gate --json
# status: valid
```

Nothing in this repository ever invokes it. A repo-wide search for
`seeded-task` across `.claude/`, `.agents/`, `scripts/`, and `.trellis/` returns
one hit, and it is prose in an archived task's PRD describing the feature. No
skill, script, or workflow step calls the command.

That is the whole defect. The plain preflight deliberately exempts a lone
untouched `_example` scaffold — the upstream source records why at
`review-preflight.mjs:1016-1023`: gating the exemption on `status === 'planning'`
was tried and reverted because it produced a late, merge-time failure on
completion. The `seeded-task` command is that decision's other half, moving the
check to task-start time where an unfilled manifest is unambiguously the defect.
This repository adopted the half that exempts and never wired up the half that
enforces.

Cost, observed twice in one session: PR #81 started a task against seed-only
manifests and reached remote review before Copilot caught it; PR #82 then filed
two follow-up tasks with the same defect, caught again by review rather than by
a gate.

## Requirements

- `seeded-task` runs against a task directory before or at `task.py start`, and
  a nonzero result stops the start rather than being reported after the fact.
- The invocation lives where the start actually happens, so it cannot be skipped
  by using a different entry point into the same action.
- The failure message points at the manifests and the ready gate. The command's
  own findings already do this (`task_context_seed`, `task_context_unfilled`);
  the wiring should not restate them.
- A `planning` task that nobody has started is unaffected. The plain preflight's
  scaffold exemption stays exactly as it is — this task adds a gate at start
  time, it does not touch merge-time behavior.

## Acceptance Criteria

- [ ] Starting a task whose manifests hold only the seed row is refused, and the
      output names the offending files.
- [ ] Starting a task with one real entry in each manifest proceeds unchanged.
- [ ] The plain `node scripts/sd-ai-command-pack-review-preflight.mjs` run still
      exempts an untouched lone scaffold on an unstarted task — verified against
      a `planning` task that has one.
- [ ] A repo-wide search for `seeded-task` returns a real invocation, not only
      prose.

## Non-goals

- Editing any vendored `scripts/sd-ai-command-pack-*` path. The gate is already
  there; this task calls it.
- Changing the plain preflight's merge-time exemption. That exemption is a
  deliberate upstream decision with its rationale recorded in the source, and
  re-litigating it is how this rule ended up unenforced the first time.
- Retroactively auditing archived tasks.

## Provenance

Filed from PR #81 as a parked task blocked on an upstream change, on the
assumption that no gate existed. That assumption was wrong and was corrected
before merge: the gate shipped upstream some time ago and is present in the
installed copy. The task is unparked and repo-local.

Worth recording because the session that filed it had just shipped the rule
against exactly this mistake — verify a park against the vendored file, not
against an assumption about what the pack does or does not contain. The rule was
written and then immediately broken by its own author, one task later. Checking
cost two commands.
