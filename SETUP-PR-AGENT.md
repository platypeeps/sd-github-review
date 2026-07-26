# Set up PR-Agent review

This guide configures PR-Agent as the external reviewer for the router's
`cheap` and `deep` routes. The supplied profiles set `high-risk-route: deep`,
so sensitive and unusually large automatic reviews use PR-Agent's configured
deep model. The native `copilot` route remains available through an explicit
mode, label, command, or durable request.

The supplied workflows automate routing and PR-Agent execution after they are
installed. The lifecycle installer can provision the supported event-driven
workflow, Actions settings, and labels. Durable setup and branch rules remain
manual.

## How this integration runs

The workflows invoke only PR-Agent's `review` CLI command against the selected
pull request. They run the PR-Agent v0.39.0 container by immutable
multi-platform digest, do not check out pull-request code, disable fallback
models, and keep restricted mode enabled.

The workflows launch the pinned CLI image with a direct `docker run` step and
pass credentials by environment-variable name. Do not replace that step with
`uses: docker://`: GitHub changes a Docker action's working directory to the
workspace, while the upstream CLI image entrypoint expects its `/app` working
directory. No repository workspace is mounted into the review container.

This is a direct GitHub Actions integration. Do not install the PR-Agent GitHub
App for these workflows. PR-Agent posts through the workflow's
`github.token`, normally as `github-actions[bot]`.

PR-Agent is a consumer-owned external backend: the provider credential exists
only on the PR-Agent step and is never passed to `sd-github-review`.

## Choose an operating mode

| Mode | Workflow | Use when |
| --- | --- | --- |
| Event-driven | [`examples/pr-agent-router.yml`](examples/pr-agent-router.yml) | Pull-request events, labels, and trusted `/review` comments should trigger routing directly |
| Durable on demand | [`examples/pr-agent-on-demand-review-router.yml`](examples/pr-agent-on-demand-review-router.yml) | A trusted caller needs exact-head dispatch deduplication and a persistent receipt |

Install only the workflow that owns a given trigger path. Running multiple
event-driven review workflows for the same pull request can create duplicate
provider calls and comments.

## Automated event-driven lifecycle

The repository-owned CLI manages the event-driven workflow and its GitHub
settings. It requires Node.js 24, Git, and an authenticated `gh` CLI with
administration access to the consuming repository. Run it from an updated
`sd-github-review` checkout and point `--target` at the local consumer
checkout.

Preview and install the default OpenRouter configuration, which uses
Qwen3-Coder 30B A3B for `cheap` reviews and Kimi K2.6 for `deep` reviews:

```sh
node scripts/install-consumer.mjs install --target /path/to/consumer --set-secret --dry-run
node scripts/install-consumer.mjs install --target /path/to/consumer --set-secret
```

`--set-secret` delegates the hidden provider-key prompt to `gh secret set`.
For non-interactive automation, pass the key only through standard input:

```sh
printf '%s' "$PR_AGENT_KEY" | node scripts/install-consumer.mjs install \
  --target /path/to/consumer --secret-stdin
```

Do not place the key directly on the command line. The installer never stores
it in `.github/sd-github-review.json`, its plan, or JSON output.

To select another supported single-key provider or different tier models, set
all three values explicitly. Except for OpenAI, each model must use the
provider-prefixed form enforced by the workflow:

```sh
node scripts/install-consumer.mjs install --target /path/to/consumer \
  --provider gemini \
  --cheap-model gemini/replace-with-cheap-model-id \
  --deep-model gemini/replace-with-deep-model-id \
  --set-secret
```

After updating this source checkout to a reviewed release, inspect and apply a
consumer update. Omitted provider/model options preserve the manifest's current
configuration:

```sh
node scripts/install-consumer.mjs check --target /path/to/consumer
node scripts/install-consumer.mjs update --target /path/to/consumer --dry-run
node scripts/install-consumer.mjs update --target /path/to/consumer
```

Managed updates also adopt the current workflow routing profile. In this
release that intentionally moves automatic sensitive and threshold-bound
reviews from native Copilot to the configured PR-Agent `deep` model; provider
and model values remain unchanged. To retain hybrid automatic escalation, set
`high-risk-route: copilot` in a manually owned workflow instead of relying on
the managed template.

