# Consumer Installer

> Executable lifecycle contract for provisioning the supported event-driven
> PR-Agent workflow in a consumer repository.

## Scenario: Manage An Event-Driven PR-Agent Consumer

### 1. Scope / Trigger

Use this contract when `scripts/install-consumer.mjs` installs, updates,
checks, or uninstalls the event-driven PR-Agent integration. The command spans
the source workflow template, a consumer checkout, GitHub repository metadata,
and provider-secret handling, so filesystem and remote mutations must remain
recoverable and credential-safe.

The command installs the durable on-demand lane as well: the setup discovery
descriptor and the `workflow_dispatch` workflow it declares. Copilot account
settings, branch protection, commits, pushes, and pull requests remain outside
this command boundary.

### 2. Signatures

```text
node scripts/install-consumer.mjs install [options]
node scripts/install-consumer.mjs update [options]
node scripts/install-consumer.mjs adopt [options]
node scripts/install-consumer.mjs check [options]
node scripts/install-consumer.mjs uninstall [options]
```

- `runConsumerInstaller(options, dependencies?) -> Promise<report>`
- `parseArguments(argv) -> options|{ help: true }`
- `resolveSourceRelease({ sourceRoot, gitImpl?, version?, override? }) -> { commit, tag, released }`
- `validateReleaseConsistency({ repositoryRoot?, releaseTag?, gitImpl? }) -> Promise<result>`
- `decodeManifest(source, filePath?) -> normalizedManifest`
- `validateConfiguration(configuration) -> normalizedConfiguration`
- `GitHubCli#inspect(repository) -> repositorySnapshot`

### 3. Contracts

- `--target` resolves to a Git root. `--github OWNER/REPO`, when supplied,
  must match a GitHub `origin`; the authenticated GitHub response must resolve
  to the same repository identity.
- `install` and `update` copy three source artifacts exactly and manage the
  consumer-side sd-github-review.json ownership manifest atomically:
  `examples/pr-agent-router.yml` to the consumer's GitHub workflows file named
  ai-review-router.yml, `examples/sd-review.yml` to the workflows file named
  sd-review.yml, and `contract/routed-review-setup-v1.json` to
  `config/routed-review-setup-v1.json`. The descriptor's source and destination
  paths differ deliberately: this repository publishes its reference copy under
  `contract/`, and `config/` is the only path setup discovery probes in a
  consumer. `examples/sd-review.yml` must declare the `name:` the descriptor's
  `workflow.name` declares, because GitHub derives the workflow metadata name
  from that field and the probe rejects a mismatch.
- The durable lane is an additional managed resource, never a replacement:
  repointing the event-driven workflow's path or template would remove
  automatic on-PR review from every existing consumer and orphan every live
  manifest on the exact-equality `workflow.path` and `source.template` checks.
- A fully converged `install` or `update` performs no work: an empty `actions`
  array, no GitHub calls, and no filesystem write. Convergence requires all of
  an `active` manifest already at `MANIFEST_SCHEMA_VERSION`, a would-be-written
  manifest deep-equal to the one on disk, zero planned remote actions, and every
  managed file's bytes matching its recorded hash. Comparing recorded hashes
  alone is not sufficient and must not be used: it would suppress the mutation a
  provider/model change and a source-commit advance are both required to cause.
- `adopt` brings an unmanaged, manually copied workflow under installer
  ownership. It is explicit only and never inferred during install or update. It
  refuses when a manifest already exists (the installation is already managed;
  use `update`) or when no workflow exists (nothing to adopt; run `install`). It
  recognizes the existing workflow only by exact SHA-256 against the current
  template or the versioned `HISTORICAL_TEMPLATE_HASHES` allow-list (there is no
  fuzzy or semantic matching); an unrecognized workflow is rejected with a
  bounded manual-reconciliation message that never embeds the workflow content.
  A recognized workflow is converged to the current source, and provenance is
  recorded exactly as `install` records it. Because the adopted installation
  must behave exactly like a fresh one afterwards, `adopt` also applies the
  collision guard to, writes, and records the descriptor and the durable
  workflow; recording manifest blocks for files it never wrote would leave the
  adopted install immediately unhealthy. `adopt` plans ownership without
  claiming pre-existing unowned GitHub resources — only resources it creates are
  owned — so a conflicting unowned variable stops it before any mutation and a
  later `uninstall`/`check`/`update` behaves as for a fresh install. It requires
  confirmation (interactive `confirm` seam or `--yes`), honors `--dry-run`, and
  writes `pending` then `active` so a partial GitHub failure is resumable
  through the normal lifecycle.
