# Reconcile the two contracts that both claim remote-review authority

## Goal

One answer to "what performs remote review on a PR in this repository", with
both contracts agreeing on it.

## Problem

Two instructions govern remote review here and they contradict each other.

The user-global `PostToolUse` hook in `~/.claude/settings.json` fires after
every push and says: if the branch has an open PR and no Copilot review has
been requested, request one with
`gh api --method POST repos/<owner>/<repo>/pulls/<N>/requested_reviewers`,
poll it, and report what it finds.

`.agents/skills/sd-review/SKILL.md:14-16` says the opposite:

> This successor is self-contained. Never call, alias, or fall back to
> `sd-review-pr`, a direct Copilot request, or a backend command found in
> configuration or a receipt.

and its safety rules repeat it: "Never use a direct reviewer fallback."

Both fired on PR #81. The coordinator returned `ready` with
`routerCapability: {state: absent, reason: setup-descriptor-absent}` and
limitations `router-not-configured`, `zero-remote-confidence` — it completed on
local evidence alone, which it is permitted to do when routing is optional and
the local receipt is clean. The hook then requested Copilot, which found a real
defect the local lane had missed: a task started against seed-only context
manifests.

That is the uncomfortable part. The channel the skill forbids is the channel
that caught the bug, and the sanctioned channel is dark. `zero-remote-confidence`
is an honest self-report — sd-review knows it reviewed nothing remotely — but a
run that reports `ready` while a forbidden side channel does the real work is a
lifecycle that cannot be reasoned about.

### Why the router is absent

`scripts/sd-ai-command-pack-review.py:31` sets
`DEFAULT_DESCRIPTOR_PATH = Path("config/routed-review-setup-v1.json")`, and
`:866-868` returns `{"state": "absent", "reason": "setup-descriptor-absent"}`
when that file does not exist. It does not exist here. So the absence is not a
failure or a misconfiguration — nobody has ever authored the descriptor for
this repository.

Note the collision worth flagging during design: that same path is what the
sixteen parked v2-governance tasks probe consumer repositories for. This
repository ships the routed-review setup as a consumer-facing artifact while
having none of its own. Whether those two uses are the same descriptor or
merely the same filename is a question this task must answer before proposing
the descriptor route, not assume.

## Requirements

- Decide which contract owns remote review for this repository. The options are
  not symmetric and the design must say why the chosen one wins.
- Make the losing contract stop firing, rather than leaving it to be overridden
  by judgment on each run. A rule that is routinely disobeyed is worse than no
  rule.
- Whatever is chosen, a run's reported review state must match what actually
  reviewed the code. No more `ready` plus `zero-remote-confidence` alongside a
  real review nobody's receipt records.
- If the descriptor route is chosen, resolve the naming collision with the
  consumer-facing artifact explicitly.

## Candidate resolutions

1. **Author `config/routed-review-setup-v1.json` for this repository.** The
   router becomes present, sd-review dispatches Copilot through its own
   sanctioned path with a durable receipt, and the hook's condition ("no Copilot
   review has been requested") stops matching because the router already
   requested one. Both contracts then agree without either being edited. This is
   the leading candidate and the only one fully actionable inside this
   repository — but it must clear the naming collision above.
2. **Scope the hook out of pack-managed repositories.** Edit
   `~/.claude/settings.json` so the hook does not fire where `sd-review` owns
   the lifecycle. Cheap, but it removes the review that has been catching things
   and leaves the router dark, so it should not be done alone.
3. **Relax sd-review's prohibition.** Upstream change to the vendored skill,
   permitting a direct request when the router is `absent`. Weakens a safety
   rule to match practice; needs a strong argument that the rule is wrong rather
   than the configuration.

## Acceptance Criteria

- [ ] A recorded decision names the owning contract and the reason, in a place
      a future session reads before shipping — a spec, not a commit message.
- [ ] The losing contract no longer fires in this repository, by configuration
      rather than by convention.
- [ ] A PR shipped after the change reports a remote-review state that matches
      what reviewed it: either a router receipt with real remote confidence, or
      an explicit, recorded local-only limitation with no side-channel review
      happening behind it.
- [ ] If the descriptor route is taken, the relationship between this
      repository's own descriptor and the consumer-facing artifact of the same
      path is documented, and neither shadows the other.

## Notes

Complex: touches the review lifecycle contract, spans a user-global config file
this repository does not own, and has a design question (the descriptor
collision) that must be settled before implementation. This is not a PRD-only
task — `design.md` and `implement.md` must be written during planning, before
`task.py start`. Neither exists yet; the task has not been started.

The user-global hook edit is outside this repository. Whichever option is
chosen, that step is the user's to make; the task records it as a handoff
rather than claiming it.
