# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.1 - 2026-08-23

### Security

- **The PR-Agent workflow copies no longer grant `issues: write`.** Every lane
  that granted it was one of these — eight occurrences across `examples/sd-review.yml`,
  `examples/pr-agent-router.yml`,
  `examples/pr-agent-on-demand-review-router.yml`,
  `.github/workflows/sd-review.yml`, and
  `.github/workflows/ai-review-router.yml` — and nothing needed it. In the router
  lane the grant reached the third-party PR-Agent container, handing a pinned but
  third-party image write access over every issue in the repository for no
  functional reason. `SETUP-PR-AGENT.md` instructed consumers to grant it, so
  every repository that followed the documented setup is over-granted until it
  takes this release.

  The belief rested on a mismatch between GitHub's REST *layout* and its
  permission scopes. On a pull request, conversation comments, labels, reactions,
  comment edits, and issue events are all `/repos/{owner}/{repo}/issues/{n}/…`
  paths — because GitHub models pull requests as issues in the REST layout — but
  they are governed by `pull-requests: write`, not by the `issues` scope. Reading
  the path was never going to settle it. Probing it did: runs 32623601322 and
  32623799937 exercised every one of those endpoints from jobs holding exactly
  `contents: read` + `pull-requests: write`, and the resulting comment was
  confirmed present on the pull request rather than silently dropped.

  Two gates now keep the grant from drifting back. `assertDescriptorLaneGrants`
  compares everything the setup descriptor's own lane grants -- its jobs'
  effective permissions folded with its workflow-level block -- against
  `requiredPermissions` for set equality, fails in **both** directions, and names
  which side drifted; `assertNoDeadIssuesGrant` sweeps every lane enumerated from
  disk and refuses the `issues` scope outright. Both were proven by mutation
  before being believed, not first observed passing.

  Both also fail closed on a declaration they cannot read, which is the general
  form of the defect this release corrects: an input the validator could not
  parse used to score as granting nothing, so the lane whose scopes were unknown
  was the one that reported clean. Absent, bare, and malformed `permissions:`
  blocks are now rejected rather than ignored, scope names are checked against
  the set GitHub defines, and each scope's level is checked against the set
  GitHub accepts *for that scope* -- `models` takes no `write` and `id-token`
  takes no `read`, both settled by probing GitHub's workflow parser across all
  15 scopes and 3 levels rather than read off the documentation.

### Corrected

- **`0.6.0` recorded the fleet reviewer's "the setup descriptor under-declares
  `issues: write`" finding as a false positive. That was wrong.** The finding was
  *directionally inverted*, not false. The reviewer saw a real asymmetry between
  what the lanes grant and what the descriptor declares, and named the wrong side
  of it: the descriptor was correct and the lanes over-granted. `0.6.0` also left
  "which lane is right" open pending a credentialed PR-Agent run. That framing
  was itself the mistake — the question was never what PR-Agent does, it was what
  a token holding `contents: read` + `pull-requests: write` may reach, which is
  answerable by probe with no container, no provider key, and no spend.

### Upgrade notes

Removing a permission is a narrowing change and there is no variable to set
first, so an old lane with the new pin and a new lane with the old pin both work.
Run the installer `update` as usual; it rewrites the lane blob and advances the
pin.

The fleet is installed `REVIEW_ROUTE_MODE=copilot` with
`REVIEW_INDEPENDENT_FLOOR=copilot`, which makes `cheap` and `deep` unreachable,
so the `pr-agent` job does not execute there and this change is inert for the
fleet as configured. **It stops being inert the moment a consumer moves off
`copilot`.** The permission boundary itself is settled by probe; what a
credentialed run additionally confirms is PR-Agent's own end-to-end publishing
behaviour under the reduced grant.

## 0.6.0 - 2026-08-22

### Security

