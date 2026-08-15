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
when that file does not exist. It does not exist here.

The absence is deliberate, and that is the finding this task turned on. See
**Investigation** below: the descriptor was moved *off* that path on purpose,
so authoring one back onto it is not the cheap fix it appears to be.

## Investigation (2026-08-15)

### The path collision is resolved, and it resolves against the obvious route

`contract/` and `config/` hold the same schema in opposite roles. `DESIGN.md:201-206`:

> `contract/` is where this repository publishes the reference descriptor;
> `config/routed-review-setup-v1.json` is the single path setup discovery probes
> in the repository being classified. The two are deliberately different: a
> reference copy on the probe path would make this repository classify itself as
> having the durable lane installed.

That separation shipped as `08-09-descriptor-contract-path` (PR #68) to fix this
repository self-matching its own published artifact. Verified: `contract/routed-review-setup-v1.json`
is present, `config/` does not exist at all.

So "author `config/routed-review-setup-v1.json`" — the leading candidate before
this investigation — would re-create the defect that task removed. The only
honest version of it is a real consumer installation, where the lane it
advertises actually exists.

### What a real installation costs

`scripts/consumer-installer/plan.mjs:148-150` hard-requires the secret, with no
copilot-only exemption; `install --dry-run` exits 1 before it will even plan:

```
Error: PR_AGENT_MODEL_API_KEY is missing; rerun with --set-secret or pipe it to --secret-stdin
```

A read-only `install-consumer.mjs check` enumerates the full resource set: four
files, five `review:*` labels, three variables (`openrouter`,
`qwen3-coder-30b-a3b-instruct` cheap, `kimi-k2.6` deep), and
`PR_AGENT_MODEL_API_KEY`. `design.md` lists the file paths, since none of them
exists in this repository yet and only a forward-looking artifact may name a
path that does not resolve. `check` omits two of the four only because
`consumer-installer.mjs:421` is `if (!recorded) continue` and no manifest exists
yet — expected, not a gap.

### Two premises that would have sunk the install were checked and hold

- **The pinned action reference is current.** `v0.3.0` (Latest) resolves to
  `744a9f138bba7c`, byte-identical to the descriptor's `actionReference`, and
  `scripts/validate-action-metadata.mjs:616` fails the always-on gate on
  staleness. The earlier concern came from `08-08-release-v0-3-0-pin-freshness`,
  which shipped and moved the pin off v0.1.0.
- **The durable lane exists and is installable.** `examples/sd-review.yml` is
  present and least-privilege — `contents: read` by default, `checks: write`
  only on the receipt-writing jobs, never on the third-party reviewer job.
  `DURABLE_MANAGED_RESOURCES` covers the descriptor and the durable workflow
  with a collision guard that refuses on differing bytes and adopts identical
  ones.

### The lane can express the guarantee the hook currently provides

`examples/sd-review.yml` takes an `independent-review-floor` input over
`[none, cheap, deep, copilot]`, and `src/index.js:265-272` shows the `copilot`
route requesting `copilot-pull-request-reviewer[bot]` — the same reviewer the
hook requests by hand, but dispatched through the sanctioned path with a durable
receipt (`sd-github-review/receipt`). The floor turns "a Copilot review always
happens" from a side channel into repository policy.

### What remains unverified

**This Action has never run in any repository.** The evidence above establishes
that it is installable and internally coherent, not that it executes
successfully. Only an installation proves that, and this repository would be the
first. Related: if the floor is set to `copilot`, PR-Agent may never be invoked,
so the OpenRouter key could sit unused — also unprovable without running it.

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

1. **Install this repository as a consumer of its own Action, then scope the
   hook out.** Not "author a descriptor" — that was the pre-investigation
   framing and it is wrong. Run `install-consumer.mjs install`, which writes the
   descriptor *and* the lane it advertises. The router becomes present and
   sd-review dispatches Copilot through its own path with a durable receipt.

   Two steps, not one, and the second is not optional. The hook is a
   `PostToolUse` matcher on `Bash` that re-evaluates after *every* push whose
   output shows it reached a remote, so "the router already requested Copilot"
   is a race the hook wins whenever a push lands after the PR exists and before
   sd-review dispatches. Leaving it on satisfies no acceptance criterion below —
   it fires and self-suppresses, which is convention, not configuration.
   Option 2 is therefore the closing step of this route, gated on a first
   observed receipt.

   Recommended, with two caveats that are not this task's to resolve alone: it
   requires a `PR_AGENT_MODEL_API_KEY` the operator must supply, and it makes
   this repository the first repository ever to run the Action.

   It does **not** unpark the sixteen v2-governance tasks. Their shared
   `blockedOn` requires "v1 is actually distributed to **fleet consumers** AND
   the v2-governance scope is deliberately revalidated as still wanted; a
   distribution fix alone does not unpark it", and its falsification probe names
   external repositories. Self-installation is a first execution datapoint, not
   fleet distribution.
2. **Scope the hook out of pack-managed repositories.** Edit
   `~/.claude/settings.json` so the hook does not fire where `sd-review` owns
   the lifecycle. Cheapest, and it makes reporting honest immediately — but it
   removes the reviewer that found real defects on PRs #81, #82, and #83 while
   the local lane found none, and it leaves the router dark. Not to be done
   alone.
3. **Relax sd-review's prohibition.** Upstream change to the vendored skill,
   permitting a direct request when the router is `absent`. Keeps the review
   that works and matches the rule to practice, but weakens a safety rule to
   legitimize a workaround for a router nobody has switched on. The reasonable
   fallback if option 1's secret is refused, not a first choice.

## Acceptance Criteria

- [ ] A recorded decision names the owning contract and the reason, in a place
      a future session reads before shipping — a spec, not a commit message.
- [ ] The losing contract no longer fires in this repository, by configuration
      rather than by convention.
- [ ] A PR shipped after the change reports a remote-review state that matches
      what reviewed it: either a router receipt with real remote confidence, or
      an explicit, recorded local-only limitation with no side-channel review
      happening behind it.
- [x] If the descriptor route is taken, the relationship between this
      repository's own descriptor and the consumer-facing artifact of the same
      path is documented, and neither shadows the other. Answered during
      planning: they are the same schema in opposite roles, separated
      deliberately by `08-09-descriptor-contract-path`, and `DESIGN.md:201-206`
      already documents it. The route was rewritten to a real installation
      accordingly, so nothing shadows anything — the file only appears at
      `config/` when the lane it advertises exists.
- [ ] Whichever route is chosen, the reason the other two were rejected is
      recorded where a future session reads it, so this is not re-litigated from
      the same starting assumptions.

## Notes

Complex: touches the review lifecycle contract and spans a user-global config
file this repository does not own. This is not a PRD-only task — `design.md`
and `implement.md` must both exist before `task.py start`. `design.md` was
written alongside this update; `implement.md` is still missing, so the task
remains unstarted by design rather than by oversight.

The descriptor collision that blocked design is settled — see **Investigation**.
What blocks implementation now is a decision, not a question: the operator picks
a route, and option 1 additionally requires a secret only they can supply.

Two steps stay outside this repository whichever route wins. The user-global
hook edit lives in `~/.claude/settings.json`, and `PR_AGENT_MODEL_API_KEY` is
set through `gh secret set` by the operator. The task records both as handoffs
rather than claiming them.