- The manifest schema is version `4` (`MANIFEST_SCHEMA_VERSION`), tool
  `sd-github-review`, and state `pending`, `active`, or `uninstalling`. It
  records repository, workflow and source SHA-256, source provenance
  (`source.commit`, `source.tag`, `source.released`), the `descriptor` and
  `durableWorkflow` blocks (each with destination `path`, the `source` path it
  was copied from, and `sha256`), provider/models, and exact
  variable/secret/label ownership. Source and workflow hashes must match. Extra
  owned resources are forbidden.
- The decoder admits schema 1, 2, and 3, and validates by version rather than
  by equality with the current constant:

  | Version | `workflow` + `source` | provenance (`commit`, `tag`, `released`) | `descriptor` + `durableWorkflow` | `REVIEW_ROUTE_MODE` |
  | --- | --- | --- | --- | --- |
  | 1 | required | not present | not present | not present |
  | 2 | required | **required** | not present | not present |
  | 3 | required | required | required | not present |
  | 4 | required | required | required | **required** |

  Gating provenance validation on `schemaVersion === MANIFEST_SCHEMA_VERSION`
  is forbidden: it silently stops validating `source.commit`/`tag`/`released`
  on every schema-2 manifest in the fleet. A legacy schema-`1` manifest decodes
  as a pre-provenance install and a schema-`2` one as a pre-durable install;
  a schema-`3` one as pre-route-mode; each is read-only at its own version and
  `update` rewrites it to the current schema.

  The managed *variable set* is version-scoped for the same reason the field
  requirements are. `decodeManifest` checks variable names by exact set
  equality, so reading a pre-schema-4 manifest against the current four-name set
  would not report drift — it would throw, taking `check` out on every installed
  consumer before it could report the migration it needs. Resolve the expected
  set from the manifest's own `schemaVersion`.

  `check`'s migration messages are one branch per tier, never a final
  `< MANIFEST_SCHEMA_VERSION` catch-all. A catch-all silently retargets the
  previous tier's message at manifests that already satisfy it: after the 3 → 4
  bump it would tell a schema-3 consumer it predates the durable review lane,
  which it does not.
- Source provenance is resolved from the installer's own source root, not the
  consumer. `source.commit` is always a 40-hex commit. The `(released, tag)`
  pair encodes the source unambiguously: `(true, v<semver>)` is the single
  bytes-verified git path (an exact `v<version>` tag on `HEAD` with a clean
  `examples/pr-agent-router.yml` working tree); `(false, v<semver>)` is an
  operator-declared `.git`-less artifact via `--source-tag`/`--source-commit`
  (or `SD_SOURCE_TAG`/`SD_SOURCE_COMMIT`); `(false, null)` is a dev/unreleased
  checkout. `source.tag`, when non-null, is always `v<semver>`; `released: true`
  requires a non-null `v<semver>` tag. When neither git identity nor override is
  available, install/update fail closed with a bounded message. Recorded
  provenance is an offline identity record, not a cryptographic attestation.
- Supported providers are the same single-key allowlist enforced by the
  checked-in PR-Agent workflow. Non-OpenAI model IDs require the exact
  `<provider>/` prefix; every model is nonempty, whitespace-free, and at most
  256 characters.
- A fresh install defaults to `openrouter`, with
  `openrouter/qwen/qwen3-coder-30b-a3b-instruct` for `cheap` and
  `openrouter/moonshotai/kimi-k2.6` for `deep`. An update with omitted
  provider/model options retains the active manifest's recorded configuration;
  changing source defaults never silently migrates an existing consumer.
- GitHub resources are `PR_AGENT_MODEL_PROVIDER`, `CHEAP_REVIEW_MODEL`,
  `DEEP_REVIEW_MODEL`, `PR_AGENT_MODEL_API_KEY`, and the router's five review
  labels. Matching pre-existing resources are unowned and preserved.
- `REVIEW_ROUTE_MODE` is installer-managed from schema 4, alongside the three
  configuration variables: `install` writes it, the manifest records its
  ownership, `check` reports it missing or drifted, and `uninstall` removes it
  when the installer owns it. Its accepted values are `ROUTE_MODES` — `auto`,
  `cheap`, `deep`, `copilot`, `none` — which is the same set the installed
  lane's own gate enforces. The two are bound by a test that extracts the lane's
  `case` pattern rather than restating the list, so neither side can drift alone.
- A fresh install **requires** `--route-mode`; there is no default. The lane
  refuses to guess a route because `auto` can select `cheap` or `deep` and bill
  `PR_AGENT_MODEL_API_KEY` on a route nobody chose, and an installer that
  guesses on the operator's behalf reintroduces exactly that, one layer earlier
  and more quietly — the lane at least fails in the open. Route mode resolves in
  order: the `--route-mode` flag, then the active manifest's recorded value,
  then an existing repository variable (adopted **unowned**, so `uninstall`
  preserves it), then a refusal naming the flag. An existing variable holding an
  unsupported value is a refusal, not a silent overwrite.