- **The independent review floor is no longer settable by the caller it
  constrains.** `route-policy` was hardened in `0.5.0` against a dispatching
  caller supplying their own bound. `independent-review-floor` is the opposite
  bound on the same decision — the policy is the strongest route a caller may
  explicitly *request*, the floor is the weakest route automatic selection may
  land on — and it was still wired from a `workflow_dispatch` input on both
  durable lanes. Anyone with write access could dispatch
  `independent-review-floor: none` and skip independent review entirely, on a
  lane whose own comment claims `copilot` "guarantees an independent review on
  every routed pull request".

  The lane comment was accurate about the command pack, which dispatches only
  `operation`, `review-request`, and `rerequest-authorized`. It was not accurate
  about a human dispatching from the Actions UI, and that gap is how the defect
  survived review.

  The floor now reads `${{ vars.REVIEW_INDEPENDENT_FLOOR }}` and the dispatch
  input is gone. A repository variable cannot be set from a dispatch form; that
  asymmetry is what makes either value a bound at all.

  Found by the reviewer this project ships, reviewing its own v0.5.0 install
  pull requests across the consumer fleet.

- **`action.yml` no longer describes the defect as deliberate.** The
  `route-policy` description warned that "the neighbouring policy inputs on the
  shipped lane are deliberately wired the other way". They were wired the other
  way, but not deliberately. The note is corrected in place rather than deleted,
  because the corrected version is the one a future consistency-minded edit
  needs to read.

### Breaking

- **`REVIEW_INDEPENDENT_FLOOR` is required by the durable lane.** The lane
  refuses to dispatch without it, with an error naming the variable. Set it on
  every consumer **before** advancing the lane: the `0.5.0` lane does not read
  it, so writing it early is inert, while the reverse order has no safe window.

  Accepted values are `none`, `cheap`, `deep`, and `copilot` — the route modes
  minus `auto`, because a floor is a resolved route. `copilot` guarantees an
  independent review on every routed pull request with no PR-Agent spend.

- **`--review-floor` is required on a fresh install** and has no default, for
  the same reason `--route-mode` has none. Both candidate defaults are wrong in
  a way the operator would not see: `none` installs a lane with no floor that
  claims to have one, and `copilot` commits a repository to requesting Copilot
  on every routed pull request without anyone choosing it. An `update` keeps
  what the manifest records; a value already set by hand is adopted **unowned**,
  so `uninstall` preserves it.

- **Consumer manifest schema 5 → 6.** `REVIEW_INDEPENDENT_FLOOR` joins the
  managed variable set, mirroring `REVIEW_ROUTE_MODE`'s arrival at schema 4:
  `install` writes it, the manifest records ownership, `check` reports it
  missing or drifted, and `uninstall` removes what it owns. Every earlier schema
  keeps decoding, and `check` names the migration rather than failing on it.

### Added

- Two sweeps over every shipped lane that dispatches a review, because there are
  two ways to unfloor a lane and the variable wiring closes only one.
  Reintroducing the input is the loud way; dropping the `with:` key entirely is
  the quiet one — `input()` uses `??`, so an unset variable arrives as a
  present-but-empty string and fails `normalizeMode`, while an *absent* key
  reaches the action's `"none"` default and says so nowhere. A lane joins both
  sweeps by carrying a `review-request:` key, not by being listed.
- A set-equality binding between `REVIEW_FLOORS` and the durable lane's own
  `case` gate, extracted from the lane rather than restated, exactly as
  `ROUTE_MODES` is bound to the event-driven lane's gate.
- A documented-invocation gate for `--review-floor`, twinning the existing
  `--route-mode` one. A required flag added without updating the setup guide
  ships runnable commands that fail, and that guide is the piece the installer
  spec already warns gets missed.

### Upgrade

1. Set `REVIEW_INDEPENDENT_FLOOR` on the consumer repository. This is inert to
   the `0.5.0` lane, so it is safe to do first, and it must be done first.
2. Run `install-consumer.mjs update --review-floor <value>` from a checkout at
   this release. That advances the lane and the pin together and migrates the
   manifest to schema 6.
3. `check` before and after. Before the update it reports the schema-6
   migration; after it should report nothing.

### Withdrawn

