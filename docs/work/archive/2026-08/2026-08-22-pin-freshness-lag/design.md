# Design — close the one-release pin-freshness lag

## The constraint that rules out the obvious fixes

`assertPinFreshness` requires `actionSha === latestCommit`. A commit cannot contain its own SHA,
so at the instant a commit is tagged, its in-tree pin cannot equal its own commit. The file
already states this for the sibling gate (`validate-action-metadata.mjs:623-627`):

> a commit cannot embed its own SHA — an infeasible fixed point

Everything follows from that. Two candidate rules were worked through and discarded before the
chosen one, and both are recorded here because they look correct until you trace the release
sequence.

### Discarded: ancestry window against the previous release tag

"Pin is an ancestor of the latest release tag and not an ancestor of the previous one."
Satisfiable on a tagged tree, but it breaks the *pin-advance pull request*. That PR's CI runs
before the new tag exists, so `latest` is still the previous release, and the freshly advanced
pin is a descendant of it, not an ancestor. The gate fails, the PR cannot merge, and the tag
cannot be cut. Deadlock.

### Discarded: ancestry against `HEAD` instead of the tag

Fixes the deadlock and re-opens the hole. Before the new tag exists, the exclusion boundary
falls back to the release before last, so a pin from the previous cycle passes — which is the
lag this task exists to remove. Tightening the boundary to "highest release tag strictly older
than `HEAD`" then fails on ordinary mid-cycle `main`, where the pin legitimately predates the
latest tag.

Every ancestry-window formulation trades the deadlock against the hole, because ancestry cannot
distinguish *which* commits in the gap matter.

## Chosen rule: the pinned commit must carry the release's action code

The invariant consumers actually care about is not where the pin sits in the graph. It is
whether the code at the pin is the code the release ships. State that directly.

A pin is fresh when all three hold against `latestCommit`, the commit of the highest
`v<semver>` tag:

1. The pin resolves to an object in this repository.
2. The pin is an ancestor of, or equal to, `latestCommit`.
3. `<pin>:src` and `<latestCommit>:src` are the same tree, **and** `<pin>:action.yml` and
   `<latestCommit>:action.yml` are the same blob.

Condition 3 is the load-bearing one. Conditions 1 and 2 exist so the rule cannot be satisfied by
a commit outside the release's history that happens to carry matching code.

### Why this is satisfiable where equality is not

Verified against the real commits, not reasoned about:

| commit | `:src` tree | `:action.yml` blob |
| --- | --- | --- |
| `744a9f1` (`v0.3.0`) | `26ad46b` | `78beaf6` |
| `3e41f23` (`v0.4.0`) | `98415e3` | `47a24a6` |
| `09efa5e` (pin advance, #115) | `98415e3` | `47a24a6` |

The pin-advance commit is **action-code-neutral** — it moves 14 pin sites across `examples/`,
`.github/workflows/`, the two descriptors, and three Markdown files, and touches neither `src/`
nor `action.yml`. So a tag placed on it can pin its parent and still satisfy condition 3.

`744a9f1` differs from `3e41f23` in both, so the case R-003 was written for — "this repository
shipped a v0.1.0 pin for the whole v0.2.0 cycle" — still fails. The gate does not get weaker
where it was doing real work.

### What it permits that equality did not

Only lag that provably does not change action behavior. A pin that trails the tag by commits
touching `README.md`, `examples/`, `.trellis/`, or the pins themselves passes. A pin that trails
by one `src/` commit fails, and must be closed by cutting a release rather than by moving the
pin.

Mid-cycle `main` keeps passing: the comparison is pin-versus-tag, never pin-versus-`HEAD`, so
landing a `src/` change on `main` does not turn CI red. It turns red only if someone advances a
pin to a commit whose action code differs from the current release, which is the thing worth
stopping.

A consequence worth naming rather than discovering later: a release that changes only docs,
examples, or `.trellis/` legitimately accepts the *previous* release's pin, because the action
code is byte-identical and consumers cannot observe the difference. That is the rule behaving
as intended, not a hole.

### What the gate reads

`readSetupDescriptor` (`:227`) reads one path, `contract/routed-review-setup-v1.json` — the
value that appeared in the staleness message during `0.4.0`. The installed consumer copy at
`config/routed-review-setup-v1.json` is **not** read by the freshness gate; it is covered by the
mutual-consistency check in `validateMetadata`, which is why reverting the descriptor alone
trips consistency rather than staleness. Do not add a second descriptor read to close that —
the two gates are deliberately separate.

## Release order this enables

The live owner of the release order is **`docs/RELEASE_CHECKLIST.md`**, not the archived
`08-08-release-v0-3-0-pin-freshness`. Section 5 states it:

> - [ ] Create an annotated version tag at the approved candidate SHA and publish a GitHub
>   release with routing, permission, and consumer-adapter notes.
> - [ ] Update consumer examples to the released full commit SHA. The tag is for discovery; the
>   SHA is the immutable installation reference.

Tag, then update pins. That ordering is the direct cause of the lag, and
`docs/RELEASE_CHECKLIST.md:87-90` is the text this task must change. The archived task is a
record of one execution of that checklist and is left alone.

The order inverts, and the inversion is the point:

| | current order | new order |
| --- | --- | --- |
| 1 | merge version bump | merge version bump → `X` |
| 2 | **tag at `X`** | advance every pin to `X` → `Y` |
| 3 | advance pins to `X` → `Y` | **tag at `Y`** |
| result | tag's tree pins the *previous* release | tag's tree pins `X`, inside its own release |

Under the new order the gate is green at every step:

- On the pin-advance PR, before the new tag exists: `latest` is still the previous release, and
  the advanced pin `X` is not an ancestor of it, so condition 2 fails — **this is the one step
  that needs care.** See "The pre-tag window" below.
- On the tagged tree `Y`: pin `X`, ancestor of `Y`, identical action code. Passes.
- On `main` after the tag: same commit, same result.

## The pre-tag window

The pin-advance PR still evaluates against the *old* latest tag. Under the new order that PR
advances pins to `X`, which is a descendant of the old tag — failing condition 2 exactly as the
first discarded design did.

Two ways out were considered:

- **A.** Fold the pin advance into the release-prep commit so there is one commit `X` that bumps
  the version, writes the notes, and pins its own parent. The gate then evaluates `X`'s pin
  against the old tag: pin is the parent of `X`, which *is* a descendant of the old tag. Same
  failure. Does not work without also relaxing condition 2 in the pre-tag window.
- **B.** Make condition 2 accept a pin that is a descendant of `latestCommit` **only when** the
  pin is also an ancestor of `HEAD`. That covers the pre-tag window without loosening the
  post-tag state, because condition 3 still requires matching action code, and a descendant pin
  with different action code fails.

**Resolved: B.** `implement.md` step 3 commits to it and to nothing else. A is recorded above
only because it looks like the simpler answer and is not — folding the pin advance into the
release-prep commit hits the same condition-2 failure, so it does not avoid the branch.

B must be written as an explicit named branch with its own test rather than falling out of a
loosened comparison operator, so a reader can see the pre-tag window is deliberate. If it cannot
be made to pass the falsification check without also admitting a stale pin, the task stops and
reports rather than shipping a gate that cannot fail.

## Boundaries

| system | owns | changed here |
| --- | --- | --- |
| `scripts/validate-action-metadata.mjs` | `assertPinFreshness`, tag enumeration, git seam | yes — the rule and one new git operation |
| `validateReleaseConsistency` | tag/version contract at release time | no — its comment already disclaims the fixed point |
| `validateMetadata` | mutual consistency of first-party references | no — unchanged, and it is what caught the split state during #115 |
| `test/metadata.test.js` | fixture roots that are not git repositories | new cases only, through the injected seam |
| `docs/RELEASE_CHECKLIST.md` | the live release order, section 5 | yes — steps 3 and 4 swap |
| archived `08-08-release-v0-3-0-pin-freshness` | a record of one past execution | no — left as history |

## Git seam

`gitImpl` currently supplies `listReleaseTags` and `resolveTagCommit`. Two operations are added
so tests never touch a real repository:

- `isAncestor(root, ancestor, descendant)` — `git merge-base --is-ancestor`, exit 0 true, exit 1
  false, anything else an error.
- `resolvePathObject(root, commit, path)` — `git rev-parse <commit>:<path>`, returning the tree
  or blob id.

Both must fail loudly when the object is missing. A shallow checkout that cannot resolve the pin
must report that it cannot verify, never pass — same posture as the existing zero-tags branch,
which is a hard failure precisely so the gate is not a no-op under `fetch-depth: 1`.

## Failure and rollback

The change is confined to one exported function plus its seam. Rollback is reverting the commit;
no data, no installed consumer, and no published tag depends on the rule. A wrong rule that is
too strict turns `validate:metadata` red on `main` and is caught by CI on the pull request. A
wrong rule that is too lax is the dangerous direction, which is why the falsification case is an
acceptance criterion rather than a test detail.

## Compatibility

`v0.4.0`'s tagged tree pins `744a9f1` and will **not** satisfy the new rule. That is correct and
expected — it is the defect being described, already published, and it cannot be edited. The
first tag whose tree passes is the one cut under the new order. Nothing reads the gate at install
time, so no consumer changes behavior when this lands.
