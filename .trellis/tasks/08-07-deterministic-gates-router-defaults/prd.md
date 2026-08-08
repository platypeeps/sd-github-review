# Ship deterministic pre-routing gates and cost-biased router defaults

## Goal

Reduce the cost of automatic AI review by making the router's own defaults
prefer the cheaper `deep` backend over native Copilot for high-risk changes, and
by shipping examples that run free deterministic gates before any AI review
runs at all.

## Problem

Three cost leaks exist in the shipped router today.

1. `action.yml:78` defaults `high-risk-route: copilot`. Every pull request that
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
   (`action.yml:13`; decoded at `src/protocol.js:538`; consumed at
   `src/operations.js:539`). No example or setup guide shows that payload, so
   the capability is undiscoverable in practice.

## Requirements

- R1. Change the `high-risk-route` default from `copilot` to `deep` in every
  place that declares it:
  - `action.yml:78` — the Action metadata default;
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
- This is a minor version bump under SemVer: behavior changes without an API
  break. Version bumping itself is release-process work and is out of scope
  unless a validator requires it.

## Acceptance Criteria

- [ ] AC1. All five default sites read `deep`, verified by an enumerating
  search rather than by inspecting the files that were edited:
  `grep -rn '"copilot"' src/ action.yml` returns no hit that is a default or
  fallback value. `action.yml`'s description no longer implies Copilot is the
  default.
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
  Action carries `needs:` on a gate job, verified structurally: parse the YAML
  and assert the routing job's `needs` contains the gate job's id, and that the
  Action does not appear in the gate job. A visual read of the file does not
  satisfy this.
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
