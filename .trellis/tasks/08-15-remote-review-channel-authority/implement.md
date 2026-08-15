# Implementation — install this repository as a routed-review consumer

Route chosen by the operator on 2026-08-15: **option 1**, with the secret
supplied by them. `design.md` holds the reasoning and the rejection rationale
for options 2 and 3; this document is the ordered execution plan.

## The sequencing constraint that shapes everything below

`scripts/sd-ai-command-pack-review.py:1152` resolves `default_ref =
_default_branch(repo)` and dispatches with `--ref <default_ref>`. A
`workflow_dispatch` only fires against a ref that already contains the workflow
file, so **the routed lane cannot be exercised on the pull request that adds
it**. The install must be merged to `main` first.

That splits the work into two pull requests, and the split is not optional:

- **PR A — install.** Phases 0 through 4. Still reports
  `routerCapability: absent` on its own review, because `config/` and the lane
  land in the same commit that is being reviewed. This is expected, not a
  failure, and must not be treated as evidence the install is broken.
- **PR B — proof and closeout.** Phases 5 through 7, on any following branch.
  This is the first PR whose review can actually route.

Phase 6 is gated on Phase 5 producing a real receipt. Until then the
`PostToolUse` hook stays on and the overlap is deliberate.

## Phase 0 — set the review floor in the template (PR A)

The pack never sends `independent-review-floor`:
`scripts/sd-ai-command-pack-review.py:1160-1166`
dispatches exactly `operation=route`, `review-request`, and
`rerequest-authorized=false`. The installed workflow's default therefore decides
every routed review, and it must be right *before* the install, because editing
the installed copy afterwards makes it differ from its recorded hash — which
`.trellis/spec/backend/consumer-installer.md:215` says causes the installer to
"preserve operator edit and refuse update/uninstall", destroying the rollback in
Phase 4.

Both templates, not one. The install writes two lanes, and the event-driven one
fires on every pull-request event with no floor at all, which is where PR-Agent
spend would come from.

- [ ] `examples/sd-review.yml:24` — `default: none` becomes `default: copilot`.
- [ ] `examples/pr-agent-router.yml` — add an explicit
      `independent-review-floor: copilot` input. Without it the lane falls
      through to `action.yml:58` `default: none`, and `src/index.js:124` runs
      PR-Agent on the `cheap` and `deep` routes.
- [ ] Confirm nothing pins the input block. `test/installer-modules.test.js:206-215`
      compares only the template's `name:` against `descriptor.workflow.name`;
      the inputs are not asserted.
- [ ] Blast radius is empty today: zero fleet consumers have the descriptor
      installed (all four probed repos 404, re-verified 2026-08-15), so no
      deployed consumer inherits this default.

Rollback: revert one line.

## Phase 1 — the secret (operator handoff, PR A)

The agent never sees, stores, echoes, or passes this value. Setting it first —
rather than through `install --set-secret` — is deliberate: once the secret
exists, `plan.mjs:146` finds `secretExists` true and every later command,
including `--dry-run`, runs without any secret flag at all.

- [ ] **Operator runs, not the agent:**
      `gh secret set PR_AGENT_MODEL_API_KEY --repo platypeeps/sd-github-review`
- [ ] Verify presence without reading the value:
      `gh secret list --repo platypeeps/sd-github-review | grep PR_AGENT_MODEL_API_KEY`

Rollback: `gh secret delete PR_AGENT_MODEL_API_KEY`.

## Phase 2 — dry run (PR A)

- [ ] `node scripts/install-consumer.mjs install --dry-run`

`--target` is omitted throughout: it defaults to the current directory
(`codecs.mjs:422`), which is this repository.

Gate — stop and report if the plan proposes anything outside this set:

- four files: `.github/sd-github-review.json`,
  `.github/workflows/ai-review-router.yml`, `.github/workflows/sd-review.yml`,
  `config/routed-review-setup-v1.json`
- five labels: `review:auto`, `review:cheap`, `review:deep`, `review:copilot`,
  `review:none`
- three variables: `PR_AGENT_MODEL_PROVIDER=openrouter`,
  `CHEAP_REVIEW_MODEL=openrouter/qwen/qwen3-coder-30b-a3b-instruct`,
  `DEEP_REVIEW_MODEL=openrouter/moonshotai/kimi-k2.6`

## Phase 3 — install (PR A)

- [ ] `node scripts/install-consumer.mjs install`
- [ ] `node scripts/install-consumer.mjs check` — expect manifest schema 3 and
      every resource recorded.
- [ ] `diff contract/routed-review-setup-v1.json config/routed-review-setup-v1.json`
      — must be empty.
- [ ] `diff examples/sd-review.yml .github/workflows/sd-review.yml` — must be
      empty.

Gate: either diff being non-empty stops the phase. A managed file that differs
from its source is exactly the operator-edit state that refuses
`update`/`uninstall`, so a rollback would no longer be available.

## Phase 4 — prove the repository's own gates still pass (PR A)

This is where `design.md`'s blast-radius claims stop being static reasoning and
get executed.

