# Add consumer installation lifecycle tool

## Goal

Let an operator install, update, verify, and uninstall the supported
event-driven PR-Agent integration in another GitHub repository without
manually copying workflows or reconciling repository settings.

## Background

The supported manual path currently copies `examples/pr-agent-router.yml`,
creates five routing labels, configures three Actions variables, and stores one
provider key as `PR_AGENT_MODEL_API_KEY`. The archived
`07-22-evaluate-adoption-setup-automation` task correctly recorded a no-build
decision under its three-consumer evidence gate. This explicit implementation
request supersedes that product threshold without rewriting the archived
decision or its evidence.

The first lifecycle tool targets the current event-driven PR-Agent setup. The
default configuration is the approved Kimi K2.6 pilot through OpenRouter:

- `PR_AGENT_MODEL_PROVIDER=openrouter`
- `CHEAP_REVIEW_MODEL=openrouter/moonshotai/kimi-k2.6`
- `DEEP_REVIEW_MODEL=openrouter/moonshotai/kimi-k2.6`

## Requirements

### R1: Commands and scope

- Provide one dependency-free Node CLI with `install`, `update`, `check`, and
  `uninstall` commands.
- Accept a local target checkout, infer its GitHub repository from `origin`,
  and allow an explicit matching `OWNER/REPO` override.
- Support the single-key PR-Agent providers already accepted by the checked-in
  workflow and validate each configured model at the CLI boundary.
- Install only the event-driven PR-Agent workflow in this iteration. Durable
  on-demand setup, Copilot account/ruleset configuration, branch protection,
  commits, pushes, and pull requests are out of scope.

### R2: Idempotent managed files

- Copy `examples/pr-agent-router.yml` to the consumer's GitHub workflows file
  named ai-review-router.yml without modifying the reviewed workflow content.
- Write a consumer-side sd-github-review.json ownership and configuration
  manifest under its GitHub metadata directory. It must contain hashes,
  configuration, remote ownership, and a lifecycle state, but no secret value.
- Re-running `install` with the same configuration or `update` after a partial
  failure must converge safely.
- Refuse to overwrite a different unmanaged workflow or a managed workflow
  whose content no longer matches its recorded hash.
- Write local files atomically and retain a recoverable pending manifest when
  a GitHub mutation fails.

### R3: GitHub resources and secrets

- Reconcile `PR_AGENT_MODEL_PROVIDER`, `CHEAP_REVIEW_MODEL`, and
  `DEEP_REVIEW_MODEL` through the GitHub CLI.
- Create missing routing labels and preserve existing labels.
- Detect `PR_AGENT_MODEL_API_KEY` by name only. Never read, print, serialize,
  or accept the provider key as a command-line argument.
- Allow an explicitly requested interactive secret prompt or secret content
  forwarded from standard input. Preserve an existing secret unless the
  operator explicitly requests replacement.
- Refuse to replace a conflicting pre-existing variable that the installer
  does not own.

### R4: Check and uninstall safety

- `check` must be read-only, compare local hashes and current source template,
  inspect bounded GitHub configuration, and return nonzero for drift.
- `uninstall` must require confirmation or `--yes`, record an uninstalling
  state before remote mutations, remove only installer-owned variables, and
  then remove the managed workflow and manifest.
- Preserve secrets and labels by default. Explicit removal flags may delete
  the configured secret and installer-created labels; they must not delete
  pre-existing labels.
- Support `--dry-run` for every mutating command and make the proposed actions
  visible without printing credentials.

### R5: Operator experience and documentation

- Produce concise, actionable stdout/stderr and optional machine-readable JSON
  without leaking credentials or full environment state.
- Document prerequisites, examples for all commands, ownership behavior,
  recovery from partial failure, and the remaining manual Copilot/branch
  protection steps in `README.md` and `SETUP-PR-AGENT.md`.

## Acceptance Criteria

- [x] A temporary Git repository with a GitHub origin can be planned and
  installed with the expected workflow and secret-free manifest.
- [x] A second identical install and an update are idempotent; a changed source
  template is detected by `check` and refreshed by `update`.
- [x] Conflicting unmanaged workflows, modified managed workflows, unsupported
  providers/models, repository mismatches, and unowned variable conflicts fail
  closed with recovery guidance.
- [x] Partial GitHub failure leaves enough manifest state for a safe retry.
- [x] Secret values are accepted only by inherited prompt or stdin and never
  appear in plans, manifests, JSON output, or error messages.
- [x] `check` reports local and remote drift without mutation.
- [x] Confirmed uninstall removes managed files and owned variables while
  preserving secrets and labels by default; opt-in label cleanup removes only
  installer-created labels.
- [x] Unit tests cover lifecycle convergence, ownership preservation, drift,
  partial failure recovery, dry-run, and secret redaction.
- [x] `npm test`, `npm run check`, `npm run validate:metadata`, and
  `git diff --check` pass.

## Out of Scope

- Durable on-demand workflow provisioning.
- Enabling GitHub Copilot, choosing Copilot's model, or changing Copilot effort.
- Installing the PR-Agent GitHub App.
- Managing branch protection, required checks, organization policy, commits,
  pushes, or pull requests in a consumer repository.
- Multi-key, cloud-identity, custom-endpoint, or local-runtime PR-Agent
  providers.
