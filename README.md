# SD GitHub review router

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
boundaries, and planned backends.

## Quick start

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

## Development

The action has no runtime dependencies and uses Node.js 24's built-in test
runner. The development-only YAML parser validates the action and workflow
metadata.

```sh
npm ci
npm test
npm run check
npm run validate:metadata
```

The first-release and pilot gates are recorded in
[`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).