- The fleet reviewer's "the setup descriptor under-declares `issues: write`"
  finding, reported independently on three consumer pull requests, is a false
  positive. The action makes no `/issues` request at all, `assertSetupContract`
  already refuses to let the descriptor declare the permission, and
  `DESIGN.md` documents the job-versus-contract mismatch as intentional. The
  lanes' grant belongs to PR-Agent, not to this action.

  What remains underneath it is narrower and still open: the durable lane
  isolates PR-Agent in a job holding no `issues: write`, while the router lane
  shares a job that has it. Settling which is right needs a live credentialed
  PR-Agent run, which `docs/RELEASE_CHECKLIST.md` §2 puts behind separate
  approval.

  **Superseded by `0.6.1`.** This entry is left as written for the record; both
  of its conclusions were wrong. See `0.6.1` → Corrected.

## 0.5.0 - 2026-08-22

### Security

- **A same-head retry must now declare what it retries, closing a bypass of the
  entire rerequest authorization chain.** `ReceiptStore#validateRerequest`
  returns at its first line when `request.rerequestOf` is absent
  (`src/receipt.js:420`), and the protocol tied `attempt` to `rerequestOf` only
  when `rerequestOf` was present. So a request carrying `attempt: 2` and no
  `rerequestOf` skipped the `rerequest-authorized` input, the prior-receipt
  identity check, `supportsRerequest`, the policy-version match, and the
  route/backend match — all of them.

  Because `attempt` is part of the logical dispatch identity, the bare bump did
  not collide with the stored receipt either: it minted a fresh dispatch and a
  second durable check run, reading as a clean new review. `review-request` is a
  free-text `workflow_dispatch` input, so this was reachable by anyone able to
  dispatch the workflow, repeatedly, at a single head.

  `decodeReviewRequest` now refuses `attempt > 1` without `rerequestOf`. No
  fixture or flow used that shape; every `attempt: 2` in the suite already
  carried a `rerequestOf`.

  Impact was bounded in practice rather than by design: it required repository
  write access, and the routes that bill a provider need a credential no fleet
  consumer holds. It was still an authorization control that did not hold.

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

- **`action.yml` failed to load, for every consumer at once.** The
  `route-policy` input's description explained the required wiring with a
  delimited `vars.REVIEW_ROUTE_MODE` expression. GitHub evaluates `${{ }}` in
  `action.yml` when it *loads* the action, including inside `description`
  prose — and an action definition cannot reference `vars`, which is a workflow
  context. Every dispatch failed at "Set up job" with `Unrecognized named-value:
  'vars'`, before any of `src/` ran. The description now spells the expression
  body without its delimiters and says why. A new metadata gate rejects
  expression delimiters anywhere in `action.yml` outside `runs:`, which is the
  only place a (composite) action may legitimately carry one.

  This was invisible to every check that ran before the release's pin-advance
  step, because the self-hosted `route` lane exercises the action *at its pin* —
  the previous release, whose `action.yml` predates the input. Advancing pins
  before tagging is what surfaced it; the reverse order would have tagged and
  shipped it.

- **A consumer whose managed files were advanced by a release, but whose
  manifest stayed behind, was wedged with no supported recovery.** The
  modification guard compared a managed file only against the hash the manifest
  recorded at install time, so a file byte-identical to the *current* template
  still read as operator drift. `update` refused, `uninstall` refused, and
  `adopt` refuses whenever a manifest exists — leaving hand-editing the manifest
  as the only way out. `sd-github-review`'s own installation was in exactly this
  state and would have failed its rollout cohort.

  All three guards now also exempt content equal to current source, which is
  what the no-manifest path and the pre-durable migration path already did.
  Bytes the installer is about to write are not operator content: the next write
  reproduces them, so nothing can be lost by adopting them. Content matching
  neither the manifest nor the template is still refused, and a test asserts
  that half specifically.

- **Published documentation labelled the shipped pin as `v0.3.0` when it is
  `v0.4.0`'s commit.** `3e41f23` is the commit `v0.4.0` points at; `v0.3.0` is
  `744a9f1`. Five places in `README.md`, `SETUP-COPILOT.md`, and `SETUP-PR-AGENT.md` told a
  consumer they were installing `v0.3.0`. One file disagreed with itself:
  `SETUP-PR-AGENT.md` printed `--source-tag v0.4.0` beside the same SHA it
  called `v0.3.0` two hundred lines later. The pin claims no longer name a tag
  at all — the SHA is the installation reference and the tag is for discovery,
  which is what the surrounding prose already said.

