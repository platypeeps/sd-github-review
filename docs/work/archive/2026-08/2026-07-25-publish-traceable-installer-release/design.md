# Publish traceable installer release Design

## Boundary

- Release automation proves source identity; it does not silently update consumer
  repositories.
- Consumer manifests record provenance (release tag and commit) without storing
  credentials or local checkout paths.
- This task's in-authority code/docs land the provenance and validation surface.
  Cutting the actual GitHub release and choosing its version number are operator
  decisions and stay out of the autonomous boundary; acceptance criteria 1 and 4
  remain open until that release is cut.

## Provenance resolution

The installer resolves its own source release identity from the installer source
root (the checkout the installer scripts ship in), not from the consumer:

The record has three fields with one unambiguous contract (resolving Codex N2):

- `commit` — 40-hex; the git `HEAD` (`git rev-parse HEAD`), or the operator's
  `--source-commit` for a `.git`-less artifact. Always recorded.
- `released` — `true` **only** on the bytes-verified released path (defined
  below). It is the single trustworthy field: `released: true` means "installed
  from a clean checkout of a qualifying release tag."
- `tag` — a `v<semver>` string, or `null`. It is non-null in exactly two cases:
  a git-verified qualifying release tag (with `released: true`), or an
  operator-**declared** release tag on the `.git`-less path (with
  `released: false`). It is `null` only when no qualifying tag is available (a
  dev/unreleased checkout, or a git resolution that fails the release-tag rules
  below). There is never an "arbitrary non-`v<semver>` tag recorded verbatim"
  case — a non-qualifying git tag is treated as no tag. So the `(released, tag)`
  pair alone is unambiguous: `(true, v-tag)`, `(false, v-tag)`, `(false, null)`.

On the git path, `released: true` requires **all** of the following (any failure
yields `released: false`, `tag: null`):

1. an exact git tag resolves for `HEAD` (`git describe --tags --exact-match`);
2. that tag equals `v<version>` from the source `package.json` — an arbitrary
   local tag (`wip`) or a version mismatch does not qualify (Codex C-2 floor);
3. **the shipped bytes match the tagged commit** — the working tree is clean for
   `TEMPLATE_PATH` (`git status --porcelain -- <template>` empty), so a dirty
   template at a tag cannot record a clean-tag lie (Codex C-1).

Git access is injected (a `gitImpl`/`sourceRoot` seam mirroring `gitOutput`) so
behavior is deterministic under test. Two source shapes:

- **git checkout of the release tag** — the primary path; `released` auto-resolves
  by the three rules above.
- **`.git`-less released artifact** — the operator supplies `--source-tag` /
  `--source-commit` (or `SD_SOURCE_TAG` / `SD_SOURCE_COMMIT`), shape-validated
  (`v<semver>` tag, 40-hex commit). Because the installer cannot verify archive
  bytes against a commit offline, this path records `commit` and the declared
  `tag`, but **`released: false`**. `released: true` therefore *only ever* means
  the bytes-verified git path (closing Codex C-1/C-2 for the archive path too),
  while a git-less install still records traceable declared provenance (AC4
  reachable, Codex C-6).

The `(released, tag)` pair encodes provenance source without an extra field:
`(true, v-tag)` = git-verified release; `(false, v-tag)` = operator-declared
(archive); `(false, null)` = unreleased/dev.

