# Survey main since v0.3.0 and cut the release the fleet rollout needs

## Goal

Produce a tagged release of this repository that `resolveSourceRelease` accepts as
`released: true`, so `08-08-fleet-rollout-smoke` can install into nine consumers with published,
verifiable provenance.

## Problem

The fleet rollout is blocked on provenance, not on functionality.

`resolveSourceRelease` (`scripts/consumer-installer/transport.mjs:329-356`) records
`released: true` only when all of these hold:

- HEAD carries an exact tag matching `v${version}` from `package.json`
- that tag matches `RELEASE_TAG_PATTERN`
- `git.templateDirty()` is false

Any other git state records `{ commit, tag: null, released: false }`. Installing from an
untagged branch therefore stamps an unpublished commit and `released: false` into each
consumer's local manifest — nine repositories pointing at a commit nobody can fetch. That is the
undetectable drift `08-08-fleet-rollout-smoke` exists to eliminate, so the rollout must not run
from an untagged checkout.

Installing from the existing release is equally wrong:

- `v0.3.0` → `744a9f1`
- `main` is **~180 commits** past `v0.3.0` and the figure moves with every merge; recompute
  with `git log --oneline v0.3.0..origin/main | wc -l` rather than trusting this number
- `v0.3.0` predates `08-22-installer-secret-gate-mode-aware`, so it still refuses a `copilot`
  install without a PR-Agent credential — the defect the rollout was paused for

Neither the release nor the branch is rollout-ready. A new tag is required.

## The actual question

That gap is large, and tagging ships all of it, not just the installer fix. The survey
is the substance of this task: what would a release off current `main` actually deliver, and is
any of it unfinished, breaking, or unintended for consumers?

`package.json` is at `0.3.0`, which equals the last tag, so the version has not been bumped
since the release. The new version number is a decision this task must make, not inherit.

## Requirements

- Enumerate what `v0.3.0..main` contains, grouped so the reader can judge it — at minimum
  separate consumer-facing behavior changes from internal, tooling, and Trellis bookkeeping
  commits, which are a large share of the recent history.
- Identify anything in that range that should not ship to consumers: incomplete work, known
  defects, behavior changes with no migration path, or changes that alter the installed lane's
  contract.
- Decide the version number and justify it against what the range actually contains. A range
  this size is unlikely to be a patch bump.
- Confirm `templateDirty()` is false at the tagged commit, since a dirty template tree silently
  downgrades the release to `released: false` — the exact failure this task exists to prevent.
- Verify the cut release resolves as `released: true` before the rollout depends on it.

## Acceptance Criteria

- [x] A written survey of `v0.3.0..main` exists in this task's `research/`, grouping commits and
      naming every consumer-facing behavior change. Extended to `v0.2.0..main` once the CHANGELOG
      decision was to fold `0.3.0` in.
- [x] Anything unsuitable for release is listed explicitly with a disposition, or the survey
      states that nothing was found and shows how that was checked. No reverts, WIP, or
      do-not-ship markers; the eight unreachable v2 modules are dispositioned as pre-existing and
      recorded under `### Internal` in the notes.
- [x] `package.json` version is bumped, with the choice justified against the survey. `0.4.0`,
      merged as #114.
- [x] The release tag exists, is an exact `v<version>` match for `package.json`, and points at a
      commit with a clean template tree. `v0.4.0` at `3e41f23`;
      `git rev-list -n1 v0.4.0` confirms.
- [x] `resolveSourceRelease` against the tagged checkout returns `released: true` with a non-null
      tag — verified by running it, not by inspection.
      `{"commit":"3e41f23…","tag":"v0.4.0","released":true}`.
