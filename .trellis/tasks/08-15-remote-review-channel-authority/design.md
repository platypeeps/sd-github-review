# Design — remote review channel authority

## Scope of this document

The route is not chosen yet; that decision is the operator's and one option
needs a secret only they can supply. This document designs option 1 in enough
detail to be implemented on approval, and states precisely what options 2 and 3
would take instead so a later session does not re-derive them.

Written after the investigation recorded in `prd.md`. The design question that
previously blocked this task — whether this repository's descriptor and the
consumer-facing artifact of the same path are one thing or two — is answered
there and is not reopened here.

## The defect, stated exactly

Review *quality* is not the problem. Copilot found real defects on PRs #81, #82
and #83; the local lane's `prism` produced 24 findings on #83 and every one was
false on inspection, and `gito` was clean. The problem is that the run's
reported state does not match what reviewed the code:

| What sd-review reports | What actually reviewed the PR |
| --- | --- |
| `status: ready` | Copilot, requested by a `PostToolUse` hook |
| `routerCapability: {state: absent, reason: setup-descriptor-absent}` | — |
| `limitations: [router-not-configured, zero-remote-confidence]` | — |

`zero-remote-confidence` is an honest self-report: sd-review knows it reviewed
nothing remotely. It is honest about its own lane and blind to the other one. A
lifecycle whose receipt omits the review that found the bugs cannot be reasoned
about, and no gate downstream can distinguish "reviewed and clean" from
"unreviewed and quiet".

So the deliverable is not "add a reviewer". It is **one recorded channel**.

## Boundaries and ownership

| Surface | Owner | This task may |
| --- | --- | --- |
| `scripts/sd-ai-command-pack-*` | vendored pack; `pack.install-audit` fails local edits | read only |
| `.agents/skills/sd-review/SKILL.md` | vendored pack | read only; option 3 is an upstream PR |
| `~/.claude/settings.json` | the operator, outside this repository | describe the edit; never make it |
| `PR_AGENT_MODEL_API_KEY` | the operator | never see, store, or echo it |
| `.github/**`, `config/**`, `.trellis/spec/**` | this repository | change |

The two rows the task cannot touch are why every option ends in a handoff.

## Option 1 — install this repository as a consumer

### Contract

After installation the repository holds an installed descriptor at
`config/routed-review-setup-v1.json` **and** the lane that descriptor
advertises at `.github/workflows/sd-review.yml`. The pairing is the whole point:
`08-09-descriptor-contract-path` removed a descriptor that promised a lane which
did not exist, and re-adding one without the lane would restore that defect
under a different name.

### Data flow

```
sd-review scope=pr
  -> probe config/routed-review-setup-v1.json
       (scripts/sd-ai-command-pack-review.py:31, :866-868)
  -> state: ready, not absent
  -> workflow_dispatch .github/workflows/sd-review.yml --ref main
       inputs sent: operation=route, review-request,
                    rerequest-authorized=false   <- these three, nothing else
       independent-review-floor: NOT sent; the workflow's own
                    default applies (see the floor section below)
  -> src/index.js:265-272 route=copilot
       -> request copilot-pull-request-reviewer[bot]
  -> durable receipt check "sd-github-review/receipt"
  -> sd-review records real remote confidence
```

### Why this needs a second step

The tempting claim is that the hook's condition — "no Copilot review has been
requested" — simply stops matching, because the router got there first, so both
contracts agree with neither edited. That is wrong, and the hook body says why.

