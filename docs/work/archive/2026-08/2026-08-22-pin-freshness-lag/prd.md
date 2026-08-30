---
title: Close the one-release pin-freshness lag
status: done
created: 2026-08-22
branch: chore/pin-freshness-lag
---
# Close the one-release pin-freshness lag

## Goal

Let a tagged release tree carry first-party pins that point inside its own release, so a
consumer installed from `v<X.Y.Z>` runs that release's action code rather than the previous
release's.

## Problem

`assertPinFreshness` (`scripts/validate-action-metadata.mjs:590-621`) requires exact equality:

```js
if (actionSha !== latestCommit) {
  throw new Error(
    `${descriptorPath}: actionReference is stale — pinned to ${actionSha}, but the ` +
      `current release ${latest} is ${latestCommit}; advance every first-party pin together`,
  );
}
```

`latestCommit` is the commit of the highest `v<semver>` tag. A commit cannot contain its own
SHA, so no commit can satisfy this at the moment it is tagged. The file already names the
constraint at `:623-627`, for the sibling release gate:

> It does NOT assert example pins equal the release commit (a commit cannot embed its own SHA —
> an infeasible fixed point).

The established workaround, from the archived `08-08-release-v0-3-0-pin-freshness`, is to tag
first and advance the pins afterwards. That satisfies the gate **on `main`** and leaves the
**tagged tree** pinned to the previous release, permanently:

| tag | tree pins | i.e. |
| --- | --- | --- |
| `v0.3.0` (`744a9f1`) | `8636a39` | the `v0.1.0`-era commit |
| `v0.4.0` | `744a9f1` | `v0.3.0`'s commit |

So every consumer installed from a release tag runs one release of action code behind, and the
gap does not close on its own.

## Impact

Bounded, but real and compounding.

For `0.4.0` specifically the cost is **one commit**: `0b44277`, deterministic pre-routing gates
and cost-biased router defaults. Verified with
`git log --no-merges v0.3.0..v0.4.0 -- src/ action.yml`, which returns exactly one line.
Everything else consumer-facing in that range is installer-side or template-side and ships with
the installed files regardless of the pinned action SHA — including the three event-driven
billing fixes (`c4d4314`, `f936946`, `b6e2e88`), which touch only
`examples/pr-agent-router.yml` and `.github/workflows/ai-review-router.yml`.

That is small for one release and unbounded across many. It also conflicts with
`08-08-fleet-rollout-smoke` acceptance criterion 4 ("every installed descriptor pins the same
first-party SHA as the current release") if that criterion is read as currency rather than
mutual consistency.

## Direction

Settled in `design.md`. Replace equality with **action-code identity**: the pinned commit must
be an ancestor of, or equal to, the highest release tag's commit, **and** carry the same `src`
tree and the same `action.yml` blob as that commit.

An earlier revision of this section proposed an ancestry window instead — "ancestor of the
latest tag, not an ancestor of the previous one." `design.md` works that through and discards
it: it deadlocks the pin-advance pull request, whose CI runs before the new tag exists. Every
ancestry-only formulation trades that deadlock against re-opening the hole, because ancestry
cannot distinguish *which* commits in the gap matter. Identity of the action code can.

The three design questions this section previously left open are resolved there:

- **First release with no predecessor** — dissolves. The rule never consults the previous tag.
- **Does the release order invert** — yes, and the live owner of that order is
  `docs/RELEASE_CHECKLIST.md` section 5, not the archived task.
- **Does `validateReleaseConsistency` need the same change** — no. Its comment already disclaims
  the fixed point and it is left untouched.

## Requirements

- A tagged release tree passes the freshness gate with pins pointing inside its own release.
- A pin whose action code differs from the release still fails, with a message naming the pinned
  commit, the release tag and commit, and **which** of `src` or `action.yml` differs.
- A pin that trails the release only by commits which change neither `src` nor `action.yml`
  passes. This is deliberate: consumers run byte-identical action code, so the lag is not
  observable to them. It also means a docs- or examples-only release legitimately accepts the
  previous release's pin.
- The gate keeps its test seam: `gitImpl` injection, no real-tag requirement in unit tests.
- A shallow checkout without tags keeps reporting that it cannot verify, rather than passing.

## Acceptance Criteria

- [ ] A checkout of a tag **cut under the new order** passes
      `node scripts/validate-action-metadata.mjs`. This is the case that cannot pass today and is
      the point of the task. `v0.4.0` is explicitly not that tag: its tree pins `744a9f1` and it
      is already published, so it will not satisfy the new rule and must not be repaired by
      moving it (`docs/RELEASE_CHECKLIST.md:92-98`).
- [ ] Reverting **every** pin site together to the previous release's commit makes it fail with a
      staleness message, verified by running it — a freshness gate that cannot fail is not a
      gate. Reverting the descriptor alone is not this check: it trips mutual consistency in
      `validateMetadata`, a different gate, which is the mistake made while cutting `0.4.0`.
- [ ] `npm test` stays green, with new cases covering: pin inside the window, pin from the
      previous release, first release with no predecessor, and no tags at all.
- [ ] `docs/RELEASE_CHECKLIST.md` section 5 is updated so the next release does not reintroduce
      the lag by following stale instructions. That file, not the archived task, is the live
      owner of the order: `:87-90` says tag first, then "Update consumer examples to the released
      full commit SHA."
- [ ] The archived `08-08-release-v0-3-0-pin-freshness` is left unchanged. It records one past
      execution; editing it would falsify history.

## Notes

2026-08-22: Found while cutting `0.4.0`. Not a `0.4.0` blocker and deliberately not bundled into
the release-prep PR (#114) — changing a release safety gate inside a release-prep change would
make both harder to review.

An earlier revision of the `0.4.0` survey claimed this lag would cost consumers the event-driven
billing fix. That was wrong; the fix is template-side. The claim was made from commit subjects
without reading the diffs, and the corrected impact is recorded above from
`git show --name-only`.