- **The release procedure could not be executed at all for any release that
  changes action code.** `assertPinFreshness` compared the pin's `src` and
  `action.yml` against the *previous tag* in both windows. The pin-advance
  commit — which the checklist requires before tagging — moves the pin to the
  candidate, whose action code differs from the last release by construction,
  so that commit could never go green and the release could not proceed.
  `0.4.1` shipped only because it was action-code neutral, which made the
  comparison vacuous; `0.5.0` is not, and reproduced the deadlock exactly.
  In the pre-tag window the tree under validation *is* the release, so the
  comparison now runs against `HEAD`. The post-tag path is untouched, and a
  descendant pin whose action code differs from the candidate still fails.

- **A shipped lane may no longer name a release tag.** Nine lanes carried a
  `# v0.3.0` comment directly above a `uses:` pin holding v0.4.0's commit —
  the same wrong-label defect as the published docs, in the files consumers
  copy. Neither existing check could see it: `assertFirstPartyConsistency`
  reads `uses:` values and never comment nodes, and the new prose gate filters
  to Markdown. Checking that no tag is named at all needs no knowledge of which
  tag would be right, which is what makes it drift-proof.

- **`v0.4.0`'s workflow template was never registered for adoption.** `adopt`
  matches a hand-copied workflow by exact bytes against
  `HISTORICAL_TEMPLATE_HASHES` plus the current source, and v0.4.0's bytes were
  in neither, so anyone who copied that release's template could not be adopted
  and nothing failed to say so. The entry is added, and a test now derives the
  expected set from the release tags so the next release cannot repeat it.

- **The route-policy refusal under-reported what a caller may request.** It
  named only the policy value, though `auto` is always permitted. Under a
  `none` policy the sole suggestion was `--remote none` — asking for no review,
  which is never what an operator who just requested one wants — while `auto`,
  the actionable answer, went unmentioned. The message now reads
  `permitted: auto, <policy>` and advises `--remote auto`.

- **The release gate now verifies that a lane's inputs exist in the action it
  pins.** `assertFirstPartyConsistency` proves every lane agrees on one SHA and
  `assertPinFreshness` proves that SHA carries the release's action code, but
  neither reads the `with:` block. Four lanes wired `route-policy` while pinned
  to a release declaring no such input, so the policy was documented and
  entirely inert with every check green. `SD_RELEASE_TAG=... node
  scripts/validate-action-metadata.mjs` now refuses that. It is release-time
  only by design: during development the pin lags on purpose, and failing every
  CI run would make the gate something to switch off rather than satisfy.

- **`validate:metadata` now gates prose pins, not only YAML ones.**
  `assertFirstPartyConsistency` reads `uses:` lines out of parsed YAML, so the
  four published documents that print a literal 40-character SHA beside "keep
  that exact pin" were never checked against the current release. A pin advance
  that missed them left consumers copying a stale commit out of the setup guide
  while every automated check stayed green. The new check discriminates with
  `git rev-parse --verify --quiet <sha>^{commit}` rather than a pattern,
  because `DESIGN.md`'s protocol examples are legitimately 40 hex characters
  (`0000...0001`, `aaaa...`) and resolve to no object.