- The installer's CLI surface is documented in three places, and a change to it
  sweeps all three: `HELP` in `codecs.mjs`, the README install call-out, and the
  runnable invocations in `SETUP-PR-AGENT.md`. The setup guide is the one that
  gets missed, because it is the only one whose commands are meant to be copied
  and run — a required flag added without updating it ships five documented
  commands that fail. Enumerate with a repository-wide search for
  `install-consumer.mjs install`, not from this list. The documented half of
  that sweep is enforced rather than remembered: a test enumerates every tracked
  Markdown file outside `.trellis/`, rejoins shell line continuations, and fails
  any `install` invocation missing `--route-mode` or naming a mode the installer
  rejects. Extend that test when a later flag becomes required, so the rule
  keeps failing rather than merely being written down.
- The lane's fail-closed gate stays regardless. Installer management is a second
  line of defence — a consumer can always delete the variable after installing —
  so removing the gate because the installer now writes the value would trade a
  detected failure for an undetected one.
- Provider secret values enter only through the inherited `gh secret set`
  prompt or standard input. They never enter CLI arguments, reports,
  manifests, diagnostics, or JSON output.
- Mutating commands support `--dry-run`. The tool writes `pending` before
  install/update remote mutations and `uninstalling` before removals. It never
  commits or pushes the consumer checkout.
- Every managed read, write, rename, and removal stays beneath the canonical
  Git worktree root. Before touching a managed path the tool inspects each
  existing ancestor from the root to the destination with `lstat`-equivalent
  semantics and rejects a symlink component, a non-directory ancestor, a
  non-regular-file leaf, or any destination resolving outside the root, failing
  before local or GitHub mutation. It rechecks containment immediately before
  each atomic rename and removal to narrow the time-of-check/time-of-use
  window. The same guard covers the install, update, check, adoption, rollback,
  and uninstall paths. Containment errors are bounded to the managed path
  relative to the root and never embed a symlink target or other unrelated host
  path.
- `check` is read-only and exits nonzero for local, source-template, variable,
  secret-presence, or label drift. Each managed resource gets both signals:
  local drift against the recorded hash, and a newer source than the one
  recorded. It additionally reports a schema-1 migration issue, a distinct
  schema-2 durable-lane migration issue, a newer-source-commit issue, and a
  released-tag-drift issue when the recorded provenance no longer matches the
  resolved source identity.
- `released: true` requires a clean working tree for **every** copied source
  artifact — the event-driven template, the durable template, and the
  descriptor source — not the event-driven template alone. A dirty copy of any
  one of them would otherwise install under a manifest asserting a release the
  bytes did not come from.
- Migrating a schema-1 or schema-2 installation applies the **collision** guard
  to each newly managed resource, not the modification guard: the old manifest
  records no hash to compare, so the modification guard cannot fire and the
  write path would clobber a hand-placed file. A destination whose bytes differ
  from the source is refused before any mutation with reconcile guidance; a
  byte-identical destination is adopted — its hash is recorded and the file is
  not rewritten.
- The release gate `validateReleaseConsistency({ repositoryRoot, releaseTag,
  gitImpl })` in `scripts/validate-action-metadata.mjs` is a two-tier hygiene
  check. Its always-on tier (folded into `validateMetadata`, run by CI) asserts
  every first-party `platypeeps/sd-github-review@<40-hex>` pin across
  workflows/examples plus the descriptor `actionReference` in
  `contract/routed-review-setup-v1.json` are mutually equal, the descriptor
  declares a known `contractMajor`, and `package.json` `version` is valid
  semver. Its opt-in tier additionally requires `releaseTag === v<version>` and
  a not-yet-existing tag. It never requires a pin to equal the release commit
  being cut. Exposed as `npm run validate:release -- vX.Y.Z`; not wired into
  `ci.yml`.
- Uninstall requires confirmation or `--yes`, removes only owned variables,
  and preserves secrets and labels unless explicit cleanup flags authorize
  them. `--remove-labels` still removes only installer-created labels. It
  removes each managed file the manifest records — so a schema-2 installation
  loses only its event-driven workflow — and refuses when any of them was
  modified after installation.
