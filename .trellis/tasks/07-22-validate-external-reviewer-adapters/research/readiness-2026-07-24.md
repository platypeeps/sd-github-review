# External Adapter Pilot Readiness Snapshot

Recorded 2026-07-24 from read-only GitHub queries. This snapshot intentionally
contains no secret values, raw findings, source content, paths, prompts,
transcripts, or pricing.

## Source

- Candidate: `694f53f5df937b07e7ab7ae037e862a9bb84b1b1`
- Source CI: successful run
  `https://github.com/platypeeps/sd-github-review/actions/runs/30138887176`

## Private Pilot

- Repository: `platypeeps/sd-github-review-pilot` (private)
- Default branch: `main`
- Open smoke PRs: #1 and #3
- Active default-branch workflows: provider-free event router, provider-free
  durable router, and GitHub Copilot
- Recent listed pilot workflow runs: completed successfully
- Actions variables: `PR_AGENT_MODEL_PROVIDER=openrouter` and both routed model
  variables select `openrouter/moonshotai/kimi-k2.6`
- Actions secret names: `PR_AGENT_MODEL_API_KEY` is present; its value was not
  read

## Readiness Disposition

The existing pilot proves provider-free routing and durable behavior, but it is
not ready for the credentialed PR-Agent scenario. The event workflow is pinned
to the v0.1.0 commit and emits synthetic `pilot-cheap`/`pilot-deep` models. It
must not remain active alongside the event-driven PR-Agent workflow because
both consume the same event family.

At the initial snapshot, credentialed execution was blocked until the
maintainer provisioned a capped OpenRouter key directly as
`PR_AGENT_MODEL_API_KEY` and approved the private workflow transition. That
gate was later satisfied by forwarding an existing local environment value
directly over stdin; only the GitHub secret name and presence were verified.
No credential was supplied through chat or recorded in this task.

## First Credentialed Attempt

- Pilot PR: #5 at `4183397c8687a1257d9c93e6696a9faa52810296`
- Workflow run: `https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30140882582`
- Route/configuration: cheap, OpenRouter, Kimi K2.6; preflight succeeded and the
  provider secret was masked.
- Result: failed before provider execution or finding publication because the
  GitHub Docker Action runner changed the CLI image working directory and its
  relative entrypoint could not start.
- Disposition: pilot PR closed, no retry or fallback attempted, and source
  remediation required. Raw logs and provider output are not recorded here.
