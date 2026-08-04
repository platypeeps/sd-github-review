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

Durable on-demand workflows, Copilot account settings, branch protection,
commits, pushes, and pull requests are outside this command boundary.

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
- `install` and `update` copy `examples/pr-agent-router.yml` exactly to the
  consumer's GitHub workflows file named ai-review-router.yml and manage its
  consumer-side sd-github-review.json ownership manifest atomically.
- `adopt` brings an unmanaged, manually copied workflow under installer
  ownership. It is explicit only and never inferred during install or update. It
  refuses when a manifest already exists (the installation is already managed;
  use `update`) or when no workflow exists (nothing to adopt; run `install`). It
  recognizes the existing workflow only by exact SHA-256 against the current
  template or the versioned `HISTORICAL_TEMPLATE_HASHES` allow-list (there is no
  fuzzy or semantic matching); an unrecognized workflow is rejected with a
  bounded manual-reconciliation message that never embeds the workflow content.
  A recognized workflow is converged to the current source, and provenance is
  recorded exactly as `install` records it. `adopt` plans ownership without
  claiming pre-existing unowned GitHub resources — only resources it creates are
  owned — so a conflicting unowned variable stops it before any mutation and a
  later `uninstall`/`check`/`update` behaves as for a fresh install. It requires
  confirmation (interactive `confirm` seam or `--yes`), honors `--dry-run`, and
  writes `pending` then `active` so a partial GitHub failure is resumable
  through the normal lifecycle.
- The manifest schema is version `2` (`MANIFEST_SCHEMA_VERSION`), tool
  `sd-github-review`, and state `pending`, `active`, or `uninstalling`. It
  records repository, workflow and source SHA-256, source provenance
  (`source.commit`, `source.tag`, `source.released`), provider/models, and exact
  variable/secret/label ownership. Source and workflow hashes must match. Extra
  owned resources are forbidden. A legacy schema-`1` manifest decodes as a
  pre-provenance install (no `source.commit/tag/released`); it is read-only and
  `update` rewrites it to schema 2.
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
  secret-presence, or label drift. It additionally reports a schema-1 migration
  issue, a newer-source-commit issue, and a released-tag-drift issue when the
  recorded provenance no longer matches the resolved source identity.
- The release gate `validateReleaseConsistency({ repositoryRoot, releaseTag,
  gitImpl })` in `scripts/validate-action-metadata.mjs` is a two-tier hygiene
  check. Its always-on tier (folded into `validateMetadata`, run by CI) asserts
  every first-party `platypeeps/sd-github-review@<40-hex>` pin across
  workflows/examples plus the descriptor `actionReference` in
  `config/routed-review-setup-v1.json` are mutually equal, the descriptor
  declares a known `contractMajor`, and `package.json` `version` is valid
  semver. Its opt-in tier additionally requires `releaseTag === v<version>` and
  a not-yet-existing tag. It never requires a pin to equal the release commit
  being cut. Exposed as `npm run validate:release -- vX.Y.Z`; not wired into
  `ci.yml`.
- Uninstall requires confirmation or `--yes`, removes only owned variables,
  and preserves secrets and labels unless explicit cleanup flags authorize
  them. `--remove-labels` still removes only installer-created labels.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Target is not a Git checkout | Fail before local or GitHub mutation |
| Explicit repository differs from GitHub origin | Fail with both bounded identities |
| Unsupported provider or malformed model | Fail before writing managed files |
| Unmanaged workflow has different content | Refuse `install` overwrite; `adopt` if recognized |
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
  manifest and workflow, creates the default OpenRouter/Qwen-cheap/Kimi-deep
  variables plus missing labels/secret, then marks the manifest active. A
  second install performs no remote mutations.
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
- Assert schema-2 provenance capture (git-verified `released:true`, dirty
  template or mismatched tag falling back to `released:false`, and the
  `.git`-less override recording `(false, v-tag)`); a schema-1 manifest decodes
  as pre-provenance and `update` rewrites it to schema 2 with a recorded commit.
- Assert a symlinked `.github/workflows` or `.github` manifest ancestor fails
  install/check/dry-run before writing outside the target with a bounded error
  that omits the symlink target, that a regular pre-existing `.github` directory
  still installs, and that a symlink swap injected between plan and rename fails
  closed without touching the external target.
- Assert the always-on metadata gate rejects inconsistent first-party pins, a
  drifted descriptor `actionReference`, a missing/unknown descriptor, and a
  non-semver version; assert `validateReleaseConsistency` accepts a matching
  not-yet-existing tag and rejects version mismatch and an existing tag.
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
