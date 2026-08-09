# Implement — deterministic pre-routing gates and cost-biased router defaults

Branch: `feat/08-07-deterministic-gates-router-defaults`
Worktree: session scratchpad `router-wt` (isolated from other sessions)

Run every command from the worktree root.

> **Revision note.** An adversarial review found that the first draft named two
> default sites when there are five, and four document sites when there are
> eight. The searches below are written to *enumerate* rather than to confirm
> what was already known.

## Step 0 — baseline

```bash
npm test 2>&1 | tail -5
```

Record the passing count. Any later count must be that number plus the new
tests, with zero failures. A pre-existing failure must be reported, not absorbed
into this task's diff.

## Step 1 — flip all five default sites

The default is declared across three layers. Changing a subset produces a
split-brain where one layer proves `copilot` while another ships `deep`.

- [ ] `action.yml:81` — `default: deep`
- [ ] `src/index.js:249` — `input("high-risk-route", "deep", env)`
- [ ] `src/operations.js:376` — `input("high-risk-route", "deep", env)`
- [ ] `src/protocol.js:969` — `context.highRiskRoute ?? "deep"`
- [ ] `src/router.js:34` — `highRiskRoute = "deep"`

`src/router.js:34` is a one-token edit in a parameter destructuring list. It is
not a logic change; R6 permits it.

`action.yml:78` is where the input block opens; `:81` is the `default:` line.
Every reference in these artifacts points at `:81` for that reason.

Validation — search for the **value**, not the input name. Three of the five
sites never spell `high-risk-route`. The pattern must be **unquoted**:
`action.yml:81` is `default: copilot` with no quotes, so `'"copilot"'` skips it.

```bash
grep -rn copilot src/ action.yml
```

Read every hit. None may stand in a default or fallback position; the survivors
should be descriptions, enum listings, and validation messages. Do not run the
tests yet; Step 2 fixes what this breaks.

## Step 2 — repair the five default-dependent tests

Add an explicit `high-risk-route` / `highRiskRoute` value of `copilot` to each,
preserving every existing assertion. These tests are about Copilot dispatch
mechanics and PR-number binding, not about the default; weakening them to `deep`
would stop exercising the Copilot path.

In `test/action.test.js`, add `"INPUT_HIGH-RISK-ROUTE": "copilot"` to the
harness `env` of:

- [ ] line 203 `automatic sensitive routing requests Copilot once and reports outputs`
- [ ] line 404 `event-target routing drives every client call with the single event PR number`
- [ ] line 425 `explicit-target override fetches metadata and binds every client call to the normalized number`

And:

- [ ] `test/operations.test.js:588` — same treatment.
- [ ] `test/protocol.test.js:502` — same treatment.

Validation:

```bash
npm test 2>&1 | tail -5
```

Expect the Step 0 count, zero failures. A sixth failing test also depended on
the default — give it the same explicit value rather than changing its
assertion, and note it in the final report.

## Step 3 — pin the new default with new coverage

Step 2 made all five existing tests pass `copilot` explicitly, which means
**nothing** now exercises the new default. One test is not enough: the default
lives on three paths and each has its own fallback site.

- [ ] `test/action.test.js` — standalone path (`src/index.js:249`): sensitive
  path changed, `INPUT_SENSITIVE-PATHS` set, `high-risk-route` **omitted**.
  Assert `result.decision.route === "deep"`,
  `harness.outputs.get("copilot-requested") === "false"`, and
  `harness.calls.requestReviewer` is empty.
- [ ] `test/operations.test.js` — durable path (`src/operations.js:376`): same
  shape, input omitted, assert the route is `deep`.
- [ ] `test/protocol.test.js` — protocol decode fallback
  (`src/protocol.js:969`): routing context omits `highRiskRoute`, assert
  `selectProtocolRoute` resolves `deep`.

Validation:

```bash
npm test 2>&1 | tail -5
```

Expect Step 0 count + 3, zero failures. Then confirm each test is real: revert
its corresponding site to `"copilot"` temporarily and rerun — that test must
fail. Restore `deep`. A test that passes under both values proves nothing, and
three tests that all only cover `src/index.js` leave two sites unpinned.

## Step 4 — documentation sweep

Two searches are required. The first finds sites that *configure* the default;
the second finds prose that *describes* it. Documents overwhelmingly do the
latter — `README.md:14` never writes `high-risk-route` at all.