- `MANAGED_RESOURCES` in `codecs.mjs` is the **single source of truth** for the
  files the installer copies into a consumer — `{field, destination, source,
  durable}` per resource — and `DURABLE_MANAGED_RESOURCES` is its schema-3
  subset. Every dependent list derives from it rather than restating it:
  `decodeManifest`'s schema-3 block validation and `createManifest`'s emitted
  blocks, `DURABLE_RESOURCES` (which drives the guards, `check`, and
  `uninstall`), `COPIED_SOURCE_PATHS` (the `released: true` cleanliness set),
  `readManagedSources`, `isConverged`, the install/update/adopt write set, and
  the tests' `DURABLE_CASES`. `field` keys the manifest block, the loaded local
  state, and its `<field>File` destination path simultaneously, which is what
  makes the derivation uniform. `createManifest` takes the managed source
  *bytes* keyed by field — the shape `readManagedSources` returns — rather than
  one hash argument per resource, so a new resource adds no parameter at either
  call site. Adding a resource is one table entry; the alternative — a literal list per site — is what
  allows a resource to reach the manifest while missing from the release-
  cleanliness set (dirty bytes shipped under a release claim), from
  `isConverged` (a converged run rewrites files), or from the test cases (guard
  tests that pass while covering nothing). Removing one entry from the table
  fails 48 tests, which is the evidence the derivation is load-bearing.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Target is not a Git checkout | Fail before local or GitHub mutation |
| Explicit repository differs from GitHub origin | Fail with both bounded identities |
| Unsupported provider or malformed model | Fail before writing managed files |
| Unmanaged workflow has different content | Refuse `install` overwrite; `adopt` if recognized |
| Unmanaged descriptor or durable workflow has different content | Refuse `install`/`adopt` before any mutation; the file is byte-unchanged |
| Migrating a schema-1/2 install whose descriptor or durable workflow is hand-placed and differs | Refuse before any mutation; the manifest stays at its old schema |
| Migrating a schema-1/2 install whose descriptor or durable workflow is byte-identical to the source | Record its hash; do not rewrite the file |
| Managed descriptor or durable workflow differs from recorded hash | Preserve operator edit and refuse update/uninstall |
| A copied source artifact is dirty at a release tag | Record `released: false` and `tag: null` |
| `install`/`update` is fully converged | Empty `actions`, no GitHub calls, no filesystem write |
| `adopt` workflow is unrecognized (not current or an allow-listed historical hash) | Reject with bounded reconciliation guidance before any mutation |
| `adopt` target already has a manifest | Refuse; direct the operator to `update` |
| `adopt` without confirmation or `--yes` | Cancel before writing the pending manifest or mutating GitHub |
| Managed workflow differs from recorded hash | Preserve operator edit and refuse update/uninstall |
| Pre-existing unowned variable conflicts | Refuse takeover; require manual reconciliation |
| Secret is absent without an approved input mode | Fail with prompt/stdin recovery command |
| GitHub mutation fails during install/update/adopt | Retain `pending` manifest; adopt resumes through the normal `install`/`update` lifecycle |
| GitHub mutation fails during uninstall | Retain `uninstalling` manifest and managed workflow |
| Manifest includes unknown owned variable/label | Reject before any deletion |
| Managed-path ancestor is a symlink or resolves outside the root | Fail with a bounded relative-path error before any read, write, rename, or removal |
| Managed-path ancestor is replaced with a symlink between plan and rename/removal | Recheck fails closed before the rename/removal; no external target is touched |
| Source has no git identity and no override | Fail install/update before writing managed files |
| Manifest is released with a `released:true` but `tag:null` | Reject during decode |
| First-party pins disagree with the descriptor `actionReference` | Fail the always-on metadata gate |
| `validate:release` tag does not equal `v<version>` or already exists | Fail the opt-in release gate |
| `check` observes drift | Return a bounded issue list and nonzero exit without mutation |
| Secret-setting command fails | Redact the submitted value from the propagated diagnostic |

### 5. Good/Base/Bad Cases

- Good: a fresh target uses `--set-secret`; the command writes the pending
  manifest, the event-driven workflow, the durable workflow, and the descriptor,
  creates the default OpenRouter/Qwen-cheap/Kimi-deep variables plus missing
  labels/secret, then marks the manifest active. A second install performs no
  remote mutations and no filesystem writes.
- Base: a target already has matching variables, labels, or secret. The
  installer records them as unowned, leaves them unchanged, and later
  uninstall preserves them. A managed consumer update without provider/model
  flags likewise preserves its manifest configuration even when source
  defaults have changed.
- Bad: an edited manifest claims ownership of an unrelated label, or the
  managed workflow has changed since its recorded hash. Decoding or lifecycle
  validation fails before deletion or overwrite.

### 6. Tests Required

- Parse HTTPS/SSH GitHub remotes and reject repository mismatches.
- Assert install/update convergence, source-template refresh, remote drift,
  dry-run immutability, and provider/model changes.
- Assert a fresh install writes the exact default provider, cheap model, and
  deep model to both its manifest and GitHub variables.
- Simulate a mid-install GitHub failure; assert the pending manifest preserves
  ownership and a retry reaches active state without duplicate side effects.
