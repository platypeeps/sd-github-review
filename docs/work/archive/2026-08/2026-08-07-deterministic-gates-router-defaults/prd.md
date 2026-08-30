---
title: Ship deterministic pre-routing gates and cost-biased router defaults
status: done
created: 2026-08-07
---
# Ship deterministic pre-routing gates and cost-biased router defaults

## Goal

Reduce the cost of automatic AI review by making the router's own defaults
prefer the cheaper `deep` backend over native Copilot for high-risk changes, and
by shipping examples that run free deterministic gates before any AI review
runs at all.

## Problem

Three cost leaks exist in the shipped router today.

1. `action.yml:81` defaults `high-risk-route: copilot` (`:78` is where the
   input block opens; `:81` is the `default:` line). Every pull request that
   touches a `sensitive-paths` glob, and every pull request at or above the
   `changed-line-threshold` (default `800`), selects native Copilot. A consumer
   who installs the generic profile and never sets the input pays Copilot for
   all structural-risk and large-diff pull requests. The shipped PR-Agent
   profiles already override this to `deep`
   (`SETUP-PR-AGENT.md:4`, `test/metadata.test.js:354-355`), so the expensive
   value is the default only for consumers who did not opt into a profile.
2. No shipped example wires deterministic jobs ahead of routing, even though
   `README.md` instructs consumers to "Keep deterministic test, lint,
   type-check, CodeQL, or Semgrep jobs ahead of routing with normal `needs`
   dependencies." Consumers who copy an example verbatim pay for AI review of
   pull requests that a free lint or type-check job would have rejected.
3. The router fully implements lowering an automatic route from local review
   evidence, and it is reachable from the Action — but only on the durable
   operations path, and nothing shipped demonstrates it. The standalone path
   (`src/index.js:254`, `routeReview`) has no local-evidence concept at all.
   The durable path (`src/operations.js:381`, `selectProtocolRoute`) reads
   `independent-review-floor`, `local-confidence-threshold`, and
   `local-evidence-route` at `src/operations.js:390-401`, and receives the
   `localReview` object inside the `review-request` JSON input
   (`action.yml:13`). `runOperation` decodes that input at
   `src/operations.js:539` and delegates; `src/protocol.js:538` decodes the
   `localReview` object itself; `src/router.js:161` evaluates it; and the
   resulting decision is consumed at `src/operations.js:405`. The call order is
   not the file order — `:539` sits below `:381`/`:405` because `runOperation`
   calls `runRouteAction`. No example or setup guide shows that payload, so the
   capability is undiscoverable in practice.

## Requirements

- R1. Change the `high-risk-route` default from `copilot` to `deep` in every
  place that declares it:
  - `action.yml:81` — the Action metadata default (`default: copilot`);
  - `src/index.js:249` — the standalone-path input fallback;
  - `src/operations.js:376` — the durable-path input fallback;
  - `src/protocol.js:969` — the `context.highRiskRoute ?? "copilot"` fallback;
  - `src/router.js:34` — the `routeReview` destructuring default.

  The list is stated as an enumeration rather than a count because an earlier
  draft of this PRD claimed there were two, having grepped only for the literal
  `high-risk-route`. This is a behavior change for every consumer that omits the
  input.
- R2. Update every document that states or implies the old default so no
  shipped text contradicts the new behavior.
- R3. Record the change in `CHANGELOG.md` as a `Changed` entry that names the
  behavior difference and the one-line migration for consumers who want the old
  behavior (`high-risk-route: copilot`).
- R4. Ship a cost-optimized example workflow whose **dependency structure** is
  real and executable: a separate gate job, and a routing job that reaches the
  Action only via `needs:` on that gate job. The gate job's commands are
  `run:` placeholders, because this repository cannot know a consumer's lint or
  test invocation. The load-bearing, verifiable part is the job graph, not the
  command text.
- R5. Document the existing local-review-evidence path accurately: the
  `localReview` object travels inside the `review-request` input
  (`action.yml:13`), is decoded at `src/protocol.js:538`, and is evaluated by
  `selectProtocolRoute` using the policy inputs read at
  `src/operations.js:390-401`. State plainly that this works on the durable
  operations path and **not** on the standalone path, so no example implies a
  standalone workflow can supply it.
