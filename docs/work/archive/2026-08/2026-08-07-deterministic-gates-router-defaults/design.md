# Design — deterministic pre-routing gates and cost-biased router defaults

## Boundaries

This task changes **default values and shipped guidance only**. It does not
change route-selection logic.

- Logic untouched: the bodies of `routeReview` and `selectProtocolRoute`,
  `src/protocol-v2.js`, `src/normalize.js`, `src/path-match.js`, `src/github.js`.
- Touched: five default sites, the documents that assert the old behavior, one
  new example, `CHANGELOG.md`, and the tests whose expectations encode the old
  default.

`routeReview` already takes `highRiskRoute` as a parameter and validates it as
`deep | copilot`. Flipping the default changes which value is passed in, not how
it is used.

## Change 1 — the default flip

> **Correction.** An earlier draft of this design claimed the default was
> declared in two places, `action.yml:81` and `src/index.js:249`. That was wrong.
> It was derived from `grep -rn "high-risk-route\|highRiskRoute"`, which finds
> only sites that spell the input name — and three of the five spell the
> *value*. The enumerating search that finds them all is
> `grep -rn copilot src/ action.yml` — **unquoted**. A second draft used
> `grep -rn '"copilot"'`, which still misses the metadata site: `action.yml:81`
> is `default: copilot` with no quotes.

Five sites, across three layers:

| Site | Layer | Applies when |
| --- | --- | --- |
| `action.yml:81` `default: copilot` | metadata | runner materializes `INPUT_HIGH_RISK_ROUTE` |
| `src/index.js:249` `input("high-risk-route", "copilot", env)` | standalone input fallback | env var absent |
| `src/operations.js:376` `input("high-risk-route", "copilot", env)` | durable input fallback | env var absent on the operations path |
| `src/protocol.js:969` `context.highRiskRoute ?? "copilot"` | protocol decode fallback | routing context omits the field |
| `src/router.js:34` `highRiskRoute = "copilot"` | function signature default | a caller omits the argument entirely |

Changing a subset produces a split-brain: one layer proves `copilot` while
another ships `deep`. Change all five in the same commit.

`src/router.js:34` is a one-token edit inside a parameter destructuring list. It
is not a logic change, and R6 permits it — the prohibition is on the
decision-making bodies, not on the file.

The `action.yml` description also needs a wording pass. It currently reads "Route
used for sensitive paths and changes at the line threshold. One of deep or
copilot." That sentence stays accurate, so the edit is limited to the `default:`
value. `SETUP-COPILOT.md:90` is the sentence that actively misleads after the
flip — it tells the reader to "Keep `high-risk-route: copilot` or omit the
input", and omitting the input no longer yields Copilot.

### Blast radius

Two searches are needed, and the second is the one that matters. Searching for
the input name finds the sites that *configure* the default; searching for the
behavior finds the prose that *describes* it. Documents overwhelmingly do the
latter — `README.md:14` says "by default, sensitive or unusually large changes
in generic profiles" and never writes `high-risk-route` at all.

```bash
grep -rn "high-risk-route\|highRiskRoute" --include=*.js --include=*.yml --include=*.md .
grep -rni "generic.*default\|by default.*copilot\|default.*copilot" README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md .trellis/spec/
```

Sites found by the name search:

- `action.yml:75` — description of `changed-line-threshold` that references the
  input by name. No default asserted. **No change.**
- `action.yml:78-81` — the input declaration; the `default:` value is on
  **`:81`**. **Change the default.**
- `action.yml:83` — `sensitive-paths` description. **No change.**
- `src/index.js:249` — the fallback. **Change.**
- `DESIGN.md:212-213` — routing table rows 5 and 6 say "`high-risk-route`,
  default `copilot`". **Change both to `deep`.**
- `DESIGN.md:226` — "Generic workflows inherit `high-risk-route=copilot`".
  **Rewrite**: generic workflows now inherit `deep` like the PR-Agent profiles,
  and a consumer who wants Copilot sets it explicitly.
- `DESIGN.md:229` — states that setting `high-risk-route=deep` does not change
  GitHub's review-effort setting. Still true. **No change.**
- `SETUP-COPILOT.md:90` — "Keep `high-risk-route: copilot` or omit the input".
  **Rewrite**: Copilot now requires the explicit input.