It is a `PostToolUse` matcher on `Bash`. It greps the tool input for a `git
push` that is not a delete or a dry run, then greps the tool *output* for
evidence the push reached a remote, and only then emits its instruction. So it
re-arms on every push for the life of the branch. Under an sd-ship chain the
first push precedes PR creation and the hook no-ops ("If there is no PR, do
nothing"), and a push after sd-review has dispatched finds the request already
made. But a push landing after the PR exists and before Stage 2 dispatches hits
neither guard, and the hook wins.

Winning that race is not hypothetical — it is what happened on #81, #82 and #83.

So option 1 does not remove the conflict by itself; it makes the router the
first requester in the common path and leaves a race in the uncommon one. A rule
that self-suppresses most of the time is exactly the "resolved by judgment per
run" state this task exists to end, and `prd.md`'s second acceptance criterion
asks for configuration rather than convention. **Option 2 is the closing step of
this route**, applied once a receipt proves the router works. Until then the
overlap is deliberate belt-and-braces, not the end state.

### Configuration decision: the review floor

`examples/sd-review.yml` accepts `independent-review-floor` over
`[none, cheap, deep, copilot]`. Setting it to `copilot` reproduces exactly
today's effective guarantee — a Copilot review on every PR — as repository
policy rather than as a hook side effect. Any lower floor lets `auto` routing
decide, which would make some PRs locally-reviewed-only; that is a real change
in review coverage and should not ride along silently with a plumbing change.

**There is only one place that value can be set, and it is not the obvious
one.** The pack does not forward the input: `sd-ai-command-pack-review.py:1160-1166`
dispatches exactly `operation=route`, `review-request`, and
`rerequest-authorized=false`, and nothing else. So `sd-review` can never raise
the floor per run, and the installed workflow's own default decides every routed
review.

Editing the *installed* workflow to raise it is worse than doing nothing.
`.trellis/spec/backend/consumer-installer.md:215`: a managed durable workflow
that differs from its recorded hash makes the installer "preserve operator edit
and refuse update/uninstall". That would trade the floor for the rollback in the
section below — a bad trade, and a silent one.

**And there are two lanes, not one.** The install writes an event-driven
`ai-review-router.yml` alongside the durable lane, and it fires on every
`pull_request` `opened`/`synchronize`/`reopened`/`ready_for_review`/`labeled`.
Its template passed no floor at all, so it fell through to `action.yml:58`
`default: none` — and `src/index.js:124` sets `run-external-reviewer` true for
exactly the `cheap` and `deep` routes, which is PR-Agent billing the operator's
OpenRouter key. Setting the durable lane's floor alone would have left that lane
uncovered while the design claimed "repository policy", and the first evidence
would have been an invoice.

The floor is therefore a spend control as much as a coverage control, and it is
set on both templates: `examples/sd-review.yml:24` (the durable default) and
`examples/pr-agent-router.yml` (an explicit `independent-review-floor: copilot`
input). A `copilot` floor never reaches `cheap` or `deep`, so PR-Agent is never
invoked. The cost of that choice is real and was put to the operator: the
cheap/deep tier is now unreachable and the OpenRouter key stays unused.

Both must be set **before** the install, so each installed copy is
byte-identical to its source and stays managed. That is a change to the template every future consumer receives, which
is why it was put to the operator rather than assumed. They chose `copilot` on
2026-08-15. Two facts made it cheap: nothing pins the input block
(`test/installer-modules.test.js:206-215` asserts only the template's `name:`
against `descriptor.workflow.name`), and the blast radius is currently empty —
zero fleet consumers have the descriptor installed.

### Resources written

From a read-only `node scripts/install-consumer.mjs check`, plus the two
schema-3 durable resources it skips when no manifest exists yet
(`consumer-installer.mjs:422`, `if (!recorded) continue`). `--target` is
omitted throughout: it defaults to the current directory
(`codecs.mjs:422`), which is the target here.

- `.github/sd-github-review.json` — ownership manifest, schema 3
- `.github/workflows/ai-review-router.yml` — event-driven lane
- `.github/workflows/sd-review.yml` — durable lane
- `config/routed-review-setup-v1.json` — installed descriptor
- labels `review:auto`, `review:cheap`, `review:deep`, `review:copilot`, `review:none`
- variables `PR_AGENT_MODEL_PROVIDER=openrouter`,
  `CHEAP_REVIEW_MODEL=openrouter/qwen/qwen3-coder-30b-a3b-instruct`,
  `DEEP_REVIEW_MODEL=openrouter/moonshotai/kimi-k2.6`
- secret `PR_AGENT_MODEL_API_KEY`

### Secret handling

`plan.mjs:148-150` requires the secret with no copilot-only exemption; even
`--dry-run` refuses before planning. It is supplied by the operator through
`--set-secret` (which prompts via `gh secret set`) or `--secret-stdin`. The
agent never reads, stores, logs, or echoes it, and never passes it as a command
argument where it would land in shell history or a process list. If the operator
declines the secret, option 1 is closed and the fallback is option 3.

### Compatibility and blast radius

The installation is additive: it creates files and GitHub resources that do not
exist today and modifies none. Verified rather than assumed, because this is the
load-bearing safety claim:

- `.github/workflows/` holds only `ci.yml`, and `config/` does not exist, so
  neither new workflow nor the descriptor collides with anything.
- `scripts/validate-ci-parity.mjs:73` reads `.github/workflows/ci.yml` by
  explicit path, not by scanning the directory, so two new workflows cannot
  trip it.
- `scripts/validate-action-metadata.mjs:26` pins `contract/`, not `config/`, so
  the installed copy is outside its view.
- No test asserts that `config/routed-review-setup-v1.json` is absent from this
  repository; the installer tests all resolve `DESCRIPTOR_PATH` against a temp
  target.
- The installer carries no producer/self-install guard, so nothing refuses the
  operation on the grounds that this is the Action's own repository.

The descriptor's `actionReference` pins `744a9f138bba7c` = `v0.3.0` (Latest), and
`scripts/validate-action-metadata.mjs:616` fails the always-on gate if that ever
goes stale, so the installed pin cannot silently drift.

The one genuinely new exposure is the third-party reviewer job. The shipped
template already contains that boundary: default `permissions: contents: read`,
`checks: write` only on the receipt-writing jobs, and never on the `pr-agent`
job, so a compromised reviewer cannot forge a durable receipt. This design
inherits that and must not widen it.

### Rollback

`node scripts/install-consumer.mjs uninstall` removes the managed resources it
owns and, per the installer's ownership rules, preserves anything it recorded
as unowned. A
rollback that leaves the descriptor without the lane is the one state to avoid,
since that is the original defect; verify both are gone, not just one.

### The lane cannot be proven on the pull request that adds it

`sd-ai-command-pack-review.py:1152` resolves `default_ref =
_default_branch(repo)` and dispatches with `--ref <default_ref>`. GitHub only
fires a `workflow_dispatch` against a ref that already contains the workflow
file, so the routed lane is unreachable from the branch that installs it.

The install therefore lands in one pull request and the proof happens in the
next. The install PR will still report `routerCapability: absent` on its own
review — its `config/` descriptor and its lane exist only in the diff under
review — and that must not be read as the install having failed. `implement.md`
splits the phases along exactly this line.

### The unproven premise

This Action has never executed in any repository. The investigation established
that it is installable and internally coherent, not that a dispatch succeeds.
This repository would be the first consumer. That is a deliberate cost, and it
must be stated as a risk rather than assumed away.

It buys the first evidence that the Action executes at all, which is worth
having. It does **not** unpark the sixteen v2-governance tasks, and the design
should not be sold on that. Their shared `blockedOn` — re-verified 2026-08-15 —
requires that "v1 is actually distributed to **fleet consumers** AND the
v2-governance scope is deliberately revalidated as still wanted; a distribution
fix alone does not unpark it", and it falsifies itself by probing named external
repositories (`rwbp-coordinator`, `loadsmith`, `hoa-manager`,
`anomaly-metric-creator`), all of which still 404 for the descriptor.
Self-installation moves neither condition.

The mitigation is sequencing: install, dispatch once against a throwaway PR, and
confirm a receipt appears before the hook is scoped out. Until that receipt
exists, the hook stays on and the belt-and-braces overlap is deliberate.

## Option 2 — scope the hook out

One edit to `~/.claude/settings.json` restricting the `PostToolUse` hook so it
does not fire in pack-managed repositories. Nothing in this repository changes.

Honest immediately, and wrong on its own: it deletes the only reviewer that has
found real defects and leaves the router dark, converting a reporting defect
into a coverage gap. Its correct role is the *final step of option 1*, once a
durable receipt has been observed.

## Option 3 — relax the prohibition upstream

An upstream pull request against `sd-review`'s SKILL.md permitting a direct
reviewer request when `routerCapability.state` is `absent`, with the resulting
review recorded in the receipt so the reported state stays truthful.

Keeps the review that works and needs no secret. It weakens a safety rule whose
purpose is to stop review bypassing the router, in order to legitimize a
workaround for a router nobody switched on — treating the configuration problem
as a rule problem. Requires explicit operator approval for the upstream PR,
which run-level authority never covers.

Correct fallback if the secret is refused. Not a first choice.

## Rejected without further work

Leaving both contracts in place and resolving by judgment per run. A rule that
is routinely disobeyed is worse than no rule, and this session disobeyed it
three times in a row while believing it was following the workflow.

## Decisions, all settled 2026-08-15

1. **Route** — option 1. Install this repository as a consumer, then scope the
   hook out once a receipt proves the lane.
2. **Secret** — the operator supplies `PR_AGENT_MODEL_API_KEY` directly through
   `gh secret set`, before the install rather than through `--set-secret`, so
   every later command runs without a secret flag.
3. **Floor** — `copilot`, set in `examples/sd-review.yml:24` before installing,
   for the reasons in the floor section above.

`implement.md` exists now and carries the ordered plan. Nothing in this design
is blocked on a further decision; what remains unproven is empirical, and
Phase 5 is the experiment that settles it.