- Assert secret input is absent from the report, manifest, fake GitHub call
  record, and errors.
- Cover unmanaged and modified workflow refusal, unowned variable conflict,
  and manifest resource allowlisting.
- Cover default uninstall preservation and explicit cleanup of only
  installer-created labels.
- Assert installer provider and label allowlists remain aligned with workflow
  metadata and router exports.
- Assert schema-2 provenance capture (git-verified `released:true`, a dirty
  copy of *any* copied source artifact or a mismatched tag falling back to
  `released:false`, and the `.git`-less override recording `(false, v-tag)`); a
  schema-1 manifest decodes as pre-provenance, a schema-2 one as pre-durable,
  and a schema-3 one as pre-route-mode, and `update` rewrites each to the
  current schema with a recorded commit.
- Assert schema 1 through 4 manifests all decode, that a malformed schema-2
  manifest is still rejected on each provenance invariant, and that the
  schema-3 `descriptor`/`durableWorkflow` blocks are validated by exact
  equality on `path` and `source` plus `SHA256_PATTERN` on `sha256`.
- Assert the durable template's `name:` equals the descriptor's `workflow.name`
  and that the managed durable-workflow path equals its `workflow.path`, read
  from the parsed descriptor rather than repeated as a literal.
- Cover all five guards for both the descriptor and the durable workflow:
  collision on install, `check` drift, `check` source freshness, `update`
  refusing an operator-modified file, and `uninstall` refusing to remove one.
- Assert a converged second `install` plans no actions and leaves every managed
  file's bytes and mtime unchanged, while a provider/model change and a
  source-commit advance still mutate a byte-identical installation.
- Assert an adopted installation holds all three managed files and reports no
  `check` issues, and that a fresh install followed by `uninstall` creates and
  then removes all three.
- Assert a symlinked `.github/workflows` or `.github` manifest ancestor fails
  install/check/dry-run before writing outside the target with a bounded error
  that omits the symlink target, that a regular pre-existing `.github` directory
  still installs, and that a symlink swap injected between plan and rename fails
  closed without touching the external target.
- Assert the always-on metadata gate rejects inconsistent first-party pins, a
  drifted descriptor `actionReference`, a missing/unknown descriptor, and a
  non-semver version; assert `validateReleaseConsistency` accepts a matching
  not-yet-existing tag and rejects version mismatch and an existing tag.
- Pin freshness is **action-code identity, not commit equality**. A pin is fresh
  when it is reachable from the current release's commit and resolves `src` and
  `action.yml` to the same tree and blob as that commit. Equality was
  unsatisfiable at the instant of tagging — a commit cannot contain its own SHA —
  which forced pins to advance only after the tag and left every tagged tree
  carrying the previous release's pins. Do not "simplify" this back to `===`.
  Assert: a pin trailing by action-code-neutral commits passes; a pin whose `src`
  or `action.yml` differs fails naming which one; a pin ahead of the tag passes
  only while it is an ancestor of `HEAD`, which is the pin-advance pull request's
  own state; a pin on neither the release nor `HEAD` fails even with matching
  code; and an ancestry probe exiting non-1 throws rather than reading as
  `false`, since git reserves exit 1 for "not an ancestor" and anything else means
  the repository could not be read.
- Releases therefore advance every pin **before** tagging, and the tag sits on the
  pin-advance commit, which must touch neither `src/` nor `action.yml`.
  `docs/RELEASE_CHECKLIST.md` section 5 is the live owner of that order.
- Cover `adopt`: a current-template manual install adopts without claiming
  pre-existing unowned resources and later uninstalls cleanly; an allow-listed
  historical workflow adopts and converges to the current source; an
  unrecognized workflow, an already-managed manifest, a missing workflow, a
  declined confirmation, a provider-conflicting unowned variable, and a
  symlinked workflow ancestor each fail before mutation; a mid-adopt GitHub
  failure retains the pending manifest and resumes via `install`; and the
  historical registry is well-formed and distinct from the current template.

### 7. Wrong vs Correct

```js
// Wrong: secret appears in process arguments and can leak through process lists.
runCommand("gh", ["secret", "set", SECRET_NAME, "--body", secret]);

// Correct: forward the secret through stdin and redact it from child errors.
runCommand("gh", ["secret", "set", SECRET_NAME, "--repo", repository], {
  input: secret,
  secret,
});
```

```js
// Wrong: delete every label listed in a locally edited manifest.
for (const label of manifest.resources.labels) await deleteLabel(label.name);

// Correct: decode an exact allowlist and remove only labels recorded as owned.
for (const label of manifest.resources.labels) {
  if (label.owned && snapshot.labels.has(label.name)) await deleteLabel(label.name);
}
```