- `SETUP-COPILOT.md:98` — notes the PR-Agent profile sets `deep`. Still true but
  the contrast it draws is gone. **Adjust wording.**
- `SETUP-COPILOT.md:102` — instructs setting `high-risk-route: copilot`. Still
  correct and now load-bearing. **Keep, possibly strengthen.**
- `SETUP-PR-AGENT.md:4` — profiles set `deep`. Still true. **No change.**
- `SETUP-PR-AGENT.md:98` — set `copilot` in a manually owned workflow. Still
  true. **No change.**
- `SETUP-PR-AGENT.md:299` — "The supplied value is `deep`". Still true.
  **No change.**
- `test/metadata.test.js:354-355` — asserts the two PR-Agent profile workflows
  set `deep` explicitly. Still true. **No change.**
- `test/metadata.test.js:356-358` — asserts generic/pilot examples leave the
  input unset. Still true *as written*, and now means something different.
  **No change to the assertion**; the meaning change is captured in `DESIGN.md`
  and `CHANGELOG.md`.
- `test/router.test.js:46,60,76,85,94,103` — all pass `highRiskRoute`
  explicitly. **No change.**
- `test/action.test.js:310` — validation error message. **No change.**

Sites found only by the behavior search — every one of these was missed by the
name search and none writes `high-risk-route`:

- `README.md:14` — "`copilot` for explicit native reviews and, by default,
  sensitive or unusually large changes in generic profiles". **Rewrite**: that
  is now `deep`; `copilot` is for explicit native reviews only.
- `DESIGN.md:19` — route table row: "Explicit native reviews and the generic
  high-risk default". **Rewrite** the same way.
- `SETUP-COPILOT.md:87-88` — "under the generic default—sensitive or large
  changes to `copilot`". **Rewrite.**
- `.trellis/spec/backend/quality-guidelines.md:349` — "`high-risk-route`:
  `deep|copilot`, default `copilot`". This is a **tracked contract document**,
  not narrative prose, and a stale contract is worse than stale docs.
  **Change to `deep`.**

Additional test sites asserting the old default on omitted input, also missed by
the name search:

- `test/operations.test.js:588` — **update**, same treatment as the
  `action.test.js` three: make the route explicit rather than inherited.
- `test/protocol.test.js:502` — **update** likewise.

## Change 2 — the three tests that encode the old default

`test/action.test.js` has three tests that set only `INPUT_SENSITIVE-PATHS` and
assert `result.decision.route === "copilot"`:

- line 203 `automatic sensitive routing requests Copilot once and reports outputs`
- line 404 `event-target routing drives every client call with the single event PR number`
- line 425 `explicit-target override fetches metadata and binds every client call to the normalized number`

None of these is *about* the default. The first is about Copilot request
de-duplication and output wiring; the other two are about PR-number binding
across client calls. They reach Copilot incidentally, through the default.

**Resolution:** add an explicit `"INPUT_HIGH-RISK-ROUTE": "copilot"` to each
harness `env`. The tests then prove the same thing they were written to prove,
independent of the default. Weakening the assertion to `deep` instead would
silently stop exercising the Copilot dispatch path in two of the three.

**New coverage:** add one test that omits `high-risk-route`, supplies a
sensitive path, and asserts `route === "deep"` and
`copilot-requested === "false"`. Without it, nothing in the suite pins the new
default and a future revert would pass green.

## Change 3 — the gated example

New file `examples/gated-review-router.yml`. Shape:

```
jobs:
  gates:        # free, deterministic, no provider credentials
    steps: [lint, type-check, test, semgrep|codeql]
  route:
    needs: [gates]
    if: github.event_name == 'pull_request' || github.event.issue.pull_request != null
    steps: [sd-github-review, external reviewer]
```

Design points:

- `needs: [gates]` is the whole mechanism. A failed gate leaves `route` skipped,
  so no AI review is dispatched and nothing is billed. This is deliberately the
  plain GitHub `needs:` dependency the README already prescribes rather than a
  new Action input — the router should not grow a gate concept it does not need.
- The example must reuse the same pinned first-party SHA as every other checked
  in example (`8636a3983d18de17c49907a4c48170a61b1bb713`). `validate-action-metadata.mjs:479-484`
  enumerates `examples/` with `readdir` and applies the pinned-SHA rule to
  whatever it finds, so the new file is validated with no registration step and
  will fail the validator if the SHA is wrong or a tag is used.
