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
node scripts/install-consumer.mjs check [options]
node scripts/install-consumer.mjs uninstall [options]
```

- `runConsumerInstaller(options, dependencies?) -> Promise<report>`
- `parseArguments(argv) -> options|{ help: true }`
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
- The manifest schema is version `1`, tool `sd-github-review`, and state
  `pending`, `active`, or `uninstalling`. It records repository, workflow and
  source SHA-256, provider/models, and exact variable/secret/label ownership.
  Source and workflow hashes must match. Extra owned resources are forbidden.
- Supported providers are the same single-key allowlist enforced by the
  checked-in PR-Agent workflow. Non-OpenAI model IDs require the exact
  `<provider>/` prefix; every model is nonempty, whitespace-free, and at most
  256 characters.
- GitHub resources are `PR_AGENT_MODEL_PROVIDER`, `CHEAP_REVIEW_MODEL`,
  `DEEP_REVIEW_MODEL`, `PR_AGENT_MODEL_API_KEY`, and the router's five review
  labels. Matching pre-existing resources are unowned and preserved.
- Provider secret values enter only through the inherited `gh secret set`
  prompt or standard input. They never enter CLI arguments, reports,
  manifests, diagnostics, or JSON output.
- Mutating commands support `--dry-run`. The tool writes `pending` before
  install/update remote mutations and `uninstalling` before removals. It never
  commits or pushes the consumer checkout.
- `check` is read-only and exits nonzero for local, source-template, variable,
  secret-presence, or label drift.
- Uninstall requires confirmation or `--yes`, removes only owned variables,
  and preserves secrets and labels unless explicit cleanup flags authorize
  them. `--remove-labels` still removes only installer-created labels.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Target is not a Git checkout | Fail before local or GitHub mutation |
| Explicit repository differs from GitHub origin | Fail with both bounded identities |
| Unsupported provider or malformed model | Fail before writing managed files |
| Unmanaged workflow has different content | Refuse overwrite |
| Managed workflow differs from recorded hash | Preserve operator edit and refuse update/uninstall |
| Pre-existing unowned variable conflicts | Refuse takeover; require manual reconciliation |
| Secret is absent without an approved input mode | Fail with prompt/stdin recovery command |
| GitHub mutation fails during install/update | Retain `pending` manifest for idempotent retry |
| GitHub mutation fails during uninstall | Retain `uninstalling` manifest and managed workflow |
| Manifest includes unknown owned variable/label | Reject before any deletion |
| `check` observes drift | Return a bounded issue list and nonzero exit without mutation |
| Secret-setting command fails | Redact the submitted value from the propagated diagnostic |

### 5. Good/Base/Bad Cases

- Good: a fresh target uses `--set-secret`; the command writes the pending
  manifest and workflow, creates missing variables/labels/secret, then marks
  the manifest active. A second install performs no remote mutations.
- Base: a target already has matching variables, labels, or secret. The
  installer records them as unowned, leaves them unchanged, and later
  uninstall preserves them.
- Bad: an edited manifest claims ownership of an unrelated label, or the
  managed workflow has changed since its recorded hash. Decoding or lifecycle
  validation fails before deletion or overwrite.

### 6. Tests Required

- Parse HTTPS/SSH GitHub remotes and reject repository mismatches.
- Assert install/update convergence, source-template refresh, remote drift,
  dry-run immutability, and provider/model changes.
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
