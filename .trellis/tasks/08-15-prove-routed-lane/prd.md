# Prove the routed lane runs, then retire the direct-request hook

## Goal

Establish that the durable routed-review lane installed by
`08-15-remote-review-channel-authority` actually executes and produces a real
receipt, and only then stop the competing `PostToolUse` hook from firing.

This is the second half of that task, split out because neither half can be
verified from the same pull request. It carries that task's two remaining
acceptance criteria verbatim.

## Background

PR #85 installed this repository as a consumer of its own Action: the setup
descriptor at `config/routed-review-setup-v1.json`, the event-driven
`ai-review-router.yml` lane, and the durable `sd-review.yml` lane.

The event-driven lane is proven — it executed three times on that pull request,
and its first run exposed a real billing defect. The durable lane is **not**
proven, and could not be: `scripts/sd-ai-command-pack-review.py:1152` dispatches
with `--ref <default branch>`, and GitHub only fires a `workflow_dispatch`
against a ref that already contains the workflow. Worse, the capability probe
reads workflow metadata through the Actions API, which only knows workflows on
the default branch, so on PR #85 it reported

```
routerCapability: {state: unavailable, reason: "... gh: Not Found (HTTP 404)"}
```

and `unavailable` fails closed. That pull request completed review only with an
explicit `remote=none`, recorded rather than papered over.

Now that it has merged, the lane exists on `main` and the probe should resolve.
Whether it does is the open question this task answers.

## Requirements

- The first pull request opened after the install must exercise the durable
  lane through `sd-review scope=pr`, with no `remote=none` escape.
- If the lane does not work, stop rather than work around it. A direct reviewer
  request is forbidden by `sd-review/SKILL.md:14-16` and is not an acceptable
  substitute. `08-15-remote-review-channel-authority`'s `design.md` names
  option 3 as the fallback, which is an upstream change, not a local one.
- The `PostToolUse` hook is retired only after a real receipt exists. Until
  then the overlap between the two channels is deliberate: it is the only
  remote review this repository actually gets.
- The hook edit lives in `~/.claude/settings.json`, outside this repository, and
  is the operator's to make.

## Acceptance criteria

- [ ] `sd-review scope=pr` on a post-install pull request reports
      `routerCapability.state: ready` — not `absent`, not `unavailable`.
- [ ] A `workflow_dispatch` run of `.github/workflows/sd-review.yml` appears,
      and a durable receipt Check Run named `sd-github-review/receipt` is
      published.
- [ ] The selected route is `copilot` and the reviewer request comes from the
      Action (`src/index.js:265-272`), not from the `PostToolUse` hook.
- [ ] `limitations` no longer contains `router-not-configured` or
      `zero-remote-confidence`.
- [ ] **Inherited:** the losing contract no longer fires in this repository, by
      configuration rather than by convention.
- [ ] **Inherited:** a PR shipped after the change reports a remote-review state
      that matches what reviewed it — either a router receipt with real remote
      confidence, or an explicit, recorded local-only limitation with no
      side-channel review happening behind it.

## Notes

Whether PR-Agent is ever invoked, and whether the OpenRouter key sits unused, is
worth recording but is not a gate. With `REVIEW_ROUTE_MODE=copilot` on the event
lane and `independent-review-floor: copilot` on the durable one, the expectation
is that it is never billed again — but that expectation has been wrong once
already on this pair of lanes, so record what happens rather than assuming.

Out of scope: rolling the lane out to the eight fleet consumers. That is
`08-08-fleet-rollout-smoke`, and it — not this task — is what satisfies the
parked v2-governance tasks' resume condition.
