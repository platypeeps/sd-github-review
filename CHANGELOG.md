# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- `high-risk-route` now defaults to `deep` instead of `copilot`. Pull requests
  that match a `sensitive-paths` glob, or that meet `changed-line-threshold`
  (default `800`), are routed to the external deep reviewer rather than to
  native Copilot. This is a behavior change for every consumer that omits the
  input; consumers who set it explicitly, including both shipped PR-Agent
  profiles, are unaffected.

  To keep the previous behavior, set the input explicitly:

  ```yaml
  high-risk-route: copilot
  ```

  On the durable operations path this default also makes `deep-backend`
  load-bearing where it previously was not: the `copilot` route synthesizes its
  own backend, while every other route requires a `{route}-backend` input. A
  durable consumer that omits both `high-risk-route` and `deep-backend` will now
  fail with `deep-backend is required for durable operations` on sensitive or
  large pull requests, where it previously routed to Copilot. Supply a
  `deep-backend`, or set `high-risk-route: copilot`.

### Added

- `examples/gated-review-router.yml`, a cost-optimized profile that runs free
  deterministic checks in a separate `gates` job and reaches the router only via
  `needs:` on it, so no AI review is billed for a pull request that a lint,
  type-check, or test failure would have rejected.
- A `DESIGN.md` section documenting how local review evidence lowers the
  automatic route on the durable operations path, including the payload
  location, the three eligibility conditions, exact-head binding, and the fact
  that the standalone path ignores it entirely.

## 0.2.0 - 2026-08-04

### Added

- Consumer-manifest source provenance. The manifest schema is now version 2 and
  records `source.commit`, `source.tag`, and `source.released`. Provenance is
  resolved from the installer's own source root: a clean checkout of an exact
  `v<version>` tag records `released: true`; an operator-declared `.git`-less
  artifact (`--source-tag`/`--source-commit`, or `SD_SOURCE_TAG`/
  `SD_SOURCE_COMMIT`) records the declared tag with `released: false`; a
  dev/unreleased checkout records `(false, null)`.
- Provenance-aware `check`: reports a migration issue for a pre-provenance
  (schema-1) manifest, a newer-source-commit issue, and a release-tag-drift
  issue. `update` records current provenance and rewrites a schema-1 manifest to
  schema 2.
- Release-hygiene gate in `scripts/validate-action-metadata.mjs`. An always-on
  tier (run by CI through `validate:metadata`) asserts that every first-party
  `platypeeps/sd-github-review@<40-hex>` pin across workflows/examples and the
  descriptor `actionReference` are mutually consistent, that the descriptor
  declares a known `contractMajor`, and that `package.json` `version` is valid
  semver. An opt-in tier (`npm run validate:release -- vX.Y.Z`) additionally
  requires the release tag to equal `v<version>` and not already exist.

### Changed

- The consumer manifest is schema 2. A schema-1 manifest no longer round-trips
  as current; it decodes as an explicit, migration-flagged pre-provenance state
  and is upgraded in place by running `update`.

### Notes

- Recorded provenance is an offline identity record, not a cryptographic
  attestation. Remote/signature verification is out of the installer's
  dependency-free boundary.
- `validate:release` is delivered and unit-tested but not wired into `ci.yml`,
  because a fresh release tag does not exist on ordinary PR/main builds.