- **A pull request reviewed while it was a draft could never be reviewed again at
  that head.** Routing a draft records route `none` ("draft pull requests are
  disabled"). Marking it ready for review does not change its head SHA, and
  `draft` is read from live GitHub state into the routing context rather than
  into the request (`src/operations.js:377`), so it reaches neither
  `fingerprintFields` nor `logicalDispatchId`. The next dispatch therefore
  matched the stale skip, agreed on the fingerprint, and was answered "not
  reviewed" for as long as that head stood. The durable lane is
  `workflow_dispatch`-only, so both dispatches are a human deliberately asking
  for a review, and the second silently got none.

  A recorded skip is now superseded when the fresh decision is not itself a
  skip. This is safe because a skip represents no dispatched work — nothing ran,
  so nothing is duplicated — and `not-started` → `started` advances the phase
  rather than regressing it. A bookkeeping `none` re-dispatched under unchanged
  conditions still returns its existing receipt untouched.

  Beyond `draft` this also covers `sensitive-paths`, `changed-line-threshold`,
  and `review-drafts`, which reach the decision by the same routing-context path.

- **The first-party lane had diverged from the template it ships.**
  `.github/workflows/sd-review.yml` is installed from `examples/sd-review.yml`,
  but the route-policy wiring landed only in the example, leaving this
  repository the one consumer not enforcing the policy it distributes. Both
  installed lanes are now held byte-identical to their source templates by test,
  and every `vars.` reference in an installed template must be an
  installer-managed name or carry a `|| 'literal'` fallback — the general form of
  the `SD_REVIEW_*_BACKEND_V1` defect fixed below, whose original fix was
  point-wise and so did not prevent the next occurrence.

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

- **A durable receipt that needs a human now fails the `route` step instead of
  reporting a green job.** Read this one before upgrading: a route step that
  previously always succeeded can now go red.

  `reconciliation-required` used to cover every receipt at dispatch phase
  `started`, which conflated a dispatch running right now with one stranded by a
  finalize that never landed. Because the flag was true for every ordinary
  replay, nothing could gate on it without failing healthy reviews — so no
  shipped lane gated on it at all, and a stranded receipt was silent
  permanently: GitHub's REST API has no delete-check-run endpoint, and the
  receipt outlives every job that could advance it, so the pull request could
  never be reviewed again at that head.

  Receipts at `started` now report a new `durable-state` value **`in-flight`**
  while a job could still be running, and `reconciliation-required` only once
  they are older than `stranded-receipt-minutes` or their dispatch is recorded
  failed. A failed dispatch is exempt from the age test: it is known broken
  rather than slow. `durable-state` consumers that switch on its value should
  add the new case.

  The gate lives in the Action, not in the workflow, for two reasons: the
  canonical durable workflow may contain no `run:` step at all because it holds
  `checks: write`, and a gate written into YAML is one a consumer can drop while
  believing it still runs. Outputs and the job summary are written before the
  failure, so durable state stays machine-readable on a red step. A concurrent
  begin that lost its election is exempt — its evidence names the authoritative
  check run, so another dispatch is reviewing that head and failing the loser
  would be a false alarm.

  Set `fail-on-reconciliation: false` to keep the previous reporting-only
  behaviour. It applies to `route` only: `query` exists to report durable state,
  and `finalize` would mask the reconciliation it was invoked to record.

- **New inputs `stranded-receipt-minutes` and `fail-on-reconciliation`.**
  `stranded-receipt-minutes` defaults to `360` because that is GitHub's maximum
  job lifetime and the shipped lanes declare no `timeout-minutes` — a ceiling
  derived from the platform rather than a tuning guess, so it cannot report a
  false strand. Lower it to match an explicit `timeout-minutes` to find stranded
  receipts sooner; set it below real review latency and healthy in-flight
  reviews will be reported as stranded.

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

- A receipt at dispatch phase `started` that carries no `dispatch.startedAt`
  cannot be dated, and is reported stranded rather than in flight. The field is
  optional in the protocol (`src/protocol.js:819`), so such a receipt decodes
  normally. Failing closed is deliberate — nothing tracks an undatable receipt,
  so treating it as in flight would recreate the permanent wedge the split
  exists to end — but with the new route gate this now fails a job where it
  previously set an output nothing read.
- `independent-review-floor` remains caller-overridable on the durable lane. The
  new `route-policy` bounds the *maximum* a caller may request; the floor is the
  separate *minimum* and is still supplied as a `workflow_dispatch` input.

### Also in this release: the pin-freshness fix prepared as 0.4.1

`0.4.1` was written and version-stamped but never tagged, and its headline claim
— that `src` and `action.yml` are byte-identical to `0.4.0` — stopped being true
the moment this release's runtime work landed on the same branch. Publishing it
would have shipped a false statement about the very trees the release is about.
No consumer can distinguish the two, because no `v0.4.1` tag ever existed, so
its entries are folded in here rather than back-dated onto a tag.

#### Fixed

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

#### Changed

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
