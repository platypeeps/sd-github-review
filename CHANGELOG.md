# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **The durable lane now enforces the repository's recorded `REVIEW_ROUTE_MODE`.**
  The installer has managed that variable since manifest schema 4, and
  `examples/pr-agent-router.yml` gated on it, but the durable lane never read it:
  `grep -n "REVIEW_ROUTE_MODE" examples/sd-review.yml` returned nothing. A
  consumer installed `--route-mode copilot` would still route `cheap` when
  dispatched `sd-review --remote cheap`, contradicting what the operator declared
  at install time. Measured on a live scratch consumer during the 0.4.x pilot.

  The `route` operation takes a new `route-policy` input, wired in
  `examples/sd-review.yml` **directly to `${{ vars.REVIEW_ROUTE_MODE }}`** — not
  through a `workflow_dispatch` input like its neighbours, because the caller the
  policy constrains is a `workflow_dispatch` caller who could otherwise supply
  their own policy. An explicit route outside the policy is refused, naming the
  variable, its value, and the permitted route.

  Two properties are worth stating because they are easy to get backwards:

  - The policy bounds the **requested** route, never the resolved one. `auto` is
    always permitted, so `independent-review-floor` (a *minimum*) and the route
    policy (a *maximum*) compose instead of contradicting. Enforcing against the
    resolved route would let a consumer's own `copilot` floor raise an `auto`
    request above a `cheap` policy and refuse it — breaking every default review
    on that consumer.
  - Membership, not `ROUTE_STRENGTH` ordering. That ordering ranks assurance
    (`none < cheap < deep < copilot`), not cost, so "anything weaker than the
    policy" would permit the paid `deep` route under a `copilot` policy — exactly
    the route a provider-free consumer holds no credential for.

  An absent or empty policy permits every route, so consumers below manifest
  schema 4 are unaffected. An unrecognized value fails the dispatch rather than
  silently disabling enforcement.

  **Consumers must run `update` to take the new template.** This lands on top of
  the schema-5 backend-variable migration below; one `update` covers both.

### Fixed

- **The consumer installer now provisions the two backend descriptors the durable
  lane reads, so an install produces a lane that serves every route it offers.**
  `examples/sd-review.yml` supplies `cheap-backend` / `deep-backend` from
  `vars.SD_REVIEW_CHEAP_BACKEND_V1` and `vars.SD_REVIEW_DEEP_BACKEND_V1`, and
  nothing created them — `grep -rn "SD_REVIEW_.*_BACKEND_V1" scripts/` returned
  nothing at all. An unset variable expands to the empty string, which
  `selectedBackend` rejects with `<route>-backend is required for durable
  operations`.

  This was **not** a rollout blocker, and the correction is worth stating: the
  installed template's `independent-review-floor: copilot` raises every
  *automatic* route to `copilot`, which synthesizes its own backend, so a review
  dispatched at the default `--remote auto` never read either variable. But the
  floor does not override an *explicit* route. `sd-review --remote cheap` against
  an installed consumer routed `cheap`, reached the external branch, and failed —
  ordinary documented usage of the pack's own CLI, with nothing on the consumer
  side to diagnose it.

  Two things made it worse than an ordinary bug. `check` could not detect it,
  because drift detection is scoped to the managed variable table, so a consumer
  with a non-functional durable lane reported healthy. And the pilot could not
  detect it either: `sd-github-review-pilot` had both variables set by hand and
  its pilot workflow passes `cheap-backend` directly, so it was configured around
  the defect from both directions.

  The descriptors are **synthesized** from the recorded configuration rather than
  stored beside it, so provider and model stay the single source of truth. They
  are provisioned unconditionally, including under `copilot` and `none`, because
  neither route mode nor the review floor durably constrains which route a
  dispatch may select. A descriptor is not a credential: the PR-Agent step still
  binds `PR_AGENT_MODEL_API_KEY` inside a provider guard that falls through to
  `''`, so a `copilot`/`none` consumer still installs with no provider secret.

### Changed

- **Consumer manifest schema 4 → 5**, gated on a new `BACKEND_MIN_SCHEMA_VERSION`
  rather than on equality with `MANIFEST_SCHEMA_VERSION`, matching how
  `REVIEW_ROUTE_MODE` joined at 4. Manifests at schema 1 through 4 keep decoding
  and `update` migrates them with no manual step.
- **`check` will newly report existing consumers as needing both variables.** Any
  consumer installed before this change — every one in the fleet, including
  `sd-github-review` itself — reports `GitHub variable SD_REVIEW_CHEAP_BACKEND_V1
  is missing`, its `_DEEP_` counterpart, and a `manifest predates durable backend
  management` migration issue. That report is accurate rather than noise: those
  lanes really do fail on `cheap` and `deep`. Run `update` to resolve it.

### Known limitations

- The durable lane still takes its route from the dispatched request and never
  reads `REVIEW_ROUTE_MODE`, so installing with `--route-mode copilot` does not
  prevent a `--remote cheap` dispatch from routing `cheap`. That is a separate
  defect about which routes are *permitted*, tracked on its own, and deliberately
  not folded in here — this change alters what is *provisioned*.

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