```js
// Wrong: gate a schema's invariants on equality with the current constant. It
// reads as "validate the current schema" and behaves as "stop validating every
// older one" the moment the constant is bumped — silently unvalidating the
// provenance fields on every manifest the fleet is actually running.
if (value.schemaVersion === MANIFEST_SCHEMA_VERSION) {
  assertProvenance(value.source);
}

// Correct: gate on the version the requirement was introduced at, so bumping
// the constant adds a tier instead of narrowing an existing one.
if (value.schemaVersion >= PROVENANCE_MIN_SCHEMA_VERSION) {
  assertProvenance(value.source);
}
```

```js
// Wrong: treat "the recorded hashes match disk" as convergence. It suppresses
// the mutation a provider/model change and a source-commit advance must still
// cause, because neither of those changes any managed file's bytes.
const converged = managedFiles.every((file) => sha256(file.bytes) === file.recorded);

// Correct: compare the manifest that *would* be written against the one on
// disk. Configuration and provenance are inputs to it, so both fall out of the
// comparison without predicates of their own.
const converged =
  local.manifest?.state === "active" &&
  local.manifest.schemaVersion === MANIFEST_SCHEMA_VERSION &&
  actions.length === 0 &&
  JSON.stringify(activeManifest) === JSON.stringify(local.manifest) &&
  managedFiles.every((file) => sha256(file.bytes) === file.recorded);
```

```js
// Wrong: publish this repository's reference descriptor at the same path the
// consumer probe reads. Setup discovery cannot tell a published reference copy
// from an installed declaration, so probing this repository reports the durable
// lane as present and then fails looking up workflow metadata that never exists.
const setupDescriptorPath = "config/routed-review-setup-v1.json";

// Correct: publish under contract/ and keep config/ reserved for the consumer's
// own installed copy. The two paths are the same schema in opposite roles, and
// separating them is what lets this repository install itself as a consumer
// without the published reference shadowing the installed declaration.
const setupDescriptorPath = "contract/routed-review-setup-v1.json";
```

## Decision: this repository is a consumer of its own Action

Since 2026-08-15 this repository has `config/routed-review-setup-v1.json`
installed, so probing it reports the durable lane as present. Earlier revisions
of this document said the probe reports
`state: "absent" / reason: "setup-descriptor-absent"`; that was true only while
no consumer install existed here.

**The routed lane owns remote review in this repository.** A `PostToolUse` hook
that requested Copilot directly was the channel that actually reviewed PRs #81,
#82, and #83 while `sd-review` reported `zero-remote-confidence` — two contracts
claiming the same authority, with the receipt recording neither. The routed lane
won because it is the only one that produces a durable receipt, and because
`sd-review/SKILL.md:14-16` forbids the direct request outright: the choice was
between making the sanctioned lane real and weakening the rule that says it must
be.

Two alternatives were rejected, and the reasons matter more than the verdict:

- **Scope the hook out and stop there.** Cheapest, and it makes reporting honest
  immediately — but it deletes the reviewer that found real defects while the
  local lane found none, and leaves the router dark. It survives only as the
  closing step of the chosen route, gated on a first observed receipt, never as
  the whole answer.
- **Relax `sd-review`'s prohibition** so a direct request is permitted when the
  router is `absent`. This weakens a safety rule to legitimize a workaround for
  a router nobody had switched on. It remains the fallback if the routed lane
  cannot be made to work, not a first choice.

Two things about the install are load-bearing and easy to get wrong:

- **Route policy differs per lane.** `independent-review-floor` is durable-only
  (`action.yml:55`, read at `src/operations.js:389` inside `routeOperation`).
  The event-driven lane runs `operation: standalone` and honours `mode` instead.
  Setting the floor on the event lane looks right, changes nothing, and lets
  `auto` bill the provider key. That is not hypothetical: it happened on PR #85.
- **The install PR cannot be reviewed through the lane it installs.** GitHub's
  Actions API only knows workflows on the default branch, so the dispatch-only
  lane 404s and `routerCapability` reports `unavailable`, which fails closed —
  unlike `absent`, it does not permit local completion. Every consumer pays this
  bootstrap cost exactly once, on the pull request that installs the lane.

### The routed lane works; the client cannot observe it finishing

PR #86 was the first pull request opened after the install, and it exercised the
lane with no `remote=none` escape. The lane itself is proven, twice, at two
heads:

- `routerCapability` reports `ready` / `compatible-enabled-workflow`, so the
  merge of the lane onto the default branch did resolve the 404 above.
- `workflow_dispatch` runs `31910569360` and `31911109874` both completed
  `success`, and each published a `sd-github-review/receipt` Check Run whose
  payload carries `selectedRoute: "copilot"`, backend `github-copilot`, and the
  reason `review floor required copilot` — the durable floor doing exactly what
  `action.yml:55` promises.
