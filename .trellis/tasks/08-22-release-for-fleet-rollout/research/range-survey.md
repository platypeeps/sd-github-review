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

- Whether to reconstruct a `0.3.0` CHANGELOG entry or fold that range into `0.4.0`.
- Whether the unreachable v2 governance modules are inside this range. Session notes from
  2026-08-20 record `prepareManagedPlan()` and `compileRoutedReviewConfiguration()` as having no
  production callers, with roughly 28.6% of the tree reachable. Shipping unreachable code is
  inert but should be a decision, not an accident. **Not verified against this range** — check
  before tagging.
- `08-22-installer-secret-gate-mode-aware` (PR #113) is not yet merged and must be contained in
  the tag.