When neither a git identity nor an operator override is available, resolution is
a bounded explicit failure ("installer source has no git identity; run from a
cloned release tag or pass --source-tag/--source-commit"), never a silently empty
record.

Recorded provenance is an identity record, not a cryptographic attestation.
Remote/signature release verification is deliberately out of the installer's
offline, dependency-free boundary; the operator runs the installer against their
own repository, so self-declared provenance grants them no privilege. Provenance
answers "which released source produced this install" for honest installs, and
`check` detects drift. This is a documented, bounded trust floor, not an
unbounded hole (rebutting the residual Codex C-1/C-2 demand for remote proof).

## Manifest schema

Bump `schemaVersion` from `1` to `2`. `source` gains `commit` (40-hex, required),
`tag` (release tag string or `null`), and `released` (boolean). `source.template`
and `source.sha256` are unchanged, and `source.sha256` must still equal
`workflow.sha256`.

A legacy `schemaVersion: 1` manifest decodes as a pre-provenance installation:
it is accepted read-only, its provenance is reported as unknown, and `check`
surfaces an explicit migration issue rather than a hard decode failure.

Decode invariants (no separate provenance-source field): the `tag` field, when
non-null, is always `v<semver>` shape; `released: true` requires a non-null
`v<semver>` `tag`; `released: false` allows `tag` either null (dev/unreleased) or
a declared `v<semver>` tag (archive path). Any other combination fails decoding.

## `check` and `update` migration

`check` compares the manifest's recorded provenance against the source root's
currently resolved release identity (read-only, additive to the existing bounded
issue list):

- recorded `commit` differs from the source `commit` -> a newer source is
  available (existing "run update" drift, now provenance-aware);
- manifest is schema 1 (pre-provenance) -> a migration issue ("run update to
  record provenance");
- a released manifest whose `tag` no longer matches the source's resolved tag ->
  provenance drift.

`update` performs the migration: decoding accepts a schema-1 manifest, and the
rewrite emits a schema-2 manifest with freshly resolved provenance. So a
schema-1 consumer is upgraded in place by running `update`; `check` is the
read-only signal that it is due (Codex C-7). A schema-1 `update` must be covered
by a test that asserts the resulting manifest is schema 2 with a recorded
commit.

## Release validation gate

The gate uses referents that already exist in the repository and can genuinely
drift, rather than an invented declaration compared against itself. The
first-party self-reference SHA set is **every** first-party `platypeeps/sd-github-review@<40-hex>`
pin, across two sources (Codex C-4 — the descriptor was previously omitted):

- all `uses: platypeeps/sd-github-review@<40-hex>` in shipped workflows/examples
  (the five `examples/*.yml` currently pin `8636a398…`), and
- the descriptor's `actionReference` in `config/routed-review-setup-v1.json:21`
  (also `8636a398…` today).

**Why the gate cannot bind pins to the release commit being cut (Codex N1).** A
commit's own SHA cannot appear in its own tree — editing an example to embed the
new SHA changes the tree and therefore the commit, an infeasible fixed point. So
"first-party SHA consistency" is defined as *mutual consistency*, not
self-reference. Advancing the pins to release N is a documented follow-up commit
that ships to release N+1's consumers; the gate never demands the impossible
self-embed.

The gate is two-tier, resolving the "no viable pre-release interface" problem
(Codex C-3):

- **Always-on consistency** (added to `validateMetadata`, which `ci.yml` runs on
  every PR/main): all first-party self-reference SHAs (workflows/examples **and**
  the descriptor `actionReference`) are mutually equal and 40-hex; the descriptor
  is present with a known `contractMajor`; and `package.json` `version` is valid
  semver. These hold on the current repository today (every pin is `8636a398…`;
  the descriptor exists; `0.1.0` is semver), so adding them does not break
  ordinary CI — they only fail on real drift.
- **Opt-in release hygiene** (`validateReleaseConsistency({ releaseTag })`, run by
  the operator at release time): the always-on consistency plus `releaseTag`
  equals `v<version>` and does not already exist as a tag. It does **not** assert
  pins equal the release commit (see N1); it verifies the tag/version contract
  the operator controls. Absent a supplied tag it runs consistency only; nothing
  is silently skipped.

Both tiers read tracked files plus the installer's exported code constants and
fail closed with a bounded reason. The always-on tier is pure (no git). The
opt-in tier needs git only for its tag-existence check, through an injected
`gitImpl` seam (default: real `git tag --list <tag>`), so it stays testable.

**Operational interface.** The opt-in tier is reachable, not just an unused
export:

- a `validate:release` npm script → `node scripts/validate-action-metadata.mjs
  --release-tag vX.Y.Z`; the CLI entrypoint parses `--release-tag` (also
  `SD_RELEASE_TAG`) and calls `validateReleaseConsistency({ repositoryRoot,
  releaseTag, gitImpl })`, printing a bounded pass/fail line;
- the operator runs it at release time; it is intentionally **not** wired into
  `ci.yml` (which keeps running only the always-on `validateMetadata`), because a
  fresh release tag does not yet exist on ordinary PR/main and requiring one
  would fail closed on every normal build.

The release tag is supplied by the operator, never guessed. Because this run does
not cut a release, `validate:release` is delivered and unit-tested but is not part
of this iteration's own merge gate.

Note the two independent "schemaVersion" values that must not be conflated: the
consumer-install manifest schema (bumped 1 -> 2 here) and the action contract
descriptor's `schemaVersion`/`contractMajor` (unchanged). The gate touches only
the latter.

## Data Flow

```text
reviewed commit -> version/tag validation -> released installer/templates
  -> provenance-bound consumer manifest (schemaVersion 2: commit, tag, released)
  -> check compares recorded provenance against resolved source identity
```

## Compatibility

Preserve current public behavior except where A-007 identifies behavior that is
unsafe, incorrect, or unsupported. The schema bump is the one intentional
breaking change: a v1 manifest no longer round-trips as current, but decodes as
an explicit, migration-flagged pre-provenance state rather than an error. Every
changed failure is explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new
duplicate side effect, data escape, secret exposure, or incompatible consumer
transition, restore the prior implementation while retaining the new failing
fixture.

Consumer-facing rollback must reckon with a hard fact (Codex C-5, verified via
`git ls-tree v0.1.0`): **v0.1.0 ships no installer** — it predates
`scripts/consumer-installer.mjs` entirely (this is A-007's own evidence that the
installer is post-v0.1.0). So "roll the installer back to v0.1.0" is not a real
path; there is no prior installer-bearing release yet.

Two distinct operations, documented separately, both using only released
artifacts (AC4):

- **Forward v0.1.0 migration** (what A-007's `README.md`/`SETUP-PR-AGENT.md`
  evidence is about): a consumer set up by the old v0.1.0-era manual/`docker run`
  guidance moves to the installer flow — run the current release's `install`.
  This is the migration advisory the docs add.
- **Rollback of an installer-based install**: `uninstall` at the current release
  cleanly removes the schema-2 manifest and workflow (no old decoder ever sees a
  schema-2 manifest). Reinstalling a *prior* release requires a prior
  installer-bearing release, which exists only once the operator has cut two of
  them; until then, rollback terminates at the clean `uninstall`ed state. The
  docs state this bound rather than promising a nonexistent v0.1.0 installer.

Development rollback of this change itself: restore the prior implementation while
retaining the new failing fixture.