- `limitations` contains neither `router-not-configured` nor
  `zero-remote-confidence`; the reviewer produced a real finding, and it was a
  true one.

The coordinator still cannot reach `ready`, for a reason that is entirely
client-side and reproduces every time. The lane publishes its receipt at
`dispatch.phase: "started"` when the route step begins and rewrites it to
`"observed"` about three seconds later. `~/.agents/bin/sd-ai-command-pack-review.py`
polls inside that window, caches the started receipt, and never re-reads it:
`:2133` queries the receipt only `if state.get("remoteReceipt") is None`, and
`:2159-2166` turns a cached `phase == "started"` into `indeterminate` with
`remote-reconciliation-required`. The one re-query branch at `:2095` is the
dispatch-*failure* path and never runs here. Rerunning the same attempt replays
the cache, so the attempt is wedged permanently rather than pending.

There is no supported escape. A fresh `--artifact-root` does find the receipt by
`logicalDispatchId` — the id is stable across controller state — but then fails
`durable receipt does not contain the current correlation id`, because the
correlation id exists only in the state a fresh root discards. That is correct
fail-closed behaviour and it is also a dead end. Since the thin conversion the
pack's executables are not in this tree at all — they live in the machine
install, `~/.agents/bin` — so the fix belongs upstream either way: treat a
cached non-terminal receipt like a missing one and re-query it inside the
existing poll loop.

**That fix has since shipped**, at sd-ai-command-pack 0.71.22, in the shape the
paragraph above predicted: `_receipt_in_flight` re-queries a cached non-terminal
receipt inside the existing poll loop rather than only a missing one
(`~/.agents/bin/sd-ai-command-pack-review.py:2157-2190`). A receipt that is
still non-terminal when the poll budget runs out reports
`remote-reconciliation-required` as before, so the diagnostic survived and only
the permanent wedge was removed. The line numbers cited above describe the
pre-fix code and no longer resolve to it; they are kept because they are what
the diagnosis was written against.

A routed review in this repository can therefore reach a terminal state again.
`remote-reconciliation-required` is now a real signal rather than a certainty —
and it still never justifies a direct reviewer request.

### Three channels can request Copilot, not two

The install was planned against two competing channels — the routed lane and the
`PostToolUse` hook. There is a third, and it wins the race: the `main` repository
ruleset carries a `copilot_code_review` rule, which requested Copilot on PR #86
at 21:51:06, one second after the pull request opened and twenty-two seconds
before the Action routed. The review that exists on that PR is the ruleset's.

The consequence is that retiring the hook does not leave the Action as the sole
requester, and `src/index.js:265-272` requesting Copilot is largely redundant
here: by the time it runs, the reviewer is already assigned. The overlap is
recorded and left in place deliberately — the Action's route stays the durable
receipt of what *should* review the change, while the ruleset is what summons
the reviewer. A repository that wants the lane to be the only requester turns
the ruleset rule off; this one does not.

### The hook is now scoped out of durable-lane repositories

Two channels remain here. The `PostToolUse` hook in `~/.claude/settings.json`
gained a fourth guard, after the three that detect a real push and before the
line that emits its instruction:

```bash
dir=${CLAUDE_PROJECT_DIR:-$(printf '%s' "$payload" | jq -r '.cwd // ""')}
[ -n "$dir" ] || dir=$PWD
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$root" ] && [ -f "$root/config/routed-review-setup-v1.json" ]; then
  exit 0
fi
```

**The marker means more than "installed".** `config/routed-review-setup-v1.json`
is the pack's `DEFAULT_DESCRIPTOR_PATH` (the pack's `sd-ai-command-pack-review.py`, line 31) and
the installer's `DESCRIPTOR_PATH` (`scripts/consumer-installer/codecs.mjs:23`),
so every consumer the installer sets up carries it at that path — but only a
*durable* install writes it. `sd-github-review-pilot` is the case that proves
the distinction: an active consumer whose `.github/sd-github-review.json` is
`schemaVersion: 1` and carries no `descriptor` or `durableWorkflow` key at all —
both are absent from the object, not present and null — where this repository
records both. The distinction is block presence, not the schema number: a
durable consumer keeps both blocks through every later schema bump. Descriptor presence therefore
means "a receipt-producing lane is installed here", which is exactly the
condition that makes the hook's direct request redundant. An event-lane-only
consumer keeps the hook, correctly, because it has no receipt competing with it.

The scoping self-maintains: a repository that later takes a durable install
drops the hook with no further settings edit. Of the repositories with recent
commits, sixteen carry no descriptor and keep the hook.