- [x] `08-22-installer-secret-gate-mode-aware` is merged and contained in the tag. Merged as
      `fe8754e` (#113), which is an ancestor of `3e41f23`.

## Dependencies

Blocked on PR #113 (`08-22-installer-secret-gate-mode-aware`) merging. Tagging before that lands
produces a release that still refuses `copilot` installs without a credential, which defeats the
purpose.

Blocks `08-08-fleet-rollout-smoke`.

## Survey result

Done 2026-08-22 — see `research/range-survey.md`. Headline findings:

- Recommended version is **`0.4.0`**, not a patch: schema 3 → 4, `--route-mode` now required
  with no default, the published descriptor relocated to `contract/`, a new installed file set,
  and a changed `high-risk-route` default with a failure mode for consumers omitting two inputs.
- **The CHANGELOG has no `0.3.0` section.** It jumps from `## Unreleased` to `## 0.2.0`, so the
  existing tag was cut without notes. Decide whether to reconstruct that entry or fold it in.
- **`## Unreleased` is badly stale** — it documents three items and omits every breaking change
  in the range. It cannot be promoted as-is; notes must be rebuilt from the survey.
- **`npm run validate:release -- vX.Y.Z` already exists** and is deliberately not in CI, because
  a fresh tag does not exist on ordinary builds. Run it by hand when cutting.
- The bookkeeping share is large (48 `task`, 15 `spec`, 9 `trellis`, 45 `docs`), so the
  consumer-facing surface is much smaller than 180 commits suggests.

## Outcome

`v0.4.0` was cut 2026-08-22 at `3e41f23`, published as a GitHub release, and every first-party
pin advanced to it (#115, `09efa5e`). `resolveSourceRelease` returns `released: true`, so the
provenance blocker this task existed to clear is closed.

**One thing this release does not give the rollout.** The tagged tree at `v0.4.0` pins
`744a9f1` — `v0.3.0`'s commit — because pins can only advance after the tag exists. Verified
empirically from a worktree at the tag, not inferred. So installing the fleet from `v0.4.0`
writes an `actionReference` of `744a9f1` into each consumer, which does not satisfy
`08-08-fleet-rollout-smoke` acceptance criterion 4, "every installed descriptor pins the same
first-party SHA as the current release."

That is a decision for the rollout, not a defect in this release: either close the lag first via
`08-22-pin-freshness-lag` and cut `0.4.1` with self-consistent pins, or install from `v0.4.0`
and accept that consumers run one commit of older action code (`0b44277`, the pre-routing
gates — the only `src/`/`action.yml` change in the range).

A dry run from the tagged checkout against `platypeeps/rwbp-coordinator` produces a full plan
with **no `set-secret` action**, confirming the merged secret-gate fix behaves as intended under
`--route-mode copilot`.

## Outcome, superseded — `v0.5.0`

`v0.4.0` above is left as written because it happened. The rollout did not install from it.
The pin-lag decision recorded above was taken the second way and then some: rather than accept
consumers running older action code, `08-22-durable-lane-route-mode` landed on top and the
release was re-cut as **`v0.5.0`**, tagged 2026-08-22 at `0e58e76`, with the pin advanced to
`61a4492`. Every one of the nine consumers now pins `61a4492` — enumerated from each default
branch, not inferred — so acceptance criterion 4 of `08-08-fleet-rollout-smoke` is satisfied
for the first time.

Cutting `0.5.0` also caught a release-stopping defect that no earlier gate could have seen.
`action.yml` carried a `${{ vars.REVIEW_ROUTE_MODE }}` example inside an input *description*.
GitHub evaluates expressions in `action.yml` when it loads the action, and an action definition
may not reference the `vars` context, so the action failed to load for every consumer at once.
It was invisible until the pin advanced, because the self-hosted `route` lane exercises the
action *at its pin* — which until then was the previous release. Fixed in #124 and gated by
`R-008` in `scripts/validate-action-metadata.mjs`, which now rejects expression delimiters
anywhere outside `runs:`.

Fleet state at close, verified against each repository's default branch rather than restated
from the install run: 9/9 carry `config/routed-review-setup-v1.json` (blob `a6267fc`),
`.github/workflows/sd-review.yml` (blob `b3c5c15`), and `.github/workflows/ai-review-router.yml`
(blob `a302eb0`), all pinned to `61a4492`. All eight install pull requests are merged. No
provider credential was distributed to any consumer.

## Notes

2026-08-22: Queued while `08-08-fleet-rollout-smoke` was paused. The rollout's own preconditions
are otherwise satisfied — route mode `copilot` decided, external-repo scope approved, all nine
consumer checkouts verified clean, and the credential-distribution problem resolved by the
installer fix. Provenance is the only remaining blocker.

The survey has not been done. The commit-count figure is a `wc -l` snapshot and nothing more; nothing in the range has
been read. It was 179 when this task was written and 180 an hour later, which is why the
requirement above is to recompute it rather than cite it.
