# Survey of `v0.3.0..origin/main`

Performed 2026-08-22 against `origin/main` at `7912d63`. Recompute the count before relying on
it; it was 179, then 180, within one hour.

## Shape of the range

180 commits. By conventional type, excluding ~31 merge commits:

| type | count |
| --- | --- |
| chore | 70 |
| docs | 45 |
| fix | 19 |
| feat | 7 |
| test | 4 |
| refactor | 4 |

By scope, the bookkeeping share dominates: `task` 48, `spec` 15, `trellis` 9. Those plus most of
`docs` and `chore` are Trellis planning records, vendored-pack refreshes, and spec text — no
consumer-visible effect. The consumer-facing surface is concentrated in `installer` (13),
`contract` (1), `review` (1), and the `feat`/`fix` commits below.

No `revert`, `WIP`, or `do not ship` markers in the range.

## Consumer-facing changes

### Breaking or migration-bearing

- **`a67e11b` feat(installer): manage `REVIEW_ROUTE_MODE` as a schema-4 variable.** Manifest
  schema goes to 4 and `--route-mode` becomes **required on a fresh install with no default**.
  Existing schema-2 and schema-3 manifests migrate through `update`. This is a breaking CLI
  change for any automation that installs without the flag.
- **`38a8042` fix(contract): publish the setup descriptor at `contract/`, off the probe path.**
  Relocates the published descriptor so the router stops self-matching as an installed consumer.
  Changes where first-party consumers read the descriptor from.
- **`64f0a2b` feat(installer): install the setup descriptor and the durable `sd-review.yml`
  lane.** New installed surface — two files per consumer that did not exist before.
- **`high-risk-route` default `copilot` → `deep`** (recorded in CHANGELOG Unreleased). A durable
  consumer omitting both `high-risk-route` and `deep-backend` now fails with `deep-backend is
  required for durable operations` on sensitive or large PRs where it previously routed to
  Copilot.

### Behavior changes

- `0b44277` feat: deterministic pre-routing gates and cost-biased router defaults
- `c4d4314` fix: **stop the event-driven lane billing PR-Agent on every pull request** — a cost
  fix consumers will care about
- `f936946` fix: fail closed when the event-driven lane has no explicit route
- `b6e2e88` fix: set the review floor on the event-driven lane too
- `aeda474` feat: enforce first-party pin freshness and advance every pin to v0.3.0
- `8fffc76` fix(installer): pass sources at both `createManifest` call sites

### Added, non-breaking

- `examples/gated-review-router.yml`, a cost-optimized profile gating AI review behind free
  deterministic checks (CHANGELOG Unreleased)
- `DESIGN.md` section on local review evidence lowering the automatic route

## Findings that change the task

### 1. The CHANGELOG has no `0.3.0` section at all

The file goes `## Unreleased` straight to `## 0.2.0 - 2026-08-04`. The `v0.3.0` tag exists at
`744a9f1`, so **0.3.0 was tagged without ever being documented**. Any new release must either
reconstruct a 0.3.0 entry or explicitly fold that range into the new version's notes. Deciding
which is part of this task.

### 2. `## Unreleased` is badly stale

It documents three items: the `high-risk-route` default, `gated-review-router.yml`, and a
DESIGN.md section. It does **not** mention schema 4, the required `--route-mode` flag, the
descriptor relocation, the durable lane installation, or the event-driven billing fix — every
one of which is consumer-facing, and several breaking. The section cannot be promoted as-is; the
release notes must be rebuilt from the commit range. This survey is the input for that.

### 3. There is already a release-validation command

`npm run validate:release -- vX.Y.Z` (`scripts/validate-action-metadata.mjs`) asserts the tag
equals `v<version>` and does not already exist, on top of the always-on pin-consistency tier.
Per the 0.2.0 notes it is deliberately **not** wired into `ci.yml`, because a fresh release tag
does not exist on ordinary PR/main builds — so it must be run by hand as part of cutting the
release. Use it; do not hand-verify.

## Version recommendation

**`0.4.0`.**

