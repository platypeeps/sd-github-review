# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.4.1 - 2026-08-22

**No runtime change.** The `src` tree and the `action.yml` blob are byte-identical
to `0.4.0` (`98415e3` and `47a24a6` at both tags). Consumers already on `0.4.0`
gain nothing by upgrading the action itself; the value is entirely in what the
release *pins*.

### Fixed

- **A release tag can finally carry pins that point inside its own release.**
  `assertPinFreshness` required the descriptor's `actionReference` to equal the
  current release tag's commit. No commit can satisfy that at the instant it is
  tagged, because it would have to contain its own SHA. Pins could therefore only
  advance *after* the tag existed, so every tagged tree permanently carried the
  previous release's pins — `0.3.0`'s tree pins the `0.1.0`-era commit, `0.4.0`'s
  pins `0.3.0`'s. A consumer installing from a release tag ran a release behind,
  and the gap never closed.

  A pin is now fresh when it is reachable from the release commit **and** resolves
  `src` and `action.yml` to the same tree and blob as that commit. That is what a
  consumer actually depends on, and it dissolves the fixed point: a tag placed on
  a pin-advance commit pins its own parent, whose action code is identical.

  The gate does not get weaker where it was doing real work — a pin carried over
  from an earlier release still fails, now naming which of `src` or `action.yml`
  differs. A pin trailing only by commits that change neither is accepted,
  deliberately: consumers run byte-identical code, so the lag is not observable to
  them.

### Changed

- **Releases now advance every first-party pin *before* tagging, and the tag sits
  on the pin-advance commit** (`docs/RELEASE_CHECKLIST.md` section 5). That commit
  must touch neither `src/` nor `action.yml`, which is what lets the resulting tag
  satisfy its own freshness gate. The previous order — tag the candidate, then
  advance pins onto it — is what produced the lag above.

## 0.4.0 - 2026-08-22

`0.3.0` was tagged without a changelog entry. Rather than reconstruct notes for
a release nobody read them for, this entry covers everything since `0.2.0` —
both the `v0.2.0..v0.3.0` and `v0.3.0..v0.4.0` ranges. Entries below are marked
`[0.3.0]` where the change actually shipped in that tag.

This is a minor bump under 0.x because the range carries breaking changes: a
manifest schema bump, a CLI flag that is now required with no default, a
relocated published descriptor, a new installed file set, and a changed routing
default.

### Breaking

- **The consumer manifest is schema 4, and `--route-mode` is required on a fresh
  install with no default.** The installer manages `REVIEW_ROUTE_MODE` as a
  repository variable; valid values are `auto`, `cheap`, `deep`, `copilot`, and
  `none`. Automation that installs without the flag now fails. Existing schema-2
  and schema-3 manifests migrate in place through `update`. The mode may also be
  read from the repository's `REVIEW_ROUTE_MODE` variable instead of the flag.
- **The published setup descriptor moved to `contract/routed-review-setup-v1.json`,
  off the consumer probe path.** The installed consumer copy stays at
  `config/routed-review-setup-v1.json`. Previously both lived on the probe path,
  so this repository self-matched as an installed consumer. First-party consumers
  reading the descriptor from the old published location must update.
- **`install` now writes two files per consumer instead of one**: the setup
  descriptor and the durable `.github/workflows/sd-review.yml` lane. A repository
  installed before this version has neither; run `update` or `adopt`.
- **`high-risk-route` now defaults to `deep` instead of `copilot`.** Pull requests
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

- Deterministic pre-routing gates and cost-biased router defaults, so a pull
  request that a free deterministic check would reject never reaches a billed
  reviewer.
- `examples/gated-review-router.yml`, a cost-optimized profile that runs free
  deterministic checks in a separate `gates` job and reaches the router only via
  `needs:` on it, so no AI review is billed for a pull request that a lint,
  type-check, or test failure would have rejected.
- First-party pin freshness is now enforced: every
  `platypeeps/sd-github-review@<40-hex>` pin across workflows and examples, and
  the descriptor `actionReference`, must be mutually consistent and current.
- `adopt`, which takes a manually installed review workflow into installer
  ownership instead of requiring an uninstall/reinstall cycle. `[0.3.0]`
- Timeouts bounding every GitHub request and installer subprocess, with retry
  guidance that distinguishes read from mutating `gh` subcommands. `[0.3.0]`
- `npm run check:full`, a local gate aligned with the CI package gates. `[0.3.0]`
- A `DESIGN.md` section documenting how local review evidence lowers the
  automatic route on the durable operations path, including the payload
  location, the three eligibility conditions, exact-head binding, and the fact
  that the standalone path ignores it entirely.

### Fixed

- **The event-driven lane billed PR-Agent on every pull request.** It now routes
  only when a route is actually selected. This is a cost fix, and the largest
  consumer-visible defect closed in this range.
- The event-driven lane now fails closed when no explicit route is configured,
  rather than proceeding with an implicit one, and honors the review floor that
  previously applied only to the other lane.
- **The installer's provider-secret gate is route-mode aware.** `planResources`
  and `check` refused every install without `PR_AGENT_MODEL_API_KEY` regardless
  of mode. `copilot` and `none` reach no PR-Agent provider — both installed lanes
  bind the secret only inside provider guards that fall through to `''` — so they
  now install without the credential. `auto`, `cheap`, and `deep` are unchanged:
  `auto` resolves at review time and can lower to a PR-Agent route, so relaxing
  it would move the failure from install time to review time.
- `createManifest` now receives source provenance at both call sites; one path
  previously recorded a manifest without it.
- **A secret could reach the error arguments of a nonzero `gh` exit.** It is now
  redacted. `[0.3.0]`
- Symlinked installer targets are rejected rather than followed. `[0.3.0]`
- An authorized rerequest now forces a fresh Copilot review instead of reusing a
  stale one, while same-head rerequests reuse a single receipt snapshot rather
  than re-reading it. `[0.3.0]`
- The PR-Agent reviewer is isolated from receipt authority. `[0.3.0]`
- Route-control precedence is applied before label parsing, so an explicit route
  control is no longer overridden by a label. `[0.3.0]`
- An installer update interrupted before workflow replacement now resumes
  instead of leaving the target half-updated. `[0.3.0]`
- Pull request file enumeration is skipped when no sensitive paths are
  configured, and installer inspection reads are issued in parallel. `[0.3.0]`

### Internal

- Eight `src/` modules defining the v2 review protocol — `protocol-v2`,
  `retention-policy`, `review-budget-ledger`, `review-candidate-catalog`,
  `review-deferred-recovery`, `review-plan-authorization`,
  `review-usage-reconciliation`, and `routed-review-compiler` — are unreachable
  from `src/index.js` and are exercised only by tests. They are contract
  definitions, not wired behavior, and have no consumer-visible effect. Most were
  added in the `v0.2.0..v0.3.0` range and already shipped in `0.3.0`; this
  release neither introduces nor changes that. Their reachability is tracked
  separately.
- The consumer installer lifecycle was decomposed, routing policy boundaries
  consolidated, and every managed-resource list derived from a single table.

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