```bash
grep -rn "high-risk-route\|highRiskRoute" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md action.yml .trellis/spec/
grep -rni "generic.*default\|by default.*copilot\|default.*copilot" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md .trellis/spec/
```

Change exactly these:

- [ ] `DESIGN.md:212` — routing table row 5, default `copilot` → `deep`
- [ ] `DESIGN.md:213` — routing table row 6, same
- [ ] `DESIGN.md:226` — rewrite the generic-workflow inheritance sentence
- [ ] `DESIGN.md:19` — route table row: "Explicit native reviews and the generic
  high-risk default" → `copilot` is for explicit native reviews only
- [ ] `README.md:14` — "by default, sensitive or unusually large changes in
  generic profiles" → that is now `deep`
- [ ] `SETUP-COPILOT.md:87-88` — "under the generic default—sensitive or large
  changes to `copilot`"
- [ ] `SETUP-COPILOT.md:90` — omitting the input no longer selects Copilot
- [ ] `SETUP-COPILOT.md:98` — adjust the profile-contrast wording
- [ ] `.trellis/spec/backend/quality-guidelines.md:349` — "`high-risk-route`:
  `deep|copilot`, default `copilot`" → `deep`. This is a **tracked contract**,
  not narrative prose; a stale contract is worse than stale docs.

Leave alone, with reasons recorded in `design.md`: `DESIGN.md:229`,
`SETUP-COPILOT.md:102`, `SETUP-PR-AGENT.md:4,98,299`, `action.yml:75,83`.

Validation: rerun both searches and read every hit. Zero may assert or imply the
old default. Hit counts should not drop — a dropped line means text was deleted
rather than corrected.

## Step 5 — local-evidence documentation

Naming the policy inputs is not enough; a reader still would not know where the
evidence itself goes.

- [ ] Add a `DESIGN.md` subsection next to the routing table covering the full
  payload path: `localReview` inside the `review-request` JSON input
  (`action.yml:13`), decoded at `src/protocol.js:538`, evaluated by
  `selectProtocolRoute` from `src/operations.js:381` using the policy inputs
  read at `src/operations.js:390-401`, with `request.localReview` evaluated at
  `src/router.js:161` and the decision consumed at `src/operations.js:405`.
  `src/operations.js:539` is the **decode** site, where `runOperation` reads
  the `review-request` input before delegating — do not describe it as the
  consume site, and note the call order is not the file order.
- [ ] Include a concrete `localReview` JSON fragment.
- [ ] Cover the three eligibility conditions, exact-head binding, and
  `independent-review-floor` / risk-floor interaction.
- [ ] State plainly that this is **durable-operations-path only**: the
  standalone path (`src/index.js:254`, `routeReview`) has no local-evidence
  concept, so a standalone workflow gets nothing from those inputs.

Validation: cross-check each stated condition against `selectProtocolRoute` in
`src/router.js` line by line. Documented behavior the code does not implement is
worse than no documentation.

## Step 6 — the gated example

- [ ] Create `examples/gated-review-router.yml` per `design.md` Change 3.
  Pinned SHA `8636a3983d18de17c49907a4c48170a61b1bb713`. Gate job with `run:`
  placeholders. Routing job with `needs: [gates]`. Retain the `issue_comment`
  trigger so `/review` commands still work.
- [ ] Reference it from `README.md`'s example list and cross-reference the
  Step 5 section.
- [ ] `DESIGN.md:392-403` — the repository-artifact inventory lists all five
  existing examples with a one-line description each. Add the sixth. This is a
  **second** inventory; a plan that only says "update README" leaves it stale.
- [ ] `test/metadata.test.js:137` — `assert.equal(result.exampleCount, 5)`
  becomes `6`. This is a hard-coded count; without the bump `npm test` fails.

Find the inventories by enumeration, not memory — the validator uses `readdir`
but prose does not:

```bash
grep -rn "examples/" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md
grep -c '' <(ls examples/)
```

Any document reciting more than one example path is an inventory. `README.md:86`
additionally claims "Every checked-in first-party example uses that same
released full SHA" — the new example must satisfy it, which the pinned
`8636a3983d18de17c49907a4c48170a61b1bb713` does.

The gate commands are placeholders because this repository cannot know a
consumer's lint or test invocation. The load-bearing part is the job graph.

Validation — structural, via a real YAML parse. `yaml@^2.9.0` is already a
devDependency, so there is no reason to regex raw text; regexes cannot prove
that the job carrying `needs` is the same job that invokes the Action.

