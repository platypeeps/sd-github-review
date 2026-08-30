---
title: Confirm PR-Agent publishes under the reduced grant on a live durable-lane run
status: planning
created: 2026-08-23
---
# Confirm PR-Agent publishes under the reduced grant on a live durable-lane run

**Parked. Do not start without owner approval under `docs/RELEASE_CHECKLIST.md` §2.**

## Where this came from

`08-23-pr-agent-durable-issues-permission` removed `issues: write` from all
eight lane occurrences and rolled the reduced grant to 9 of 9 consumers. Four of
its five acceptance criteria were met. The fourth was not, and was closed
**unmet rather than waived**:

> A live run on the durable lane at `cheap` or `deep` confirms PR-Agent still
> publishes with the reduced grant.

That parent task's Phase 5 was written to satisfy it and never opened, because
owner approval was not given. This task carries the criterion forward intact.

## What is and is not already settled

**Settled, by direct probe** (`platypeeps/sd-github-review-pilot`, runs
`32623601322` and `32623799937`): a GitHub Actions token holding
`contents: read` + `pull-requests: write` and **no** `issues: write` can post a
PR conversation comment, apply a label, list comments, add a reaction, read
issue events, and update a comment — all against a pull request. On a pull
request, `pull-requests: write` covers the `/repos/{o}/{r}/issues/...` REST
paths; the `/issues/` prefix is REST layout, not the permission scope.

**Not settled**: what PR-Agent's own container does under that grant. The probe
answers what the *token permits*. It does not prove PR-Agent's publish path
succeeds end to end — it may read a scope it never exercises, fail closed on a
preflight, or degrade silently. Do not mark this criterion met from the probes.

## Why it is parked rather than urgent

The change is inert for the fleet as installed. All nine consumers run
`REVIEW_ROUTE_MODE=copilot` with `REVIEW_INDEPENDENT_FLOOR=copilot`, so `cheap`
and `deep` are unreachable and the `pr-agent` job cannot execute anywhere. The
residual is recorded in `CHANGELOG.md` under 0.6.1 for whoever moves a consumer
off `copilot`.

**This task becomes live work the moment any consumer moves off `copilot`.**
That is the trigger to unpark it.

## Cost

Requires owner approval under `docs/RELEASE_CHECKLIST.md` §2 and real provider
spend — reaching `cheap` is what makes spend possible. Be deliberate about the
route variables.

## Requirements

Carried verbatim from the parent's Phase 5 checklist:

- Bring `platypeeps/sd-github-review-pilot` to the released lane. Its
  `sd-review.yml` is pinned to `f6b5388d` in an older single-job shape with a
  top-level `issues: write` and no isolated `pr-agent` job — it cannot exercise
  the isolation as shipped.
- Set the pilot's `REVIEW_ROUTE_MODE` and `REVIEW_INDEPENDENT_FLOOR` so `cheap`
  is reachable.
- Confirm `ai-review-router.yml.disabled` stays disabled before opening the
  smoke pull request, and afterwards verify it has no run newer than the
  pilot's first. §2 calls that the check worth quoting.
- Dispatch `route` with an explicit `route: "cheap"`. Observe whether
  PR-Agent's conversation comment posts under the reduced grant.

## Acceptance criteria

- [ ] Owner approval under `docs/RELEASE_CHECKLIST.md` §2 is recorded before any
      step runs.
- [ ] The pilot runs the released lane shape — isolated `pr-agent` job, current
      pin, zero `issues: write` — verified from its default branch, not from the
      install run.
- [ ] `ai-review-router.yml.disabled` has no run newer than the pilot's first,
      quoted from the run list.
- [ ] A `route: "cheap"` dispatch on the durable lane produces a PR-Agent
      conversation comment visible on the pull request.
- [ ] The outcome is recorded against the parent's fourth criterion — met, or
      unmet with the reason. Never met from the probes alone.

## Out of scope

- Re-litigating the permission question. It is settled; see the probes.
- Changing PR-Agent's invocation, pinned digest, or model configuration.
- Moving any production consumer off `copilot` to create the trigger.
