# SD GitHub review router

A small, dependency-free GitHub Action that chooses the appropriate AI review tier for a pull request:

- `cheap` for routine changes within configured risk limits
- `deep` for an external premium model
- `copilot` for sensitive or unusually large changes
- `none` when AI review is explicitly disabled

The Copilot route requests `copilot-pull-request-reviewer[bot]` through GitHub's review-request API. The `cheap` and `deep` routes intentionally emit outputs instead of owning provider credentials or a reviewer runtime. A following workflow step can invoke PR-Agent, Gito, or an internal service with the selected model.

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

The workflow needs `pull-requests: write` only because the Copilot route creates a review request. Keep deterministic test, lint, type-check, CodeQL, or Semgrep jobs ahead of the routing job with normal `needs` dependencies.

## Routing order

The first applicable rule wins:

1. A non-`auto` `mode` action input.
2. A trusted exact command: `/review cheap`, `/review deep`, `/review copilot`, `/review none`, or `/review auto`.
3. A `review:cheap`, `review:deep`, `review:copilot`, or `review:none` label.
4. Draft policy, sensitive paths, changed-line threshold, and earlier-review confidence.
5. The `cheap` route.

`review:auto` removes an explicit preference without selecting a route. Conflicting explicit route labels fail visibly instead of choosing an arbitrary winner.

Commands default to repository owners, members, and collaborators. Set `allow-pr-author-commands: "true"` if outside contributors should be allowed to spend review capacity. Unrelated issue comments and label events are ignored so they do not retrigger reviews.

## Consuming outputs

The main outputs are:

| Output | Meaning |
|---|---|
| `route` | `cheap`, `deep`, `copilot`, or `none` |
| `reason` | Why the route was selected |
| `model` | Configured provider model for `cheap` or `deep` |
| `run-external-reviewer` | `true` for `cheap` and `deep` |
| `copilot-requested` | Whether this run created a Copilot review request |
| `sensitive-files` | JSON array of matched paths |

An explicit input, trusted command, label, or disabled-draft decision does not
need automatic path-risk evaluation. Those routes report `sensitive-files` as
`[]` and do not enumerate pull-request files. An empty `cheap-model` or
`deep-model` is valid: it means the consumer-owned adapter chooses its own
default. Set repository variables when the adapter requires an explicit model.

Configure current provider model identifiers in repository variables such as `CHEAP_REVIEW_MODEL` and `DEEP_REVIEW_MODEL`. This keeps model churn out of the action and makes changes auditable in each consuming organization.

## Sensitive path patterns

Patterns are comma- or newline-separated. `*` matches within one path segment, `**` crosses directories, and `?` matches one non-separator character. Defaults cover authentication, authorization, billing, cryptography, migrations, schemas, and public API directories. Override the list to match the repository's actual layout.

## Security notes

- Pin this action and external reviewer actions to full commit SHAs.
- Do not check out or execute pull-request code in an `issue_comment` job with secrets.
- Keep LLM provider keys on the external-reviewer step; the router needs only a GitHub token.
- Leave outside-contributor commands disabled unless the associated cost exposure is acceptable.
- Treat AI review as supplemental. Branch protection should still require the project's deterministic checks and human approval policy.

## Development

The action has no runtime dependencies and uses Node.js 20's built-in test
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
