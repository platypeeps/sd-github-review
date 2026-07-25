# Consumer Installer Design

## Architecture

The installer is repository-only tooling under `scripts/`; it is not imported
by the shipped GitHub Action runtime.

```text
CLI arguments / stdin
        |
        v
validate target + provider/model contract
        |
        v
inspect managed files + bounded GitHub metadata through gh
        |
        v
build deterministic lifecycle plan
        |
        +-- check/dry-run --> report only
        |
        v
write pending manifest and workflow atomically
        |
        v
apply idempotent GitHub mutations
        |
        v
write active manifest atomically
```

`scripts/consumer-installer.mjs` owns constants, validation, manifest decoding,
planning, filesystem mutation, and the injected GitHub command boundary.
`scripts/install-consumer.mjs` is a thin executable entrypoint.

## Command Contract

```text
node scripts/install-consumer.mjs install [options]
node scripts/install-consumer.mjs update [options]
node scripts/install-consumer.mjs check [options]
node scripts/install-consumer.mjs uninstall [options]
```

Common options select `--target`, `--github`, `--provider`, `--cheap-model`,
`--deep-model`, `--dry-run`, and `--json`. Install/update accept
`--set-secret` or `--secret-stdin`; uninstall accepts `--yes`,
`--remove-secret`, and `--remove-labels`.

The CLI does not accept a secret-value option. `--set-secret` delegates an
interactive prompt to `gh secret set`; `--secret-stdin` reads the value once,
forwards it directly to the child process, and never includes it in a plan or
error.

## Managed Manifest

`.github/sd-github-review.json` is a versioned JSON object containing:

- schema, tool, and lifecycle state (`pending`, `active`, `uninstalling`);
- exact GitHub repository and workflow path;
- installed workflow SHA-256 and current source-template SHA-256;
- provider plus cheap/deep model identifiers;
- variables, secret name, and labels with `owned` flags.

The manifest contains no timestamp or credential value. Deterministic output
makes review and idempotency easier. Unknown schema versions, malformed fields,
or repository identity mismatches fail closed.

## Ownership and Mutation Rules

On first install, a missing remote resource becomes installer-owned. A
pre-existing resource with the exact desired value is preserved and recorded
as unowned. A conflicting pre-existing variable is not overwritten. Existing
labels are never edited.

Updates may change values only for installer-owned variables. Unowned values
must already match the requested configuration. Explicit secret replacement is
allowed but does not change whether the secret predated installation.

The workflow and pending manifest are written before GitHub mutations. Because
the tool never commits or pushes the consumer checkout, a failed remote step
cannot activate a broken workflow on GitHub. The pending manifest preserves
the intended ownership plan so a rerun does not misclassify resources created
before the failure.

Uninstall first records `uninstalling`, then removes owned variables and any
explicitly authorized secret/installer-created labels. Managed local files are
removed only after remote cleanup succeeds. A retry can therefore resume an
interrupted uninstall.

## Drift and Update Semantics

`check` compares four layers:

1. target Git identity and configured GitHub repository;
2. manifest validity and lifecycle state;
3. workflow content against the recorded hash and current source template;
4. remote variables, secret presence, and labels.

A workflow matching its recorded hash but not the current source template is
reported as an available update. A workflow differing from its recorded hash
is treated as operator modification and is never overwritten automatically.

## Compatibility and Rollback

The tool requires Node 24, Git, GitHub CLI authentication, a GitHub `origin`
or explicit matching slug, and repository administration permission for
Actions variables/secrets and labels. It supports only the provider/model
shape already enforced by `examples/pr-agent-router.yml`.

Rollback is `uninstall`; historical PR-Agent comments and GitHub Actions runs
remain. Secrets and labels remain unless separately authorized because they
may have other consumers.

## Risks

- GitHub mutations are not transactional. Pending/uninstalling state and
  idempotent retries bound partial failure.
- A variable can be reused by an unrelated workflow. Ownership tracking and
  refusal to overwrite unowned values prevent silent takeover.
- A user may edit the managed workflow. Hash checks preserve those edits and
  require deliberate reconciliation.
- Secret existence does not prove the key is valid. Live provider smoke
  testing remains an operator verification step.