`check` is read-only and returns nonzero for local or GitHub drift. Add `--json`
for machine-readable output.

The installer writes the managed workflow and a `pending` manifest before it
changes GitHub settings, then marks the manifest `active` after every mutation
succeeds. It never commits or pushes the consumer checkout. If a GitHub command
fails, do not commit the files; correct the permission or configuration issue
and rerun the same install/update command. The recorded ownership makes that
retry idempotent. A workflow edited after installation is preserved and blocks
automatic update or uninstall until the operator reconciles it.

Uninstall requires confirmation. It removes the managed files and variables
created by the installer, but preserves secrets and labels by default because
they may be shared:

```sh
node scripts/install-consumer.mjs uninstall --target /path/to/consumer --dry-run
node scripts/install-consumer.mjs uninstall --target /path/to/consumer --yes
```

Add `--remove-secret` to delete `PR_AGENT_MODEL_API_KEY`. Add
`--remove-labels` to delete only labels that the manifest records as created
by this installer; pre-existing labels remain. Historical PR-Agent comments
and Actions runs are not deleted.

## Configure the provider

The checked-in examples use a provider-neutral secret and explicitly support
these single-key provider mappings:

1. In the consuming repository, open **Settings → Secrets and variables →
   Actions → Secrets**.
2. Create `PR_AGENT_MODEL_API_KEY` with the selected provider's API key.
3. Under **Actions → Variables**, create `PR_AGENT_MODEL_PROVIDER` with one of
   these lowercase values:

   | Value | PR-Agent credential setting | Model format |
   | --- | --- | --- |
   | `openai` | `OPENAI__KEY` | A PR-Agent-supported OpenAI model ID |
   | `gemini` | `GOOGLE_AI_STUDIO__GEMINI_API_KEY` | `gemini/<model-id>` |
   | `openrouter` | `OPENROUTER__KEY` | `openrouter/<model-id>` |
   | `anthropic` | `ANTHROPIC__KEY` | `anthropic/<model-id>` |
   | `cohere` | `COHERE__KEY` | `cohere/<model-id>` |
   | `replicate` | `REPLICATE__KEY` | `replicate/<model-id>` |
   | `groq` | `GROQ__KEY` | `groq/<model-id>` |
   | `sambanova` | `SAMBANOVA__KEY` | `sambanova/<model-id>` |
   | `xai` | `XAI__KEY` | `xai/<model-id>` |
   | `deepseek` | `DEEPSEEK__KEY` | `deepseek/<model-id>` |
   | `deepinfra` | `DEEPINFRA__KEY` | `deepinfra/<model-id>` |
   | `mistral` | `MISTRAL__KEY` | `mistral/<model-id>` |
   | `codestral` | `CODESTRAL__KEY` | `codestral/<model-id>` |

   The workflow maps the generic secret to only the selected provider setting.
   Except for OpenAI, the checked-in preflight requires the explicit
   `<provider>/<model-id>` form, even if an upstream alias also works without
   the provider prefix.
4. Never store the key in a repository variable, workflow file, PR-Agent
   configuration file, or router input.

The two model tiers may use different model IDs from the selected provider.
One installed workflow uses one provider credential for both tiers. To add a
provider that needs more than one credential or an endpoint setting, extend
the workflow contract deliberately; do not construct secret names dynamically
or pass keys through the router. Consult PR-Agent's
[GitHub installation guide](https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/docs/docs/installation/github.md)
for provider-specific configuration.

### Gemini example

To use Gemini, set `PR_AGENT_MODEL_PROVIDER=gemini`, store a Google AI Studio
key in `PR_AGENT_MODEL_API_KEY`, and use PR-Agent model IDs in the
`gemini/<model-id>` form for both tiers. Choose model IDs that are currently
available to the configured Google account; the workflow deliberately does not
embed a default model.

### OpenRouter example

