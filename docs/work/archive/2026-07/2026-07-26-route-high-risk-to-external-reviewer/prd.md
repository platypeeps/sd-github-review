---
title: Route high-risk reviews to external reviewer
status: done
created: 2026-07-26
branch: codex/route-high-risk-to-external-reviewer
---
# Route high-risk reviews to external reviewer

## Goal

Make automatic routing able to send sensitive-path and large-change reviews to
the external `deep` lane. The shipped PR-Agent profiles must use that behavior
so PR-Agent can replace Copilot for high-risk automatic reviews, while the
generic action remains compatible with Copilot-oriented consumers.

## Background

Automatic routing currently selects `cheap` for routine changes, `deep` for
low-confidence escalation, and `copilot` for sensitive paths or changes at the
configured line threshold. That last choice prevents the PR-Agent workflow from
handling high-risk automatic reviews because only `cheap` and `deep` produce an
external-adapter dispatch.

The repository already exposes explicit `copilot` selection through the action
mode, labels, commands, and durable requests. This task changes only the target
used by the two automatic high-risk rules.

## Requirements

- Add one validated action input, `high-risk-route`, whose allowed values are
  `deep` and `copilot` and whose generic default is `copilot`.
- Use the selected high-risk route for both sensitive-path matches and the
  changed-line threshold. Keep the current routing precedence: explicit routes,
  disabled drafts, high-risk rules, low-confidence escalation, then `cheap`.
- Apply the setting consistently in standalone routing and durable `route`
  operations, including the durable risk floor that prevents local evidence or
  bookkeeping evidence from bypassing high-risk policy.
- Configure both shipped PR-Agent workflows with `high-risk-route: deep` so a
  high-risk automatic decision emits an external PR-Agent dispatch instead of
  requesting Copilot.
- Keep generic and Copilot-oriented workflows on the default `copilot` behavior
  unless they opt in to `deep`.
- Preserve manual `copilot` selection through `mode: copilot`,
  `review:copilot`, `/review copilot`, and explicit durable requests.
- Do not add a provider, model, secret, repository variable, label, permission,
  backend kind, or manifest configuration field for this choice. The existing
  deep backend/model configuration remains authoritative.
- Document the generic default and the PR-Agent profile override without
  describing PR-Agent as a silent fallback for an unavailable Copilot request.

## Acceptance Criteria

- [x] `action.yml` declares `high-risk-route` with the allowed behavior and a
  `copilot` default.
- [x] Sensitive and threshold-bound automatic routes select the configured
  high-risk target in standalone and durable modes.
- [x] A standalone high-risk `deep` decision sets
  `run-external-reviewer=true`, emits the deep model, and does not request a
  Copilot reviewer.
- [x] A durable high-risk `deep` decision selects the configured external deep
  backend and emits one authorized adapter request under the existing receipt
  contract.
- [x] Eligible local or bookkeeping evidence cannot lower a durable high-risk
  decision below the configured high-risk target.
- [x] Explicit Copilot routes are unaffected by `high-risk-route: deep`.
- [x] Both PR-Agent workflow examples pass `high-risk-route: deep`; generic and
  Copilot workflow examples retain Copilot high-risk behavior.
- [x] Installer tests prove installed PR-Agent workflows receive the managed
  profile and updates behave according to the decision below.
- [x] Router, standalone action, durable operation/protocol, workflow metadata,
  installer, and documentation regressions pass.

## Out of Scope

- Multi-provider fallback chains, budget-aware degradation, or parallel review
  candidates.
- Changing the cheap/deep model catalog or provider credentials.
- Replacing an explicitly requested Copilot review.
- Expanding the v2 configuration compiler or adding a new consumer-managed
  repository variable solely for this route.

## Product Decision

- The consumer installer's `update` command automatically replaces the managed
  workflow with the new `deep` high-risk PR-Agent profile. This is an
  intentional managed-template behavior change: existing provider and model
  values remain intact, while subsequent automatic high-risk reviews use the
  already configured deep backend. Consumers that need the old hybrid behavior
  can use the generic action profile or override the action input to `copilot`.

## Notes

- Parent task: `07-25-support-standalone-review-mode`.
- The route selection belongs in the router; dispatch remains owned by the
  existing standalone and durable adapter paths.
