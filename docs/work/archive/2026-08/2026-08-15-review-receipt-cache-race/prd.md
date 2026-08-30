---
title: Fix the routed-review receipt cache race in the command pack
status: done
created: 2026-08-15
---
# Fix the routed-review receipt cache race in the command pack

## Goal

Make `sd-review` able to observe a routed review finishing. Today it caches the
durable receipt while the dispatch is still in flight and never re-reads it, so
every routed review in a working repository ends at
`remote-reconciliation-required` regardless of how many times it is rerun.

This is an upstream change to the SD AI command pack. `scripts/sd-ai-command-pack-*`
is vendored here and `pack.install-audit` fails any local edit, so nothing in
this repository is the fix.

## Background

Observed on PR #86 of `platypeeps/sd-github-review`, reproduced at two heads
with two independent dispatches.

The durable lane publishes its receipt Check Run when the route step begins,
with `dispatch.phase: "started"`, then rewrites it about three seconds later
with `dispatch.phase: "observed"` and a `completedAt`. Measured twice:
`21:51:30.633Z` to `21:51:34.172Z`, and `22:03:16.347Z` to `22:03:19.403Z`.

The coordinator polls inside that window and stores what it finds:

- `~/.agents/bin/sd-ai-command-pack-review.py:2133` — the receipt is queried only
  `if state.get("remoteReceipt") is None`, so a stored receipt is never
  refreshed.
- `:2153` — `_advance(state_path, state, "receipt", remoteReceipt=receipt)`
  persists whatever the poll saw, including a non-terminal receipt.
- `:2159-2166` — a cached receipt whose `dispatch.phase` is `started` returns
  `indeterminate` with `remote-reconciliation-required`.
- `:2095` — the only branch that re-queries an existing receipt is the
  dispatch-*failure* path (`phase == "reconciliation-required"`), which this
  case never enters.

The result is a wedged attempt rather than a pending one: rerunning the same
attempt, as `sd-review/SKILL.md` correctly instructs, replays the cache forever.

There is no supported escape, which is worth stating because the obvious one
looks like it should work. Passing a fresh `--artifact-root` does find the
receipt — `logicalDispatchId` is stable across controller state — but then fails
with `durable receipt does not contain the current correlation id`, because the
correlation id is generated per controller state and lives only in the state a
fresh root discards. That failure is correct; it is also a dead end.

## Requirements

- Treat a cached receipt whose dispatch phase is non-terminal the same as a
  missing one: re-query it. The natural place is the existing poll loop at
  `:2134-2145`, so a receipt that becomes terminal within the poll budget is
  observed in the same invocation.
- Keep the fail-closed behaviour intact. A receipt that is still non-terminal
  when the poll budget is exhausted must still report
  `remote-reconciliation-required`; this task removes a permanent wedge, not the
  diagnostic.
- Do not widen receipt matching. `external_id == logicalDispatchId` plus the
  correlation-id check are what make a resume idempotent, and the multiple-match
  guard must stay an error.
- A resume must remain idempotent: re-querying a receipt must never dispatch
  again.

## Acceptance criteria

- [ ] A routed review whose receipt is first observed at
      `dispatch.phase: "started"` reaches a terminal state within the same or a
      subsequent invocation of the unchanged attempt.
- [ ] A receipt that never becomes terminal still reports
      `remote-reconciliation-required` and never falls back to a direct request.
- [ ] Re-querying never triggers a second dispatch for the same
      `logicalDispatchId`.
- [ ] Regression coverage for the started-then-observed transition, driven by
      the real two-write shape the lane produces rather than a single terminal
      write.

## Notes

The consumer-side evidence is recorded in
`.trellis/spec/backend/consumer-installer.md`, "The routed lane works; the
client cannot observe it finishing". Until this ships, routed reviews in this
repository end at `remote-reconciliation-required` and that limitation is
reported rather than worked around.
