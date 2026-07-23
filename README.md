# SD GitHub review router

[![CI](https://github.com/platypeeps/sd-github-review/actions/workflows/ci.yml/badge.svg)](https://github.com/platypeeps/sd-github-review/actions/workflows/ci.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small, dependency-free GitHub Action that chooses the appropriate AI review
tier for a pull request:

- `cheap` for routine changes within configured risk limits
- `deep` for an external premium model
- `copilot` for sensitive or unusually large changes
- `none` when AI review is explicitly disabled

Copilot is integrated directly. The `cheap` and `deep` routes emit a generic
adapter contract for PR-Agent, Gito, or an internal service; the router does
not own provider credentials or a reviewer runtime. See [`DESIGN.md`](DESIGN.md)
for the architecture, automatic and manual selection rules, outputs, security
boundaries, and current backend contract.

## Installation on GitHub

### 1. Add the routing workflow

For a provider-free evaluation, start with
[`examples/pilot-router.yml`](examples/pilot-router.yml). It exercises routing
and Copilot without checking out pull-request code or using LLM provider
credentials. Replace `<commit-sha>` with the full SHA of a green candidate.

For a production integration, copy
[`examples/review-router.yml`](examples/review-router.yml) into the consuming
repository and replace both placeholders:

1. Pin this action to a released commit SHA.
2. Replace the example external-reviewer command with the organization's
   PR-Agent, Gito, or review-service adapter.

The workflow needs `pull-requests: write` only because the Copilot route creates
a review request. Keep deterministic test, lint, type-check, CodeQL, or Semgrep
jobs ahead of routing with normal `needs` dependencies.

### 2. Configure repository labels and variables

Create the labels used for manual routing:

- `review:cheap`
- `review:deep`
- `review:copilot`
- `review:none`
- `review:auto`

Set `CHEAP_REVIEW_MODEL` and `DEEP_REVIEW_MODEL` under **Settings → Secrets and
variables → Actions → Variables** when an external adapter needs explicit model
identifiers. Copilot routing does not require either variable.

### 3. Protect the default branch

Require the repository's deterministic CI and human-approval policy before
merge. AI review should remain supplemental. Open a smoke pull request and
confirm the selected route, reason, and side effect in the workflow summary.

### PR-Agent adapter

Use [`examples/pr-agent-router.yml`](examples/pr-agent-router.yml) when
`cheap` and `deep` should run the open-source PR-Agent GitHub Action.

1. Copy the example into the consuming repository's workflow directory.
2. Replace both action placeholders with reviewed, full 40-character commit
   SHAs. Do not use a floating branch such as `@main` in production.
3. Add `PR_AGENT_OPENAI_KEY` under **Settings → Secrets and variables → Actions
   → Secrets**. For another supported model provider, replace `OPENAI_KEY` with
   PR-Agent's provider-specific secret and use matching model identifiers.
4. Set `CHEAP_REVIEW_MODEL` and `DEEP_REVIEW_MODEL` to model identifiers PR-Agent
   accepts. The router passes the selected value as `config.model`.
5. Keep `config.restricted_mode=true`. The example grants `contents: read`,
   `issues: write`, and `pull-requests: write`; it does not grant contents write
   or check out pull-request code.

The PR-Agent step runs only for `cheap` or `deep`. Its automatic describe and
improve tools are disabled, while review is enabled for the router's open,
reopen, ready, label, synchronize, and trusted comment paths. Pull-request
workflows from forks do not receive repository secrets, so the example skips
the PR-Agent step for fork-originated `pull_request` events. A trusted
`issue_comment` invocation can still run from the base workflow without
checking out contributor code.

PR-Agent can also read settings from a repository-root `.pr_agent.toml`. See
its [GitHub installation guide](https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/installation/github.md)
and [automation/configuration guide](https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/usage-guide/automations_and_usage.md)
for provider-specific variables and review settings.

PR-Agent currently describes its open-source project as community-maintained
legacy software and distributes it under AGPL-3.0. Review that dependency's
maintenance and license fit independently; this repository's MIT license does
not relicense PR-Agent.

Supply-chain note: pinning PR-Agent's repository revision does not fully pin
its current Docker runtime because the upstream action builds from the floating
`pragent/pr-agent:github_action` image tag. Environments requiring complete
immutability should review and fork the action, then pin the base image by
digest or publish an internally controlled wrapper.

### Durable on-demand integration

Use [`examples/on-demand-review-router.yml`](examples/on-demand-review-router.yml)
when `sd-review` or another trusted caller needs an exact-head, cross-run
receipt instead of the standalone event outputs.

1. Copy the example into the consuming repository at the workflow path
   declared by the setup descriptor, and replace every action placeholder
   with a reviewed full commit SHA.
2. Keep the workflow's `contents: read`, `pull-requests: write`, and
   `checks: write` permissions. Only this durable workflow needs Check Run
   write access.
3. Configure `SD_REVIEW_CHEAP_BACKEND_V1` and
   `SD_REVIEW_DEEP_BACKEND_V1` as canonical backend descriptor JSON. The
   supported shapes are demonstrated in
   [`fixtures/protocol/v1/supporting.valid.json`](fixtures/protocol/v1/supporting.valid.json).
4. Replace the external-adapter placeholder with the consumer-owned PR-Agent,
   Gito, or internal adapter. Keep its provider secret on that step. The
   adapter accepts `adapter-request` and returns one versioned
   `adapter-acknowledgment`; the following router invocation finalizes the
   same receipt.
5. Publish [`config/routed-review-setup-v1.json`](config/routed-review-setup-v1.json)
   with the workflow so clients can perform read-only setup discovery before
   dispatch.

The Action operations are `route`, `finalize`, and `query`. Every durable call
accepts the canonical `review-request` JSON. `route` performs at most one
native Copilot request or emits exactly one external adapter request;
`finalize` requires the matching external acknowledgment; `query` reads the
head-bound receipt without dispatching. If a side effect is uncertain, the
receipt reports `reconciliation-required` and never authorizes a fallback.

The example performs no checkout and runs no pull-request-controlled command.
The setup descriptor distinguishes a truly absent declaration from missing,
disabled, incompatible, and metadata-unavailable integrations; only a
compatible enabled workflow is ready.

## Development

The action has no runtime dependencies and uses Node.js 24's built-in test
runner. The development-only YAML parser validates the action and workflow
metadata. AI-agent and Trellis files in this public repository follow the
documented [public metadata policy](docs/PUBLIC_METADATA_POLICY.md); the same
metadata gate rejects tracked local/session paths.

```sh
npm ci
npm test
npm run check
npm run validate:metadata
```

The first-release and pilot gates are recorded in
[`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

## License

Licensed under the [MIT License](LICENSE).
