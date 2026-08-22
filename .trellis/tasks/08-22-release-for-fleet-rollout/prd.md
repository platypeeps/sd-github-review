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

- [ ] A written survey of `v0.3.0..main` exists in this task's `research/`, grouping commits and
      naming every consumer-facing behavior change.
- [ ] Anything unsuitable for release is listed explicitly with a disposition, or the survey
      states that nothing was found and shows how that was checked.
- [ ] `package.json` version is bumped, with the choice justified against the survey.
- [ ] The release tag exists, is an exact `v<version>` match for `package.json`, and points at a
      commit with a clean template tree.
- [ ] `resolveSourceRelease` against the tagged checkout returns `released: true` with a non-null
      tag — verified by running it, not by inspection.
- [ ] `08-22-installer-secret-gate-mode-aware` is merged and contained in the tag. A release
      without it does not unblock the rollout.

## Dependencies

Blocked on PR #113 (`08-22-installer-secret-gate-mode-aware`) merging. Tagging before that lands
produces a release that still refuses `copilot` installs without a credential, which defeats the
purpose.

Blocks `08-08-fleet-rollout-smoke`.

## Notes

2026-08-22: Queued while `08-08-fleet-rollout-smoke` was paused. The rollout's own preconditions
are otherwise satisfied — route mode `copilot` decided, external-repo scope approved, all nine
consumer checkouts verified clean, and the credential-distribution problem resolved by the
installer fix. Provenance is the only remaining blocker.

The survey has not been done. The commit-count figure is a `wc -l` snapshot and nothing more; nothing in the range has
been read. It was 179 when this task was written and 180 an hour later, which is why the
requirement above is to recompute it rather than cite it.
