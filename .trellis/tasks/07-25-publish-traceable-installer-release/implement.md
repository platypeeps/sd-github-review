# Publish traceable installer release Implementation Plan

## In-authority scope (this run)

Land the provenance and validation code/docs. Do NOT cut the GitHub release or
choose the version number — those are operator actions. Acceptance criteria 1
and 4 stay open until the operator cuts the release; the task is not archived.

1. `scripts/consumer-installer.mjs`:
   - Add `resolveSourceRelease({ sourceRoot, gitImpl, version, override })`
     returning `{ commit, tag, released }`:
     - git path: `rev-parse HEAD` + `describe --tags --exact-match HEAD`;
       `released` true only when the tag is `v<version>` shape AND the template
       working tree is clean (`status --porcelain -- <TEMPLATE_PATH>` empty) —
       binds the record to installed bytes;
     - override path (`.git`-less artifact): operator `--source-tag`/`--source-commit`
       (or `SD_SOURCE_TAG`/`SD_SOURCE_COMMIT`), shape-validated (`v<semver>` tag,
       40-hex commit); records commit + declared tag but **`released:false`**
       (offline bytes cannot be verified);
     - fail closed with a bounded message when neither is available.
   - `released:true` is thus the single bytes-verified git path; `(released,tag)`
     encodes source: `(true,v-tag)`=git-verified, `(false,v-tag)`=declared,
     `(false,null)`=dev.
   - Export `MANIFEST_SCHEMA_VERSION` (=2). Extend `createManifest` to write it
     and `source.{commit,tag,released}`.
   - Extend `decodeManifest`: schema-2 invariants — non-null `tag` is `v<semver>`;
     `released:true` requires a non-null `v<semver>` tag; `released:false` allows
     tag null or a declared `v<semver>` tag. Accept a legacy schema-1 manifest as
     a migration-flagged pre-provenance state.
   - Thread the resolved release through `installOrUpdate` (install + schema-1→2
     `update` migration) and `checkInstallation`; add provenance/migration issues
     to the `check` bounded issue list. Add the two override flags to
     `parseArguments` for install/update only.
2. `scripts/validate-action-metadata.mjs` release-consistency gate (reuse existing
   referents; never require a commit to embed its own SHA — Codex N1):
   - first-party self-reference SHA set = every `uses: platypeeps/sd-github-review@<40-hex>`
     in shipped workflows/examples **plus** the descriptor `actionReference` in
     `config/routed-review-setup-v1.json` (Codex C-4); all must be mutually equal
     and 40-hex;
   - compatibility classification: assert `config/routed-review-setup-v1.json`
     exists and declares a known `contractMajor`;
   - version: `package.json` `version` is valid semver.
   - Two-tier: fold the mutual-consistency + descriptor + semver checks into
     always-on `validateMetadata` (passes today, CI stays green); export
     `validateReleaseConsistency({ repositoryRoot, releaseTag, gitImpl })` as the
     opt-in release-hygiene gate — always-on checks plus `releaseTag === v<version>`
     and the tag does not already exist (via injected `gitImpl`, default
     `git tag --list`). It does NOT assert pins equal the release commit
     (impossible fixed point).
   - Operational interface: parse `--release-tag`/`SD_RELEASE_TAG` in the CLI
     entrypoint and call `validateReleaseConsistency`; add a `validate:release`
     npm script. Do NOT wire it into `ci.yml` (no release tag exists on ordinary
     PR/main). This run delivers + unit-tests it but does not cut a release, so it
     is not part of this iteration's merge gate.
3. Executable spec: update `.trellis/spec/backend/consumer-installer.md` for the
   schema-2 manifest and provenance fields (it currently declares schema
   "version 1"); it is the source-of-truth contract for this boundary.
4. Docs (two distinct operations — Codex C-5; v0.1.0 has no installer):
   - `README.md`/`SETUP-PR-AGENT.md` FORWARD v0.1.0 migration = move a
     v0.1.0-era manual/`docker run` setup onto the installer flow (clone-the-tag
     install, `.git`-less override flags, schema-2 note);
   - rollback of an installer-based install = `uninstall` at the current release
     (clean removal; no old decoder sees a schema-2 manifest); a prior-release
     reinstall needs a prior installer-bearing release, which does not exist until
     the operator cuts a second — state the bound, do not promise a v0.1.0
     installer;
   - `CHANGELOG.md` entry: schema-2 provenance + the release gate.
5. Tests:
   - `test/consumer-installer.test.js`: provenance capture; injected-git seam;
     dirty-template-at-tag → `released:false`; arbitrary/mismatched tag not
     `released`; override path records `(false, v-tag)`; schema-1 decode as
     pre-provenance; schema-1 `update` rewrites to schema-2 with a recorded
     commit; provenance-aware `check` (newer commit, migration, tag drift).
   - `test/metadata.test.js`: always-on consistency passes on the repo;
     inconsistent self-reference SHA (incl. a drifted descriptor `actionReference`)
     rejected; missing/unknown descriptor rejected; non-semver version rejected;
     `validateReleaseConsistency` (with an injected `gitImpl`) accepts
     `releaseTag === v<version>` for a not-yet-existing tag, rejects a version
     mismatch, and rejects an already-existing tag — without asserting pins equal
     the release commit.

## Validation

- Run the focused test files for the changed boundary.
- Run `npm test`.
- Run `npm run check`.
- Run `npm run validate:metadata`.
- Run `git diff --check`.

## Rollback Gate

Do not ship if the A-007 regression fixture fails or if an existing exact-head,
privacy, ownership, or no-duplicate-side-effect guarantee regresses. The release
cut itself is deferred to the operator regardless of gate state.
