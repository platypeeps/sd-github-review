# Validate external reviewer adapters

## Goal

Turn the generic `cheap`/`deep` output contract into validated consumer paths
without moving provider credentials or reviewer runtimes into the router.

## Requirements

- Live-test the documented PR-Agent workflow and record its credential,
  licensing, supply-chain, fork, and finding-surface limits.
- Define a minimal command or HTTP acknowledgment contract for internal review
  services.
- Replace non-runnable placeholder commands in production-oriented examples or
  label them unambiguously as templates.
- Decide, test, and document whether empty cheap/deep model values delegate to
  the adapter default or fail configuration; keep runtime, metadata, examples,
  README, and design aligned.

## Approved Pilot Selection

- Use Kimi K2.6 through the existing OpenRouter adapter mapping, not Gemini or
  a new direct-provider credential shape.
- Set `PR_AGENT_MODEL_PROVIDER=openrouter` and use
  `openrouter/moonshotai/kimi-k2.6` for both `CHEAP_REVIEW_MODEL` and
  `DEEP_REVIEW_MODEL` during the first bounded pilot.
- Store the capped OpenRouter credential only in the consuming repository's
  `PR_AGENT_MODEL_API_KEY` Actions secret. Do not place it in this repository,
  a task artifact, workflow input, summary, receipt, or provider transcript.
- Keep Gemini supported by the generic workflow, but do not use it for this
  pilot or treat it as a fallback.

## Acceptance Criteria

- [ ] The PR-Agent path has contract tests and bounded pilot evidence.
- [ ] Bounded live evidence identifies the OpenRouter provider and Kimi K2.6
  model without recording credentials, raw provider output, or pricing data.
- [ ] The internal adapter contract defines request, acknowledgment, failure,
  timeout, observability, and secret boundaries.
- [ ] Production-oriented examples are executable after documented secret and
  immutable-SHA substitution; skeletons cannot be mistaken for runnable code.
- [ ] Empty-model behavior is asserted at the action boundary and adapter
  boundary.
- [ ] No external adapter executes untrusted PR code with provider secrets.

## Dependency

Coordinate final receipt acknowledgment with
`07-22-implement-routed-review-receipt-runtime`; do not invent a parallel
receipt contract.

Executable PR-Agent support is tracked by child task
`07-23-add-pr-agent-adapter-support`; the credentialed pilot remains in this
parent task.
