# Design — Release v0.3.0, pin freshness, contract-major range, v2 quarantine

## Constraint discovered before design: the fixed point is already known

`scripts/validate-action-metadata.mjs:509-513` carries an explicit comment on
`validateReleaseConsistency`:

> Opt-in release-hygiene gate for the operator at release time. It layers a
> tag/version contract on top of the always-on validateMetadata checks. It does
> NOT assert example pins equal the release commit (a commit cannot embed its
> own SHA — an infeasible fixed point).

Requirement 3 in `prd.md` asks for an assertion that the descriptor's
`actionReference` "resolves to the current release". Read as *the release being
cut*, that is the exact fixed point the existing code deliberately refuses, and
it cannot be implemented. Read as *the latest release that already exists*, it
is both implementable and strictly stronger than what is there today.

This design takes the second reading. It is not a weakening: the check below
fails on `main` as the repository stands right now, which is the defect the
requirement exists to catch.

## Decisions

### D1 — `v0.3.0` is cut from current `main`, before the pin change lands

Tag `v0.3.0` at `744a9f138bba7c60272c7f9e3f8412e435e11b89` (`main` as it stands).
That commit is the Action exactly as shipped today; the work in this task is
tooling and metadata, not Action runtime behavior, so nothing about the released
artifact is misrepresented.

Ordering is then: tag exists first, pin change second. The freshness assertion
can only resolve a tag that already exists, so cutting the tag after the PR
would make the PR's own CI red.

`prd.md` AC 1 (`git tag --points-at HEAD` includes `v0.3.0`) is unsatisfiable
alongside AC 3 (all references pin the `v0.3.0` SHA) and is corrected in the PRD
to: `v0.3.0` exists and every first-party reference resolves to it.

### D2 — Freshness is measured against the latest existing release tag

The check:

- enumerate `v<semver>` tags, pick the highest by semver precedence;
- resolve it to a commit;
- require `descriptor.actionReference`'s SHA to equal that commit.

Self-reference is impossible by construction: the pinned tag is always cut from
an ancestor commit, and the commit that advances the pin is a descendant of it.

Failure behavior today, unchanged repository:

| Input | Value |
| --- | --- |
| latest release tag | `v0.2.0` |
| that tag's commit | `b8d4872815e6b92cf22e9c9720a0a9311616e8c7` |
| descriptor `actionReference` | `...@8636a3983d18de17c49907a4c48170a61b1bb713` |
| result | fail — pin is one release behind |

That is the true current state: `v0.2.0` was published 2026-08-04 and the pins
were never advanced off `v0.1.0`. The check earns its place by catching a defect
that actually happened, not a hypothetical one.

### D2a — The check lives beside `validateMetadata`, not inside it

An earlier draft of this design put the assertion inside `validateMetadata`.
That is wrong and would have broken the suite. `test/metadata.test.js` calls
`validateMetadata` at 20 sites, and most pass a synthetic fixture root under a
temp directory that is **not a git repository** (`:502`, `:530`, `:544`, `:572`,
`:584`, `:595`, `:606`, `:613`, `:624`, `:638`, `:648`, `:656`, `:664`, `:707`,
`:736`). A git-tag lookup against those roots fails on the repository probe, not
on pin staleness, so every one of those fixtures would throw for an unrelated
reason.

Instead, export a separate `assertPinFreshness({ repositoryRoot, gitImpl })` and
call it from:

- the CLI entrypoint (`validate-action-metadata.mjs:567`), which is what
  `npm run validate:metadata` runs and what CI gates on; and
- `validateReleaseConsistency`, so the release-time gate inherits it.

`validateMetadata`'s signature and its 20 fixture call sites are untouched. The
check is still unconditional on every path CI actually executes, which is what
requirement 3 asks for; it simply is not imposed on callers passing a synthetic
root. `gitImpl` injection mirrors the existing `gitImpl.tagExists` seam at
`validate-action-metadata.mjs:531`, so the new tests drive it without needing
real tags.

### D3 — Absent tags must fail, not skip

`.github/workflows/ci.yml:15` uses `actions/checkout@v4` with defaults, so CI
has `fetch-depth: 1` and **no tags**. A tag-derived check would silently find
nothing and pass, in the one environment where it has to bite.

Two coupled changes:

- `ci.yml` checkout gains `fetch-depth: 0` so tags are present;
- the check throws when zero `v<semver>` tags are found, rather than skipping.

A skip-on-absent design is rejected explicitly: it converts the gate into a
no-op under the default checkout configuration, which is how the repository
arrived at a badly stale pin with a green gate.

On the staleness figure: `prd.md` and `task.json` both record 252 commits, which
was correct on 2026-08-08 when they were written. The live count is 254 as of
2026-08-09, because PRs #60 and #61 merged in between. Both are accurate as of
their own date and neither is corrected here — the count is a moving
measurement, and pinning a fresh number into the artifacts only guarantees they
disagree again after the next merge. What must not drift is the SHA itself.

### D4 — `supportedContractMajors` is additive

Add a `supportedContractMajors` array to the descriptor beside the existing
scalar `contractMajor`. Validation: non-empty, every element in
`knownContractMajors`, and the scalar `contractMajor` present among them.
Consumers keep reading the scalar; the array is new information, so no consumer
breaks.

### D5 — Quarantine is gate-configuration only, never deletion

The eight unreachable modules stay in the tree, byte-identical. Only coverage
and the `check` syntax gate stop measuring them. The parked v2 tasks must remain
recoverable verbatim, which deletion would defeat.

Deletion is additionally ruled out by a live test:
`test/dependency-boundaries.test.js:60` reads `src/` from disk and asserts every
module present is covered by the allowed-import matrix (`:90`) and that every
matrix entry still exists (`:94`). Removing the files breaks that test in both
directions. Keeping them on disk is what makes quarantine safe.

There is no lint gate to change — the repository's `check` script is a
`node --check` syntax pass, and CI runs no separate linter
(`.github/workflows/ci.yml:20-25`). `prd.md`'s "coverage, lint, and any size or
budget gate" over-enumerates what exists; the real surfaces are `package.json`'s
`check` script and `scripts/check-coverage.mjs`.

### D6 — Quarantine needs no floor changes; this was measured, not assumed

Excluding the eight modules from coverage was measured against the real suite
before planning closed:

| Metric | Before | After | Floor |
| --- | --- | --- | --- |
| lines | 93.22 | 93.68 | 88 |
| branches | 82.76 | 83.98 | 77 |
| functions | 97.18 | 95.02 | 88 |

Functions falls 2.16 points and still clears its floor by 7. `GLOBAL_FLOOR` and
`FILE_FLOORS` therefore stay untouched, and `FILE_FLOORS` names none of the eight
modules anyway (`check-coverage.mjs:30-42`).

This matters beyond convenience: lowering a floor to turn a red gate green would
be weakening a deterministic check, which this run has no authority to do. The
measurement is what establishes the question never arises.

## Blast radius

The stale SHA appears at **13** tracked sites, not the 9 the PRD tabulates. The
PRD's requirement text says "nine first-party references"; AC 2's repo-wide grep
is the stricter statement and is the one that governs.

| File | Lines | Kind |
| --- | --- | --- |
| `config/routed-review-setup-v1.json` | 21 | descriptor pin |
| `examples/review-router.yml` | 21 | workflow pin |
| `examples/pr-agent-router.yml` | 22 | workflow pin |
| `examples/on-demand-review-router.yml` | 40, 65 | workflow pin |
| `examples/pr-agent-on-demand-review-router.yml` | 52, 168, 176 | workflow pin |
| `examples/pilot-router.yml` | 21 | workflow pin |
| `README.md` | 87 | prose mention |
| `SETUP-COPILOT.md` | 58 | prose mention |
| `SETUP-PR-AGENT.md` | 123, 273 | prose mention |

`SETUP-PR-AGENT.md:123` additionally carries `--source-tag v0.1.0` next to the
SHA; the tag name must move to `v0.3.0` in the same edit or the two halves of
that command disagree.

## Rollout and rollback

Rollout is one PR on top of an already-published tag. Rollback is `git revert`
of that PR: the pins return to `8636a39` and the freshness check returns with
them, so the gate stays self-consistent in both directions. The `v0.3.0` tag
itself is left in place on rollback — an already-published release is not
withdrawn to undo a metadata change.

## Out of scope

Publishing the `v0.3.0` tag and GitHub release. That is an outward-facing action
the operator performs; this task's automated scope begins once the tag exists.
