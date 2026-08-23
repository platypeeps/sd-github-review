# SD GitHub review router

[![CI](https://github.com/platypeeps/sd-github-review/actions/workflows/ci.yml/badge.svg)](https://github.com/platypeeps/sd-github-review/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/platypeeps/sd-github-review)](https://github.com/platypeeps/sd-github-review/releases/latest)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small, dependency-free GitHub Action that chooses the appropriate AI review
tier for a pull request:

- `cheap` for routine changes within configured risk limits
- `deep` for a more capable external model, including high-risk changes in the
  shipped PR-Agent profile
- `copilot` for explicit native reviews; sensitive or unusually large changes go
  to `deep` by default, and reach `copilot` only when `high-risk-route` is set
- `none` when AI review is explicitly disabled

Copilot is integrated directly. The `cheap` and `deep` routes emit a generic
adapter contract for PR-Agent or an internal service; the router does
not own provider credentials or a reviewer runtime. See [`DESIGN.md`](DESIGN.md)
for the architecture, automatic and manual selection rules, outputs, security
boundaries, and current backend contract.

## Installation on GitHub

This repository supplies reusable workflows, routing logic, and a lifecycle
installer for the supported event-driven PR-Agent setup. The installer does
not enable Copilot, configure branch rules, or commit and push changes in the
consumer repository.

### Automated event-driven PR-Agent setup

From this repository checkout, use Node.js 24, Git, and an authenticated
GitHub CLI with administration access to the consumer repository. Preview the
default OpenRouter setup—Qwen3-Coder 30B A3B for routine reviews and Kimi K2.6
for deep reviews—then install it and enter the provider key through GitHub
CLI's secret prompt:

```sh
node scripts/install-consumer.mjs install --target /path/to/consumer --route-mode copilot --review-floor copilot --set-secret --dry-run
node scripts/install-consumer.mjs install --target /path/to/consumer --route-mode copilot --review-floor copilot --set-secret
```

The command copies three reviewed files — the event-driven router workflow, the
durable `sd-review.yml` lane, and the setup discovery descriptor it declares —
creates the routing variables (including `REVIEW_ROUTE_MODE` and
`REVIEW_INDEPENDENT_FLOOR`) and missing
labels, and records ownership of all three in a consumer-side
sd-github-review.json manifest under the repository's
GitHub metadata directory. The manifest also
records source provenance (the release commit and, for a clean tagged checkout,
the release tag); run the installer from a checkout of the release tag, or pass
`--source-tag`/`--source-commit` for a `.git`-less artifact. See
[source provenance](SETUP-PR-AGENT.md#source-provenance).
The managed PR-Agent profile sends sensitive paths and changes at the line
threshold to its configured `deep` model. An update adopts that profile while
preserving the consumer's existing provider and cheap/deep model values.
It never puts the provider key in an argument, manifest, or log. It also
supports `update`, read-only `check`, and guarded `uninstall`:

> **`--route-mode` is required, and there is no default.** Both installed lanes
> read the `REVIEW_ROUTE_MODE` repository variable, in different ways: the
> event-driven router lane uses it to *choose* its route, and the durable lane
> enforces it as a **maximum** on what a caller may explicitly request. On the
> durable lane, `sd-review --remote deep` against a consumer installed
> `--route-mode copilot` is refused, naming the variable — `auto` is always
> permitted, so ordinary reviews are unaffected. This enforcement arrived with
> the durable route policy; a consumer installed before it must run `update` to
> take the new workflow template, and until it does, its durable lane will honor
> an explicit off-policy route as it did previously.
>
> The installer creates and manages the variable — `check` reports it missing,
> `uninstall` removes it — but it will not choose a value for you, because
> choosing means `auto`, and `auto` can select `cheap` or `deep` and bill your
> provider key on a route you did not pick. Pass `copilot` or `none` for an
> independent review with no PR-Agent spend, or `auto`, `cheap`, or `deep` to
> opt into paid review.
>
> An `update` keeps whatever the manifest already records. If you set the
> variable by hand before installing, the installer adopts that value and marks
> it unowned, so `uninstall` leaves it alone:
>
> ```sh
> gh variable set REVIEW_ROUTE_MODE --body copilot --repo <owner>/<repo>
> ```

```sh
node scripts/install-consumer.mjs check --target /path/to/consumer
node scripts/install-consumer.mjs update --target /path/to/consumer
node scripts/install-consumer.mjs uninstall --target /path/to/consumer --yes
```

Review and commit the resulting consumer-repository files yourself. See
[`SETUP-PR-AGENT.md`](SETUP-PR-AGENT.md#automated-event-driven-lifecycle) for
provider overrides, non-interactive secret input, ownership behavior, partial
failure recovery, and optional cleanup.

### 1. Choose a backend and workflow

- **GitHub Copilot:** follow [`SETUP-COPILOT.md`](SETUP-COPILOT.md). The router
  requests Copilot directly when it selects `copilot`; no provider secret is
  required. GitHub owns model selection, and review effort is a GitHub
  repository setting rather than a per-request action input.
- **PR-Agent:** follow [`SETUP-PR-AGENT.md`](SETUP-PR-AGENT.md). The shipped
  profile handles routine and high-risk automatic reviews through `cheap` and
  `deep`, supports the documented single-key provider mappings, and retains
  explicit native Copilot routing.
- **Another external reviewer:** start from
  [`examples/review-router.yml`](examples/review-router.yml) and replace its
  adapter placeholder with the organization's internal review service.
- **Lowest cost:** start from
  [`examples/gated-review-router.yml`](examples/gated-review-router.yml), which
  runs free deterministic checks in a separate job and reaches the router only
  through `needs:` on that job. No AI review is billed for a pull request a
  lint, type-check, or test failure would have rejected. See also
  [Lowering the automatic route with local review evidence](DESIGN.md#lowering-the-automatic-route-with-local-review-evidence)
  for reducing cost further on the durable path.

For a provider-free evaluation, start with
[`examples/pilot-router.yml`](examples/pilot-router.yml). It exercises routing
and Copilot without checking out pull-request code or using LLM provider
credentials. The checked-in example is pinned to the immutable current release
commit,
`6ba1eff049962faded1c289f666ef56b58c61b4d`.

Every checked-in first-party example uses that same released full SHA. When
upgrading, replace all first-party Action references with the reviewed full SHA
of the newer release; use tags for discovery, not installation. Keep
deterministic test, lint, type-check, CodeQL, or Semgrep jobs ahead of routing
with normal `needs` dependencies.

### 2. Configure shared routing controls

The automated PR-Agent installer creates missing labels. For Copilot-only,
durable, or manual installations, create the labels used for manual routing:

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
adapter placeholder, keep provider secrets only on that step, and publish the
setup capability descriptor so clients can perform read-only setup discovery
before dispatch. Copy this repository's published
[`contract/routed-review-setup-v1.json`](contract/routed-review-setup-v1.json)
into your repository as `config/routed-review-setup-v1.json`. The two paths
differ on purpose: `contract/` is where this repository publishes the reference
copy, and `config/` is the only path setup discovery probes.

The durable receipt operations are `route`, `finalize`, and `query`. Every
durable call accepts the canonical `review-request` JSON. `route` performs at
most one native Copilot request or emits exactly one external adapter request;
`finalize` requires the matching external acknowledgment; `query` reads the
head-bound receipt without dispatching. The additive `acknowledge` helper
converts a bounded GitHub adapter-step outcome into that canonical
acknowledgment without contacting GitHub or a model provider. If a side effect
is uncertain, the receipt reports `reconciliation-required` and never
authorizes a fallback; `route` fails the step on it, since a receipt needing a
human means no review was dispatched and reporting that only on an output
leaves a green job and a silently unreviewed pull request. A dispatch that
could still be running reports `in-flight` instead and does not fail.

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
