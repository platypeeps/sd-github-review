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

## Proposed direction

Replace equality with containment. The pinned commit must be:

- an ancestor of, or equal to, the highest release tag's commit — so it is *inside* the current
  release; and
- **not** an ancestor of the previous release tag's commit — so it is not carried over from an
  earlier release.

That window is satisfiable where equality is not: tag the pin-advance commit, with the pins
pointing at its parent. It is also strictly meaningful — it still rejects the
`v0.1.0`-era-pin-on-`v0.3.0` state that the current gate was written to catch.

Open design questions for `design.md`:

- What the rule does at the first release, when there is no previous tag.
- Whether the release order in `08-08-release-v0-3-0-pin-freshness` inverts (advance pins, then
  tag the advance commit) and what that does to `validate:metadata` on `main` between steps.
- Whether `validateReleaseConsistency` needs the matching change, given its comment already
  disclaims the fixed point.

## Requirements

- A tagged release tree passes the freshness gate with pins pointing inside its own release.
- A pin carried over from a previous release still fails, with a message naming both the pinned
  commit and the release window it falls outside of.
- The first-ever-release case is handled explicitly, not by skipping the check.
- The gate keeps its test seam: `gitImpl` injection, no real-tag requirement in unit tests.
- A shallow checkout without tags keeps reporting that it cannot verify, rather than passing.

## Acceptance Criteria

- [ ] A checkout of the release tag passes `node scripts/validate-action-metadata.mjs`. This is
      the case that cannot pass today and is the point of the task.
- [ ] Reverting the descriptor pin to the previous release's commit makes it fail with a
      staleness message, verified by running it — a freshness gate that cannot fail is not a
      gate.
- [ ] `npm test` stays green, with new cases covering: pin inside the window, pin from the
      previous release, first release with no predecessor, and no tags at all.
- [ ] `08-08-release-v0-3-0-pin-freshness`'s recorded release order is updated, or explicitly
      confirmed unchanged, so the next release does not reintroduce the lag by following stale
      instructions.

## Notes

2026-08-22: Found while cutting `0.4.0`. Not a `0.4.0` blocker and deliberately not bundled into
the release-prep PR (#114) — changing a release safety gate inside a release-prep change would
make both harder to review.

An earlier revision of the `0.4.0` survey claimed this lag would cost consumers the event-driven
billing fix. That was wrong; the fix is template-side. The claim was made from commit subjects
without reading the diffs, and the corrected impact is recorded above from
`git show --name-only`.
