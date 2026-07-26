# Control cheap review reasoning effort

## Goal

Define provider-neutral reasoning controls for cheap reviews when the selected model supports them.

## Background

The current Qwen3-Coder 30B A3B Instruct cheap model is non-thinking, so a
reasoning-effort setting would currently be unsupported or ineffective. Other
future models may expose reasoning controls with material cost impact.

## Requirements

- Research the pinned PR-Agent/LiteLLM path for detecting and forwarding model
  reasoning controls rather than assuming a shared parameter shape.
- Define a bounded provider-neutral policy only if capability detection can
  prove support; unsupported models must omit the setting or fail clear
  validation rather than accepting a no-op.
- Store the supported reasoning policy with the candidate in the pinned private
  catalog. The repository source selects candidate aliases and does not expose
  raw provider reasoning parameters.
- Keep the cheap default at the lowest reviewed effective setting and require
  explicit policy to raise it.
- Record the configured and actual reasoning mode in bounded adapter evidence
  when the provider exposes it.
- Do not conflate this setting with GitHub Copilot's repository-level review
  effort.

## Acceptance Criteria

- [ ] The current Qwen cheap configuration remains unchanged unless evidence
      shows a supported, effective reasoning control.
- [ ] Capability tests cover supported, unsupported, ignored, and malformed
      reasoning settings.
- [ ] No unsupported setting is silently treated as enforced.
- [ ] Cost/quality evaluation justifies any non-minimal cheap reasoning level.
- [ ] Documentation separates provider reasoning, PR-Agent configuration, and
      GitHub Copilot review effort.

## Dependencies

- `07-25-define-review-candidate-catalog` — a supported reasoning policy is
  stored with the candidate in the pinned private catalog.
- `07-25-integrate-pr-agent-review-adapter` — capability detection, forwarding
  through the pinned PR-Agent/LiteLLM path, and bounded configured-vs-actual
  evidence.

## Out of Scope

- Changing Copilot review effort or deep-model reasoning behavior.

## Notes

- Complex research-first task (review decision 2026-07-25): capability
  discovery, provider-neutral policy translation, and ignored-setting evidence
  require the accompanying `design.md` and `implement.md`. Unsupported models
  still complete with an explicit omit decision rather than a no-op setting.