- Gate steps use `run:` placeholders rather than third-party Actions. Pinning a
  third-party Action would create a second supply-chain surface this repository
  does not currently own, and the validator's pinning rule may or may not cover
  non-first-party references. Placeholders keep the example honest about being
  a template.
- The `issue_comment` trigger from the existing examples is retained so `/review`
  commands still work; a comment-triggered run still passes through `gates`.

## Change 4 — local review evidence

The router already implements this end to end: `selectProtocolRoute` in
`src/router.js` reads `request.localReview`, checks
`outcome ∈ {clean, fully-dispositioned}`, `confidence >= localConfidenceThreshold`,
and `dispositionCounts.unresolved === 0`, then lowers the route toward
`localEvidenceRoute` (default `cheap`) using `weakerRoute`. The
`independentReviewFloor` and the risk floor both still apply afterward, so
evidence can never lower a sensitive-path change below the floor.

Nothing about that needs to change. What is missing is discoverability, and the
missing piece is specifically the **payload path** — naming the policy inputs is
not enough, because a reader still would not know where the evidence itself
goes. It goes here:

- the caller supplies a `review-request` JSON document via the `review-request`
  Action input (`action.yml:13`);
- `localReview` is a member of that document, decoded at `src/protocol.js:538`;
- `src/operations.js:381` calls `selectProtocolRoute`, having read
  `independent-review-floor`, `local-confidence-threshold`, and
  `local-evidence-route` at `src/operations.js:390-401`;
- `src/operations.js:539` is where `runOperation` decodes the `review-request`
  input; it is the **entry** point, not the consume point. Textually it sits
  below `:381`/`:405` because `runOperation` calls `runRouteAction`, so reading
  the file top-down inverts the actual order.
- `src/router.js:161` evaluates `request.localReview`.
- `src/operations.js:405` consumes the resulting decision
  (`selectedBackend(decision.route, env)`).

This is **durable-operations-path only**. The standalone path
(`src/index.js:254`, `routeReview`) has no local-evidence concept, so a
standalone workflow gets no benefit no matter what it sets. The documentation
must say so; otherwise the two policy inputs read like general-purpose knobs.

Add a `DESIGN.md` section next to the routing table containing:

- the payload path above, with a concrete `localReview` JSON fragment;
- the three eligibility conditions, since a caller that fails any one gets
  `localEvidence: "ineligible"` and no reduction;
- exact-head binding, so a push invalidates the evidence;
- the standalone-vs-durable distinction.

This closes the loop with the sd-ai-command-pack side, whose `sd-review`
coordinator already emits exactly this `localReview` summary shape
(`scripts/sd-ai-command-pack-review.py`, the `summary` dict with
`schemaVersion`, `outcome`, `confidence`, `dispositionCounts`, `costTier`).

## Compatibility and rollout

- SemVer: a behavior change with no interface break — a minor bump at the next
  release. Version bumping is release-process work and is not done here.
- Migration for a consumer who wants the old behavior is one line:
  `high-risk-route: copilot`. This goes in the `CHANGELOG.md` entry verbatim.
- Consumers on the shipped PR-Agent profiles are unaffected; those profiles
  already set `deep` explicitly (`test/metadata.test.js:354-355`).
- Rollback is a revert of the **five** default sites — `action.yml:81`,
  `src/index.js:249`, `src/operations.js:376`, `src/protocol.js:969`,
  `src/router.js:34` — together with the Step 2/3 test edits that pin them.
  Reverting a subset produces the split-brain this design exists to avoid. The
  documentation and example changes are additive and safe to leave in place.

## Rejected alternatives

- **Removing the input and always routing high-risk to `deep`.** Removes a
  consumer's ability to escalate structural risk to Copilot deliberately. The
  input is a legitimate control; only its default was wrong.
- **Adding a `gates` input to the Action.** Reimplements `needs:` inside the
  router and gives the Action a job-orchestration responsibility that belongs to
  the workflow. Rejected on boundary grounds.
- **Editing the existing `review-router.yml` in place to add gates.** Would
  conflate "minimal example" with "recommended production shape". A separate
  file lets `review-router.yml` stay the minimal adapter illustration.