The range carries a manifest schema bump (3 → 4), a CLI flag that is now required with no
default, a relocated published descriptor, a new installed file set, and a changed routing
default with a failure mode for consumers who omit two inputs. That is not a patch. Under 0.x
semver as the project states it follows, breaking changes advance the minor, so `0.4.0` rather
than `0.3.1`.

`package.json` is still at `0.3.0`, equal to the last tag, so the bump has to be made
deliberately as part of this task.

## Still open

- ~~Whether to reconstruct a `0.3.0` CHANGELOG entry or fold that range into `0.4.0`.~~
  **Decided 2026-08-22 by the owner — fold it in.** Reconstructing notes for a release nobody
  read notes for buys nothing; no consumer is pinned to `v0.3.0` waiting on them. The `0.4.0`
  entry covers everything since `0.2.0`, with `[0.3.0]` markers on entries that shipped in that
  tag. Written in PR #114.

  Folding required surveying `v0.2.0..v0.3.0`, which this survey had not covered: 153 commits,
  ~55 of them `feat`/`fix`. Its consumer-facing content is the `A-*` installer and action
  hardening series — `adopt`, request/subprocess timeouts, symlinked-target rejection, fresh
  Copilot review on authorized rerequest, route-control precedence before label parsing, resumable
  interrupted updates, and a secret reaching `gh` nonzero-exit error arguments. Most of the rest
  is the v2 protocol contract work, recorded as internal (see below).

- **Pin freshness lags the tag by one release, and it affects the rollout.** Per the archived
  `08-08-release-v0-3-0-pin-freshness`, the order is: tag at `main`, *then* advance the 13
  first-party pin sites to that tag's commit. So a tagged tree carries the *previous* release's
  pins — `v0.3.0`'s tree still pins the `v0.1.0`-era SHA, and `v0.4.0`'s will pin `v0.3.0`'s
  commit `744a9f1`. A consumer installed from tag `v0.4.0` would run `v0.3.0`'s action code,
  which lacks the event-driven billing fix `c4d4314`. That conflicts with
  `08-08-fleet-rollout-smoke` acceptance criterion 4. The rollout should install after the
  pin-advance commit rather than from the tag. Not yet decided.

- `validate:metadata` goes red between tagging and the pin-advance commit, because
  `assertPinFreshness` requires the descriptor `actionReference` to equal the highest release
  tag's commit. Expected, not a defect; it is why the two steps are adjacent.
- ~~Whether the unreachable v2 governance modules are inside this range.~~ **Resolved
  2026-08-22 — not a `0.4.0` concern.** Both are confirmed unreachable: `prepareManagedPlan`
  (`src/review-plan-authorization.js`) and `compileRoutedReviewConfiguration`
  (`src/routed-review-compiler.js`) have **zero** non-definition references in `src/` and no
  `src/` file imports either module; they are reached only from tests. But both were added
  2026-08-05 (`d08a37b`, `352baa8`) and `git log --diff-filter=A v0.3.0..origin/main` returns
  nothing for either file, so they are **ancestors of `v0.3.0` and already shipped in it**.
  Releasing `0.4.0` neither introduces nor worsens this. It is a pre-existing condition worth a
  separate decision, not a release blocker.
- ~~`08-22-installer-secret-gate-mode-aware` (PR #113) is not yet merged and must be contained in
  the tag.~~ **Merged 2026-08-22 as `fe8754e`**, squashed onto `main`. Contained in the range.

## The v2 modules, verified rather than assumed

A transitive import walk from `src/index.js` reaches 11 of 19 `src/` modules. The eight it does
not reach are `protocol-v2`, `retention-policy`, `review-budget-ledger`,
`review-candidate-catalog`, `review-deferred-recovery`, `review-plan-authorization`,
`review-usage-reconciliation`, and `routed-review-compiler` — the entire v2 review-protocol
series, exercised only by tests. This supersedes the narrower two-module finding above with a
whole-entrypoint result. They are recorded in the `0.4.0` notes under `### Internal` so the
release does not imply shipped behavior. Still a pre-existing condition, still not a release
blocker.
