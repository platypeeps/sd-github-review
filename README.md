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
adapter contract for PR-Agent or an internal service; the router does
not own provider credentials or a reviewer runtime. See [`DESIGN.md`](DESIGN.md)
for the architecture, automatic and manual selection rules, outputs, security
boundaries, and current backend contract.

## Installation on GitHub

This repository supplies reusable workflows and routing logic; it does not
provision another repository's workflows, secrets, variables, labels, Copilot
access, or branch rules.

### 1. Choose a backend and workflow

- **GitHub Copilot:** follow [`SETUP-COPILOT.md`](SETUP-COPILOT.md). The router
  requests Copilot directly when it selects `copilot`; no provider secret is
  required. GitHub owns model selection, and review effort is a GitHub
  repository setting rather than a per-request action input.
- **PR-Agent plus Copilot escalation:** follow
  [`SETUP-PR-AGENT.md`](SETUP-PR-AGENT.md). PR-Agent handles `cheap` and `deep`,
  supports the documented single-key provider mappings, and retains the native
  Copilot route.
- **Another external reviewer:** start from
  [`examples/review-router.yml`](examples/review-router.yml) and replace its
  adapter placeholder with the organization's internal review service.

For a provider-free evaluation, start with
[`examples/pilot-router.yml`](examples/pilot-router.yml). It exercises routing
and Copilot without checking out pull-request code or using LLM provider
credentials. Replace `<commit-sha>` with the full SHA of a green candidate.

Pin this action to a reviewed full commit SHA in every installed workflow. Keep
deterministic test, lint, type-check, CodeQL, or Semgrep jobs ahead of routing
with normal `needs` dependencies.

### 2. Configure shared routing controls

Create the labels used for manual routing:

- `review:cheap`
- `review:deep`
- `review:copilot`
- `review:none`
- `review:auto`

Authorized maintainers can also use exact `/review cheap`, `/review deep`,
`/review copilot`, `/review none`, or `/review auto` comments. Backend-specific
variables, secrets, and permissions are documented in the two setup guides.

### 3. Protect the default branch

Require the repository's deterministic CI and human-approval policy before
merge. AI review should remain supplemental. Open a smoke pull request and
confirm the selected route, reason, and side effect in the workflow summary.

### Durable on-demand integration

Use [`examples/on-demand-review-router.yml`](examples/on-demand-review-router.yml)
when `sd-review` or another trusted caller needs an exact-head, cross-run
receipt instead of the standalone event outputs.

The Copilot and PR-Agent setup guides contain their respective durable
installation steps. Other adapters should replace the generic workflow's
adapter placeholder, keep provider secrets only on that step, and publish
[`config/routed-review-setup-v1.json`](config/routed-review-setup-v1.json) so
clients can perform read-only setup discovery before dispatch.

The durable receipt operations are `route`, `finalize`, and `query`. Every
durable call accepts the canonical `review-request` JSON. `route` performs at
most one native Copilot request or emits exactly one external adapter request;
`finalize` requires the matching external acknowledgment; `query` reads the
head-bound receipt without dispatching. The additive `acknowledge` helper
converts a bounded GitHub adapter-step outcome into that canonical
acknowledgment without contacting GitHub or a model provider. If a side effect
is uncertain, the receipt reports `reconciliation-required` and never
authorizes a fallback.

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