To use OpenRouter, set `PR_AGENT_MODEL_PROVIDER=openrouter`, store the
OpenRouter key in `PR_AGENT_MODEL_API_KEY`, and prefix the OpenRouter model ID
with `openrouter/`. For example, an OpenRouter model ID shaped as
`provider/model` becomes `openrouter/provider/model` for PR-Agent. Some models
also require `custom_model_max_tokens` in `.pr_agent.toml`; the workflow does
not guess that value.

#### Default OpenRouter tier pairing

The default and current pilot use Qwen3-Coder 30B A3B for routine reviews and
Kimi K2.6 for deep reviews through the existing OpenRouter mapping. Neither
model adds a separate provider or credential shape. Configure:

```text
PR_AGENT_MODEL_PROVIDER=openrouter
CHEAP_REVIEW_MODEL=openrouter/qwen/qwen3-coder-30b-a3b-instruct
DEEP_REVIEW_MODEL=openrouter/moonshotai/kimi-k2.6
```

Store the OpenRouter API key only in the `PR_AGENT_MODEL_API_KEY` Actions
secret. The smaller code-specialized cheap model reduces routine-review cost,
while the deep route retains Kimi K2.6 for higher-risk work. Keep tier changes
explicit; the workflow disables fallback models rather than silently switching
between them.

### Other upstream providers

PR-Agent v0.39.0 also documents or implements configuration for Azure OpenAI,
Amazon Bedrock, Vertex AI, Ollama and vLLM, Hugging Face, Databricks,
OpenAI-compatible endpoints, and additional LiteLLM providers. These are
upstream capabilities, not mappings enabled by the checked-in workflows: they
require an endpoint, cloud identity, local runtime, or multiple configuration
values rather than the single-key interface used here.
See PR-Agent's
[model configuration guide](https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/docs/docs/usage-guide/changing_a_model.md)
and
[secret template](https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/pr_agent/settings/.secrets_template.toml).

## Manual event-driven workflow installation

1. Copy [`examples/pr-agent-router.yml`](examples/pr-agent-router.yml) to the
   consuming repository, for example as
   `.github/workflows/ai-review-router.yml`.
2. The checked-in workflow is pinned to the `v0.1.0` release commit,
   `8636a3983d18de17c49907a4c48170a61b1bb713`. Keep that exact pin or update
   it to the reviewed full 40-character SHA of a later approved release. The
   PR-Agent container reference is independently pinned by digest.
3. Under **Settings → Secrets and variables → Actions → Variables**, create:

   - `CHEAP_REVIEW_MODEL` with the PR-Agent model ID for routine reviews.
   - `DEEP_REVIEW_MODEL` with the PR-Agent model ID for more capable reviews.

   Both values must be nonempty. The workflow passes the selected value as
   `CONFIG__MODEL` and fails before PR-Agent starts when it is empty.
4. Keep these workflow permissions:

   ```yaml
   permissions:
     contents: read
     issues: write
     pull-requests: write
   ```

   `issues: write` and `pull-requests: write` allow PR-Agent to publish its
   conversation comment and allow the router to request Copilot when that
   route is selected explicitly. The workflow does not need contents write
   access.