```bash
npm run validate:metadata
npm run validate:ci-parity
node --input-type=module -e '
import {readFileSync} from "node:fs";
import {parse} from "yaml";
const wf = parse(readFileSync("examples/gated-review-router.yml","utf8"));
const jobs = Object.entries(wf.jobs ?? {});
const usesAction = ([,j]) => (j.steps ?? []).some(s =>
  typeof s.uses === "string" && s.uses.startsWith("platypeeps/sd-github-review@"));
const routing = jobs.filter(usesAction);
if (routing.length !== 1) throw new Error(`expected 1 routing job, saw ${routing.length}`);
const [routingId, routingJob] = routing[0];
const needs = [routingJob.needs ?? []].flat();
if (!needs.includes("gates")) throw new Error(`${routingId}.needs must include "gates", saw [${needs}]`);
for (const n of needs) {
  const gate = wf.jobs[n];
  if (!gate) throw new Error(`${routingId} needs unknown job ${n}`);
  if (usesAction([n, gate])) throw new Error(`gate job ${n} itself invokes the Action`);
  const steps = gate.steps ?? [];
  if (steps.length === 0) throw new Error(`gate job ${n} has no steps`);
  if (!steps.some(s => typeof s.run === "string" && s.run.trim()))
    throw new Error(`gate job ${n} runs no deterministic command`);
}
console.log(`gate structure ok: ${routingId} needs [${needs}], each gate runs a command`);'
```

> **Round-3 correction.** The first version of this check asserted only that
> `needs` was non-empty and that the named jobs did not invoke the Action. That
> passes against an empty job: adding a bare `prepare: {runs-on: ...}` and
> `needs: [prepare]` printed `gate structure ok` with no gate present at all —
> exactly the "AI review runs before anything free has run" failure the example
> exists to prevent. The check now requires the `gates` id specifically, at least
> one step per named job, and at least one non-empty `run:` in each.

The parse asserts the property that matters — the single job invoking the Action
depends on a job named `gates` that exists, runs at least one deterministic
command, and does not itself invoke the Action — rather than that two strings
appear somewhere in the file.

Prove the check is real before trusting it: temporarily strip the `run:` from
the gate job and rerun. It must fail with `runs no deterministic command`. A
check that cannot fail is not a check.

## Step 7 — changelog

- [ ] Add an `## Unreleased` / `### Changed` entry to `CHANGELOG.md` in the
  existing Keep-a-Changelog format. Name the behavior difference and give the
  verbatim migration line `high-risk-route: copilot`.

## Step 8 — full gate

```bash
npm test
npm run check
npm run validate:metadata
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs
```

The preflight is **not optional and must run before staging**. On a fresh
`task.py create` it fails —
`FAIL .trellis/tasks/<slug>/task.json field description must be a non-empty
string` — because `create` leaves `description` empty. Fix the field, re-run to
0 failures, and only then `git add`. Staging with `git add -A` first commits and
pushes a task record the repository's own gate rejects.

Then the scope checks. `git diff --stat` reports filenames and line counts, not
content, so it cannot prove either claim — use content diffs:

```bash
git diff origin/main -- src/router.js
git diff origin/main -- examples/ .github/ | grep -E '^[+-].*uses:.*platypeeps/sd-github-review'
```

Acceptance:

- zero test failures; count is Step 0 + 3 (Step 3 adds one test per path)
- all four commands exit 0
- `src/router.js` diff contains only the one-token default edit at line 34
- the `uses:` grep shows only additions carrying the existing pinned SHA — no
  removals, no new SHA value

If `npm run check:full` is affordable, run it; it is the superset gate.

## Step 9 — ship

```bash
git add -A
git commit
git push -u origin feat/08-07-deterministic-gates-router-defaults
```

Open the PR. The body must state plainly that this is a **behavior change** for
consumers who omit `high-risk-route`, and carry the migration line.

## Rollback points

- After Step 3: reverting the five default sites plus the Step 2/3 test edits
  restores previous behavior exactly.
- After Step 8: `git revert` of the single commit. Documentation and the example
  are additive; only the five default sites carry behavior.

## Review gates

- Before Step 9, confirm every `prd.md` acceptance criterion has a specific
  command or file cited against it, not a summary judgement.
- AC1 and AC2 must be verified by the enumerating searches above. The first
  draft of this plan was wrong precisely because it searched for the string it
  already knew.
- AC8's two content diffs are the only valid evidence for that criterion.