- R6. Do not change route-selection **logic** anywhere. `routeReview` and
  `selectProtocolRoute` decide correctly given their inputs; only default values
  and shipped guidance change. Note this permits the one-token default edit at
  `src/router.js:34`, which an earlier draft wrongly forbade by banning the file
  outright.
- R7. Do not change any first-party Action reference SHA in an example. Pinning
  policy is owned by the release process, not by this task.

## Constraints

- The default is declared five times across three layers (metadata, two input
  fallbacks, two in-code fallbacks). They must change together or the layers
  disagree — production would take the `action.yml` value while every unit test
  took a JS fallback.
- Tests assert the old default on omitted input at
  `test/operations.test.js:588` and `test/protocol.test.js:502` in addition to
  the three in `test/action.test.js`. All five must be handled.
- `test/metadata.test.js:356-358` asserts that generic and pilot examples leave
  `high-risk-route` unset. Those assertions stay true; the behavior they imply
  changes. Any assertion that encodes the *value* of the generic default must
  be updated, not deleted.
- `scripts/validate-action-metadata.mjs` and `scripts/validate-ci-parity.mjs`
  gate the metadata and the CI/workflow parity. Both must pass unchanged.
- `scripts/validate-action-metadata.mjs:479-484` enumerates `examples/` with
  `readdir`, so a new example file is validated automatically with no
  registration step — and is subject to the same pinned-SHA rule as the
  existing examples.
- `test/metadata.test.js:137` asserts `result.exampleCount === 5`. Enumeration
  by `readdir` means the new example needs no registration, but this hard-coded
  count is not enumerated and must be bumped to `6` or `npm test` fails. AC4 and
  AC6 are therefore coupled: adding the example without touching this line
  leaves the suite red.
- `yaml@^2.9.0` is already a devDependency, so AC4's structural check parses the
  workflow rather than pattern-matching raw text. A regex cannot establish that
  the job carrying `needs:` is the same job that invokes the Action.
- There are **two** prose inventories of the examples, not one. `README.md`
  mentions individual examples in context, and `DESIGN.md:392-403` lists all
  five with descriptions. The validator enumerates `examples/` with `readdir`,
  so it will never catch a stale prose list. Both must be updated by hand.
- `README.md:86` states "Every checked-in first-party example uses that same
  released full SHA". The new example must use
  `8636a3983d18de17c49907a4c48170a61b1bb713`, which also satisfies R7.
- This is a minor version bump under SemVer: behavior changes without an API
  break. Version bumping itself is release-process work and is out of scope
  unless a validator requires it.

## Acceptance Criteria

- [ ] AC1. All five default sites read `deep`, verified by an enumerating
  search rather than by inspecting the files that were edited. The search must
  be **unquoted**: `action.yml:81` is `default: copilot` with no quotes, so a
  `'"copilot"'` pattern silently skips it.
  `grep -rn copilot src/ action.yml` returns no hit standing in a default or
  fallback position; every surviving hit is a description, an enum listing, or a
  validation message. `action.yml`'s description no longer implies Copilot is
  the default.
- [ ] AC2. No shipped document states or implies the old default. The check must
  search for the **behavior**, not the input name — the input name misses prose
  like "the generic high-risk default". Both of these return no stale claim:
  `grep -rn "high-risk-route" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md .trellis/spec/`
  and
  `grep -rni "generic.*default\|by default.*copilot\|default.*copilot" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md .trellis/spec/`.
  This explicitly includes the tracked contract at
  `.trellis/spec/backend/quality-guidelines.md:349`.
- [ ] AC3. `CHANGELOG.md` contains an Unreleased `### Changed` entry naming the
  default flip and the `high-risk-route: copilot` migration for consumers who
  want the previous behavior.
- [ ] AC4. A new example workflow exists in which the job that invokes the
  Action carries `needs:` on a gate job **that actually runs something**,
  verified structurally with the `yaml` devDependency: parse the workflow,
  locate the single job whose steps carry a `uses:` beginning
  `platypeeps/sd-github-review@`, and assert its `needs` contains `gates`, that
  every named job exists, that no named job invokes the Action, and that every
  named job has at least one step with a non-empty `run:`.

  The last clause is not decoration. A weaker predicate — non-empty `needs`
  plus "does not invoke the Action" — passes against a bare
  `prepare: {runs-on: ubuntu-latest}` with no steps, so the criterion would be
  satisfied by a workflow with no gate at all. Verified by running the weak
  predicate against exactly that shape: it printed `gate structure ok`.

  A visual read of the file, or a regex over raw text, does not satisfy this.
  `test/metadata.test.js:137` is bumped from `5` to `6`.