**The guard fails open.** An unresolvable git root is treated as "not a
descriptor repository" and the hook fires. A spurious fire costs a redundant
reviewer request; a spurious skip costs a pull request no remote review at all
in a repository with no lane behind it. The asymmetry decides the direction.

**Verified against the payload, not the source.** `CLAUDE_PROJECT_DIR`, payload
`.cwd`, and `$PWD` all resolve to the project root in a real `PostToolUse`
payload — measured with a temporary probe hook rather than assumed. That probe
also established that **hook edits take effect immediately, without restarting
the session.**

### What a Copilot receipt does and does not prove

A note on the two spellings, since this section is where they collide.
**Copilot** capitalized is the product — use it in prose and headings.
Lowercase `copilot` is an identifier and appears only as one: the route name in
`route: "copilot"`, the `deep|copilot` and `auto|cheap|deep|copilot|none`
configuration values, the reason string `review floor required copilot`, and
branch names. A routed review can therefore take the `copilot` route to a
Copilot review, and both spellings are correct in that sentence.

Removing the hook narrows the field from three requesters to two. It does not by
itself make attribution honest, because the retained ruleset still requests
Copilot seconds after a pull request opens — so in *this* repository the routed
dispatch essentially never causes the review it reads.

**What the receipt proves.** That a receipt-producing lane ran on this exact
head, which route policy selected, which backend and finding channels were
declared, and that the findings reported were published by the declared
`reviewAuthors` (`src/operations.js:110-123`) on that head.

**What it does not prove on its own.** *Who requested the reviewer.* The
coordinator harvests review findings by author and head commit
(the pack's `sd-ai-command-pack-review.py`, lines 1604-1616) and does not apply the temporal guard
that conversation comments carry in that same file at lines 1589-1603 — deliberately, because a
timestamp cannot discriminate here anyway: the ruleset requests early and Copilot
submits late, so `submitted_at >= dispatch.startedAt` admits the ruleset's review
regardless.

**What closes the gap.** `dispatch.status` is the field that already knows. The
Action probes for the reviewer before requesting and records the answer at
`src/receipt.js:694` — `requested` when it summoned the reviewer,
`already-present` when something else had. From pack **0.71.24** onward, the
coordinator acts on it: every terminal report produced after remote observation
carries the `remote-evidence-not-dispatch-caused` limitation when the receipt
says `already-present`. Read the version this repository actually runs from
`.sd-ai-command-pack/manifest.json` rather than from this paragraph; `0.71.24`
is the floor, not the pin.

So, reading a routed review here:

| Receipt | Report | Read it as |
|---------|--------|------------|
| `dispatch.status: "requested"` | no attribution limitation | the lane caused this review |
| `dispatch.status: "already-present"` | `remote-evidence-not-dispatch-caused` | the findings are real and complete; another channel summoned the reviewer |

The limitation withdraws the causal claim, not the evidence. Findings are
reported unchanged and no exit code moves — verified upstream by a test that runs
the harvest twice against receipts differing only in `dispatch.status` and
asserts the two observations are equal. It is also not a license to request a
reviewer outside the lane.

**Expect the limitation to be the steady state here** for as long as the `main`
ruleset's `copilot_code_review` rule is retained. A run of this repository's own
lane that reports *no* attribution limitation is the surprising case, and means
the ruleset lost the race. A repository that wants unqualified remote confidence
turns the ruleset rule off; this one does not.

### Self-installation reports permanent provenance drift

`install-consumer.mjs check` in this repository reports

```
Installation drift detected for platypeeps/sd-github-review:
- a newer source commit is available; run update
```

and will keep reporting it. This is **provenance drift, not file drift**: the
three managed files stay byte-identical to their sources. `check` still exits 1
— the message lands in `issues`, which clears `report.ok`, and
`scripts/install-consumer.mjs:46` sets `process.exitCode = 1` for any not-ok
report. A self-install therefore has a permanently failing `check`, so do not
wire this repository's own `check` into a gate that reads only the exit code.
The manifest records the source commit at install time — `commit` under
`source`, with `tag: null` and `released: false` for an install from a working
checkout rather than a release tag — and for a self-install the source
repository is this one, so every subsequent commit here makes that recording
older than `HEAD`.

Running `update` clears the message and restarts the treadmill: it rewrites the
manifest with the current commit, which the next commit invalidates again. Do
not treat this as a state to chase. An ordinary consumer does not see it, because
their recorded source commit belongs to a different repository and only moves
when they deliberately upgrade.

The signal that still matters is file drift: a managed file differing from its
recorded hash makes the installer preserve the operator edit and refuse
`update`/`uninstall`, which is the state that costs the rollback. Verify that
with `diff` against `examples/` and `contract/`, not with the provenance line.
