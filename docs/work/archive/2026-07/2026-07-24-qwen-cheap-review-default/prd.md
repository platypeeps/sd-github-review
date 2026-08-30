---
title: Use Qwen3 Coder for cheap reviews
status: done
created: 2026-07-24
---
# Use Qwen3 Coder for cheap reviews

## Goal

Reduce the cost of routine PR-Agent reviews by making Qwen3-Coder 30B A3B
Instruct the default `cheap` model while retaining Kimi K2.6 for the `deep`
path.

## Background

- The installer currently defaults both PR-Agent tiers to OpenRouter-hosted
  Kimi K2.6.
- The supported workflow accepts OpenRouter model IDs in the
  `openrouter/<publisher>/<model>` form, so the recommended Qwen model fits the
  existing provider and credential contract.
- Existing managed consumers preserve the model values recorded in their
  manifest when `update` omits model overrides. A new default must not silently
  migrate those consumers.
- The private pilot is already provisioned with separate event-driven and
  durable cheap-model variables and can be updated without changing its
  provider secret.

## Requirements

- Set the installer default cheap model to
  `openrouter/qwen/qwen3-coder-30b-a3b-instruct`.
- Keep the default provider as `openrouter` and the default deep model as
  `openrouter/moonshotai/kimi-k2.6`.
- Update installation and PR-Agent setup documentation so the default tier
  pairing is explicit and the Kimi section no longer claims both tiers use
  Kimi.
- Add regression coverage that directly asserts the installer-created default
  provider and model variables.
- Update the private pilot's `CHEAP_REVIEW_MODEL` and
  `SD_REVIEW_CHEAP_BACKEND_V1.model` values to the Qwen model while preserving
  the remaining backend descriptor fields.
- Do not read, replace, or otherwise modify `PR_AGENT_MODEL_API_KEY`.
- Preserve existing consumer-update semantics: omitted model flags retain the
  consumer manifest's current values.

## Acceptance Criteria

- [x] A fresh installer run provisions OpenRouter with Qwen3-Coder 30B A3B for
      `cheap` and Kimi K2.6 for `deep`.
- [x] Installer tests fail if either default model regresses and the relevant
      test suite passes with the new pairing.
- [x] README and PR-Agent setup guidance describe the same default pairing and
      exact model IDs.
- [x] The private pilot reports the Qwen cheap model in both event-driven and
      durable configuration, while both deep-model variables remain Kimi K2.6.
- [x] The private pilot's provider remains OpenRouter and the existing generic
      provider secret remains present.
- [x] Repository validation passes without changing routing policy, fallback
      behavior, provider allowlists, or Copilot handling.

## Out of Scope

- Automatically migrating other installed consumers.
- Changing the deep-review model, PR-Agent prompt, provider, secret shape, or
  routing thresholds.
- Publishing a release or merging a pull request.
