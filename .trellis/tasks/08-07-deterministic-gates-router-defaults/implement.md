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

- [ ] `action.yml:78` — `default: deep`
- [ ] `src/index.js:249` — `input("high-risk-route", "deep", env)`
- [ ] `src/operations.js:376` — `input("high-risk-route", "deep", env)`
- [ ] `src/protocol.js:969` — `context.highRiskRoute ?? "deep"`
- [ ] `src/router.js:34` — `highRiskRoute = "deep"`

`src/router.js:34` is a one-token edit in a parameter destructuring list. It is
not a logic change; R6 permits it.

Validation — search for the **value**, not the input name. Three of the five
sites never spell `high-risk-route`:

```bash
grep -rn '"copilot"' src/ action.yml
```

No hit may be a default or fallback position. Do not run the tests yet; Step 2
fixes what this breaks.

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

- [ ] Add a test to `test/action.test.js`: sensitive path changed,
  `INPUT_SENSITIVE-PATHS` set, `high-risk-route` **omitted**. Assert
  `result.decision.route === "deep"`,
  `harness.outputs.get("copilot-requested") === "false"`, and
  `harness.calls.requestReviewer` is empty.

Validation:

```bash
npm test 2>&1 | tail -5
```

Expect Step 0 count + 1, zero failures. Then confirm the test is real: revert
`src/index.js:249` to `"copilot"` temporarily and rerun — the new test must
fail. Restore `deep`. A test that passes under both values proves nothing.

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
  read at `src/operations.js:390-401`, consumed at `src/operations.js:539`.
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

The gate commands are placeholders because this repository cannot know a
consumer's lint or test invocation. The load-bearing part is the job graph.

Validation — structural, not visual. The metadata validator checks YAML shape,
permissions, and pinning, but not that a gate precedes routing:

```bash
npm run validate:metadata
npm run validate:ci-parity
node -e '
const y=require("fs").readFileSync("examples/gated-review-router.yml","utf8");
const routing=/needs:\s*\[?\s*gates/.test(y);
const actionInGate=/gates:[\s\S]*?platypeeps\/sd-github-review[\s\S]*?^  \w/m.test(y);
if(!routing) throw new Error("routing job does not depend on gates");
if(actionInGate) throw new Error("Action appears inside the gate job");
console.log("gate structure ok");'
```

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
```

Then the scope checks. `git diff --stat` reports filenames and line counts, not
content, so it cannot prove either claim — use content diffs:

```bash
git diff origin/main -- src/router.js
git diff origin/main -- examples/ .github/ | grep -E '^[+-].*uses:.*platypeeps/sd-github-review'
```

Acceptance:

- zero test failures; count is Step 0 + 1
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