- [ ] `bash scripts/sd-ai-command-pack-toolchain.sh run -- npm test`
- [ ] `node scripts/validate-action-metadata.mjs`
- [ ] `node scripts/validate-ci-parity.mjs`
- [ ] `node scripts/sd-ai-command-pack-review-preflight.mjs`

Expected: unchanged pass counts, 0 failures. `validate-ci-parity.mjs:73` reads
`ci.yml` by explicit path rather than scanning the directory, so the two new
workflows should not register at all; if parity fails, that premise was wrong
and the phase stops.

Rollback point for everything above:
`node scripts/install-consumer.mjs uninstall --yes`.

Then ship PR A through `sd-ship until=merge`.

## Phase 5 — prove the lane actually runs (PR B) — the decisive gate

The premise `design.md` flags as unverified: **this Action has never executed in
any repository.** Phase 5 is the experiment that settles it.

- [ ] On a branch created after PR A merges, run `sd-review scope=pr`.
- [ ] Expect `routerCapability.state: ready` — not `absent`, and not
      `setup-descriptor-absent`.
- [ ] Expect a `workflow_dispatch` run of `.github/workflows/sd-review.yml`.
- [ ] Expect a durable receipt Check Run named `sd-github-review/receipt`.
- [ ] Expect the route to be `copilot` and the reviewer request to come from the
      Action (`src/index.js:265-272`), not from the `PostToolUse` hook.
- [ ] Expect `limitations` to no longer contain `router-not-configured` or
      `zero-remote-confidence`.

Gate: if the dispatch fails, the receipt never appears, or the route is not
`copilot`, **stop and do not work around it**. Capture the workflow run log,
uninstall, and reopen the route decision — `design.md` names option 3 as the
fallback. A direct reviewer request is forbidden here by
`sd-review/SKILL.md:14-16` and is not an acceptable substitute for a working
lane.

Secondary observation, not a gate: with the floor at `copilot`, PR-Agent may
never be invoked and the OpenRouter key may sit unused. Record what actually
happens rather than assuming either way.

## Phase 6 — scope the hook out (PR B, gated on Phase 5)

Only after a real receipt exists. This is the closing step that makes the losing
contract stop firing by configuration rather than convention, which is what
`prd.md`'s second acceptance criterion asks for.

- [ ] **Operator edits `~/.claude/settings.json`**, outside this repository and
      never by the agent: restrict the `PostToolUse`/`Bash` Copilot-request hook
      so it does not fire in repositories that carry
      `config/routed-review-setup-v1.json`.
- [ ] Verify on the next pull request: the hook stays silent, and the routed
      receipt is the only remote-review evidence.

Rollback: revert the settings edit; the hook resumes and coverage is restored
immediately.

## Phase 7 — records and acceptance criteria (PR B)

- [ ] `.trellis/spec/backend/directory-structure.md` — the `.github/workflows/
      # repository CI only` annotation becomes false once two more workflows
      land. Update it, and add the installed `config/` entry alongside the
      existing `contract/` one so the pair is documented in the tree.
- [ ] Record the decision and why options 2 and 3 lost, in the spec rather than
      in a commit message. This is `prd.md`'s first and fifth acceptance
      criteria; a future session must be able to read it without digging
      through the task archive.
- [ ] Tick the remaining `prd.md` acceptance criteria against real evidence.

## Validation commands

| When | Command | Pass condition |
| --- | --- | --- |
| After Phase 0 | `npm test` | unchanged pass count |
| After Phase 1 | `gh secret list \| grep PR_AGENT_MODEL_API_KEY` | one row, value never printed |
| Phase 2 | `install --dry-run` | plan matches the expected resource set exactly |
| After Phase 3 | both `diff` commands | empty output |
| After Phase 3 | `install-consumer.mjs check` | manifest schema 3, all resources recorded |
| After Phase 4 | `validate-action-metadata.mjs`, `validate-ci-parity.mjs`, preflight | 0 failures |
| Phase 5 | `sd-review scope=pr` | `routerCapability.state: ready` + `sd-github-review/receipt` |

## Rollback points

| Point | Undo |
| --- | --- |
| Phase 0 | revert one line in `examples/sd-review.yml` |
| Phase 1 | `gh secret delete PR_AGENT_MODEL_API_KEY` |
| Phase 3–4 | `node scripts/install-consumer.mjs uninstall --yes` |
| Phase 5 fails | uninstall, then reopen the route decision at option 3 |
| Phase 6 | revert the `~/.claude/settings.json` edit |

The one state to avoid is a descriptor without its lane — that is the exact
defect `08-09-descriptor-contract-path` removed. After any rollback, verify both
`config/routed-review-setup-v1.json` and `.github/workflows/sd-review.yml` are
gone, not just one.

## Out of scope

- Rolling the lane out to the eight fleet consumers. That is
  `08-08-fleet-rollout-smoke`, and it — not this task — is what satisfies the
  sixteen v2-governance parks' resume condition.
- Any edit to `scripts/sd-ai-command-pack-*` or the vendored skills. Option 3
  would have needed an upstream pull request; option 1 does not.