5. Add the shared manual-routing labels described in
   [`README.md`](README.md#2-configure-shared-routing-controls).
6. Adjust the action's `sensitive-paths`, thresholds, command trust settings,
   `high-risk-route`, or draft policy as needed. The supplied value is `deep`;
   changing it to `copilot` restores native automatic escalation. The complete
   selection rules are in [`DESIGN.md`](DESIGN.md#automatic-selection).

Repository secrets are not supplied to ordinary `pull_request` workflows from
forks, so the example skips PR-Agent for fork-originated pull-request events.
A trusted `/review cheap` or `/review deep` comment runs from the base
repository's `issue_comment` workflow without checking out contributor code.

## Install the durable on-demand workflow

1. Copy
   [`examples/pr-agent-on-demand-review-router.yml`](examples/pr-agent-on-demand-review-router.yml)
   to `.github/workflows/sd-review.yml`.
2. Keep every first-party Action reference on the checked-in immutable
   `v0.1.0` SHA, or update all of them together to the reviewed full SHA of a
   later approved release.
3. Configure `PR_AGENT_MODEL_PROVIDER` and `PR_AGENT_MODEL_API_KEY` as
   described above.
4. Keep `contents: read`, `issues: write`, `pull-requests: write`, and
   `checks: write`. Check Run write access stores the exact-head receipt.
5. Create `SD_REVIEW_CHEAP_BACKEND_V1` and
   `SD_REVIEW_DEEP_BACKEND_V1` under **Actions → Variables**. Each value is a
   compact canonical backend JSON object. Start from this shape and set the
   model and policy metadata separately for each tier:

   ```json
   {
     "id": "pr-agent",
     "label": "PR-Agent",
     "kind": "external",
     "model": "replace-with-model-id",
     "costTier": "low",
     "qualityTier": "standard",
     "capabilities": ["review", "conversation-comments"],
     "reviewAuthors": ["github-actions[bot]"],
     "checkNames": [],
     "findingChannels": ["conversation-comment"],
     "supportsRerequest": true,
     "limitations": ["Inline comments depend on adapter configuration"]
   }
   ```

   The adapter requires `id` to be `pr-agent` and `model` to be nonempty.
   `costTier` and `qualityTier` are declared policy metadata; make them match
   the selected model. The complete supported shapes are demonstrated in
   [`fixtures/protocol/v1/supporting.valid.json`](fixtures/protocol/v1/supporting.valid.json).
6. Publish [`config/routed-review-setup-v1.json`](config/routed-review-setup-v1.json)
   with the workflow and replace its action-reference placeholder with the
   same full commit SHA.

Each manual dispatch also exposes two repository-policy controls:

- Leave `rerequest-authorized` off for an initial request or replay. Turn it on
  only when the canonical request has `attempt` greater than one, references
  the prior receipt and logical dispatch ID, keeps the same policy, route, and
  backend, and the selected backend declares `supportsRerequest: true`.
- Set `independent-review-floor` to the minimum route required by repository
  policy (`none`, `cheap`, `deep`, or `copilot`). The default `none` adds no
  floor. A stronger floor prevents local evidence or bookkeeping-only policy
  from reducing the route below that tier.

The durable workflow performs `route → PR-Agent → acknowledge → finalize`.
PR-Agent runs only for a newly authorized external dispatch. The workflow
turns the step outcome into a bounded canonical acknowledgment and finalizes
the same receipt even after failure; it never dispatches a fallback reviewer.

## Optional PR-Agent configuration

PR-Agent can read a repository-root `.pr_agent.toml`. Use it for review
behavior that is not already fixed at the workflow boundary. Keep these
workflow-owned safety settings unchanged unless the integration is reviewed:

- `CONFIG__MODEL` comes from the selected router tier.
- `CONFIG__FALLBACK_MODELS` remains an empty list to prevent an unplanned
  provider or model change.
- `CONFIG__RESTRICTED_MODE` remains `true`.

See PR-Agent's
[automation and configuration guide](https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/docs/docs/usage-guide/automations_and_usage.md).

PR-Agent v0.39.0 is MIT-licensed and described upstream as
community-maintained legacy software. Review its maintenance fit independently.
The supplied workflow uses the released CLI image by digest instead of the
upstream GitHub Action, whose Dockerfile inherits a floating image tag.

## Verify the installation

1. Open a same-repository smoke pull request with a routine change.
2. Apply `review:cheap` or post `/review cheap` as an authorized user.
3. Confirm the workflow summary selects `cheap` and the configured model.
4. Confirm PR-Agent publishes a conversation comment as
   `github-actions[bot]`.
5. Repeat with `review:deep` and confirm the deep model is selected.
6. Exercise a `copilot` route separately if the installation will use native
   escalation.
7. For durable mode, query the exact-head receipt and confirm it is finalized
   as observed or failed rather than left in a dispatching state.

## Uninstall or roll back

For an installer-managed event workflow, use the guarded uninstall command in
the [automated lifecycle section](#automated-event-driven-lifecycle). For a
manual event-driven or durable installation, disable or remove the installed
workflow, then remove `PR_AGENT_MODEL_API_KEY`, `PR_AGENT_MODEL_PROVIDER`, and
the backend/model variables if nothing else uses them. Existing PR-Agent
comments and durable Check Run receipts remain as historical GitHub records.
