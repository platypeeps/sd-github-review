---
title: Track the remote attempt number separately from the local review round counter
status: done
created: 2026-08-28
branch: task/08-28-review-dispatch-fixes
---
# Track the remote attempt number separately from the local review round counter

## Goal

The `sd-review` coordinator sends its local round counter as `request.attempt`.
The routed action rejects `attempt > 1` without a `rerequestOf`, so a pull
request whose local review took more than one round cannot dispatch at all. Two
counters measuring different things are being carried in one field.

## Context

Tracked upstream as platypeeps/sd-github-review#155.

Local rounds count fix-and-recheck cycles against local providers. The remote
attempt counts dispatches to the routed backend. Conflating them means local
iteration silently consumes the remote attempt budget, and the first remote
dispatch of a heavily-iterated pull request claims to be a re-request of a
remote attempt that never happened.

Reproduced on `platypeeps/se-ai-command-pack` PR #274. Local review ran six
rounds without converging (61 findings, then 72 largely non-overlapping). The
coordinator then dispatched with `--attempt 6`. Run 33065643137, `failure` in
9s:

```
Error: request.attempt above 1 requires request.rerequestOf identifying the prior attempt
    at normalizeReviewRequest (src/protocol.js:569:11)
```

That guard is now at `src/protocol.js:570` — the line moved after PR #157. The
dispatched request carried `"attempt": 6` and no `rerequestOf`, which was
correct: no remote attempt had ever been made.

The obvious workaround does not work. Re-invoking with `--attempt 1` does not
change the request, because the coordinator derives `request.attempt` from its
own stored per-head attempt state rather than from the CLI argument. Only a
fresh `--attempt-id` resets it, and that escape is documented as discarding the
attempt's local and remote review evidence — safe on this run because the local
stage had been skipped, destructive on a normal one.

The error compounds the confusion at the point of use: it names `rerequestOf`,
pointing the operator at re-request handling rather than at the counter that is
actually wrong.

## Requirements

- The remote attempt must increment only when a dispatch is actually made, so a
  first dispatch is `attempt: 1` however many local rounds preceded it.
- `rerequestOf` must be populated from the prior *remote* attempt when one
  exists.
- If the counters stay unified, the request must carry both and the action's
  `attempt > 1` check must key on the remote one. Pick one shape; do not leave
  the field ambiguous.
- The rejection message must name the counter that is wrong. An operator reading
  it should not be sent to re-request handling for a first dispatch.
- Recovery must not require `--attempt-id`. Discarding review evidence to fix a
  counter is not an acceptable standing workaround.

## Non-goals

- Changing what `--attempt-id` does or the evidence it discards. It stays the
  escape hatch for a genuinely fresh attempt.
- The routed action's `attempt > 1` policy itself. Requiring `rerequestOf` for a
  real re-request is correct; this task is about what feeds it.

## Acceptance Criteria

Split by owner. The counter itself is derived in the `sd-review` coordinator
(sd-ai-command-pack), tracked there as platypeeps/sd-ai-command-pack#589; this
repository owns the field's contract and the rejection. `design.md` records
the split and why no request-shape change is made here.

### This repository

- [x] `request.attempt` is documented as the remote dispatch counter — in
      `src/protocol.js` beside the guard, in `action.yml`'s `review-request`
      description, and in `DESIGN.md` — with one shape and no ambiguity.
- [x] The rejection for a real violation names the remote attempt counter and
      no longer sends the operator to re-request handling, proven by a test.
- [x] A genuine second remote dispatch (`attempt: 2` with `rerequestOf` for the
      first) still decodes, proven by a test.

### Coordinator half (parked on sd-ai-command-pack#589, not criteria of this task)

These outcomes belong to the coordinator and are tracked on
platypeeps/sd-ai-command-pack#589. They are recorded here so the split is
legible, not as acceptance criteria this task can satisfy; issue #155 stays
open until they land there.

- A pull request whose local review took more than one round dispatches on
  its first remote attempt as `attempt: 1`.
- A genuine second remote dispatch arrives as `attempt: 2` carrying
  `rerequestOf` for the first.
- Local rounds do not change the remote attempt number.
- No path requires `--attempt-id` to recover from a first dispatch.
- Issue #155 is closed once both halves have landed.

Live evidence for the coordinator defect, gathered while shipping this task:
the `sd-review` coordinator forwarded local round 5 as `request.attempt: 5`
for PR #164 and the routed run failed with the pre-fix rejection
(https://github.com/platypeeps/sd-github-review/actions/runs/33234657100);
recovery needed `--attempt 1 --attempt-id <fresh>`.