- [ ] AC9. `node scripts/sd-ai-command-pack-review-preflight.mjs` exits 0.
  It is currently a hard failure — `task.json field description must be a
  non-empty string` — and `git add -A` would otherwise commit the broken record.
  Run it before staging, not after.
- [ ] AC5. A documented section shows the actual payload path — `localReview`
  inside the `review-request` input (`action.yml:13`), decoded at
  `src/protocol.js:538`, evaluated by `selectProtocolRoute` with the policy
  inputs read at `src/operations.js:390-401` — including a concrete `localReview`
  JSON fragment, the three eligibility conditions, exact-head binding, and the
  fact that the standalone path ignores all of it.
- [ ] AC6. `npm test` passes with zero failures.
- [ ] AC7. `npm run check`, `npm run validate:metadata`, and
  `npm run validate:ci-parity` all pass.
- [ ] AC8. No route-selection logic changed and no Action reference SHA changed.
  `git diff --stat` cannot prove either — it reports filenames and line counts,
  not content. Use content checks:
  `git diff origin/main -- src/router.js` shows only the one-token default edit
  at line 34, and
  `git diff origin/main -- examples/ .github/ | grep -E '^[+-].*uses:.*platypeeps/sd-github-review'`
  shows only additions carrying the existing pinned SHA — no removals, and no
  new SHA value.

## Out of scope

- Changing `changed-line-threshold`, `sensitive-paths`, or `low-confidence-route`
  defaults.
- Changing the consumer installer's shipped PR-Agent profile, which already
  sets `high-risk-route: deep`.
- Any release, tag, or version bump.
- The user-global Claude Code hook that auto-requests Copilot on push. It lives
  in `~/.claude/settings.json`, belongs to no repository, and is reported
  separately.

## Adversarial review ledger

Three automatic rounds, the maximum the project contract permits.

| ID | Round | Concern | Disposition |
| --- | --- | --- | --- |
| C-1 | 1 | PRD named two default sites; there are five | Fixed — R1 enumerates all five |
| C-2 | 1 | Doc sweep named four sites; there are eight | Fixed — AC2 uses two searches |
| C-3 | 1 | R6/AC8 banned `src/router.js` outright, but `:34` holds a default | Fixed — ban narrowed to route-selection logic |
| C-4 | 1 | AC8 used `git diff --stat`, which cannot prove content | Fixed — replaced with content diffs |
| C-5 | 1 | Local-evidence inputs wrongly described as inert | Fixed — full payload path documented |
| C-6 | 2 | `grep '"copilot"'` misses unquoted `action.yml:81` | Fixed — pattern is unquoted |
| C-7 | 2 | One new test left two of three fallback paths unpinned | Fixed — one test per path |
| C-8 | 2 | `test/metadata.test.js:137` `exampleCount` would fail | Fixed — bumped to 6 in Step 6 |
| C-9 | 2 | AC4 regexed raw YAML | Fixed — real `yaml` parse |
| C-10 | 2 | `design.md` rollback said "two default sites" | Fixed — five, enumerated |
| C-11 | 3 | `DESIGN.md:392-403` is a second example inventory the plan never touched | Fixed — added to Step 6 and to Constraints |
| C-12 | 3 | Preflight fails: `task.json` `description` is empty; `git add -A` would commit it | Fixed — description set, preflight added to Step 8 before staging, new AC9 |
| C-13 | 3 | `src/operations.js:539` described as the consume site; it is the decode site (consume is `:405`, evaluation `src/router.js:161`) | Fixed in all three artifacts |
| C-14 | 3 | AC4's predicate passed against an empty gate job — verified, printed `gate structure ok` | Fixed — requires the `gates` id, ≥1 step, and a non-empty `run:` |

Round 3's host lane found C-11 through C-14; its Codex lane found C-12, C-13,
and C-14 independently. All fourteen were verified against the checkout. No
concern is outstanding for this task.

`npm test` and the rest of the Step 8 gate have **not** been run — this task is
planning only and its acceptance criteria are checks for the implementation
session, not claims about the current tree. The one command that was run is the
preflight, which now reports `0 failure(s), 0 warning(s)`.
