# Route High-Risk Reviews to External Reviewer Design

## Overview

Introduce a narrow routing-policy input that controls the target of the two
automatic high-risk rules. The generic action defaults to `copilot`; PR-Agent
workflow profiles explicitly select `deep`. The route remains a policy choice,
not a provider fallback: once the router selects `deep`, the existing external
reviewer path resolves and dispatches the configured deep model.

This design preserves the current routing precedence and dispatch boundaries.
It changes neither the canonical request/receipt schemas nor the backend
descriptor format.

## Decisions and Invariants

- `high-risk-route` accepts only `deep` or `copilot` and defaults to `copilot`.
- Sensitive-path matches and changed-line threshold matches use the same
  configured target.
- Explicit modes always win, including explicit `copilot` selections.
- Draft suppression still runs before automatic risk routing.
- Low-confidence escalation remains independent and continues to use
  `low-confidence-route`.
- Standalone and durable routing share the same pure `routeReview` decision.
- Durable local/successor evidence cannot reduce a high-risk decision below the
  configured high-risk route.
- A PR-Agent managed update adopts the new workflow profile automatically but
  preserves existing provider and cheap/deep model configuration.
- `deep` means “use the configured deep backend.” It does not imply PR-Agent at
  the generic action boundary and is not a retry after Copilot failure.

## Input Contract

Add this action input:

```yaml
high-risk-route:
  description: Route used for sensitive paths and changes at the line threshold. One of deep or copilot.
  required: false
  default: copilot
```

Create one shared pure validator for escalation-route inputs and use it for
both `low-confidence-route` and `high-risk-route`. Invalid values fail before a
review dispatch or reviewer request.

No repository variable is added. A workflow selects its profile directly:

```yaml
with:
  high-risk-route: deep
```

## Routing Flow

`routeReview` receives the normalized `highRiskRoute` and returns it for either
high-risk condition:

1. Resolve ignored events and explicit configured/command/label routes.
2. Suppress disabled draft reviews.
3. If a sensitive path matched, select `highRiskRoute`.
4. If changed lines meet the threshold, select `highRiskRoute`.
5. If prior confidence is low, select `lowConfidenceRoute`.
6. Otherwise select `cheap`.

The existing human-readable risk reasons remain reviewer-neutral. The selected
`route` output identifies the handler.

## Standalone Dispatch

`src/index.js` normalizes `high-risk-route` and passes it to `routeReview`.
Existing output logic then provides the required behavior without a new
dispatch branch:

- `deep` emits the configured `deep-model`, sets
  `run-external-reviewer=true`, and does not call the Copilot reviewer API.
- `copilot` follows the existing idempotent Copilot-request path and sets
  `run-external-reviewer=false`.

## Durable Dispatch and Policy Floor

`src/operations.js` normalizes the input and adds `highRiskRoute` to the
ephemeral routing context passed to `selectProtocolRoute`.

`selectProtocolRoute` defaults the context value to `copilot` for direct and
older callers, validates it, passes it to `routeReview`, and uses it as the
risk floor when a sensitive path or changed-line threshold matches. The final
existing floor calculation remains:

```text
effective floor = stronger(independent review floor, configured high-risk route)
```

Thus eligible local or bookkeeping evidence may lower a preliminary route but
the final result cannot be weaker than the selected high-risk policy. An
explicit request route continues to bypass automatic policy evaluation as it
does today.

No protocol schema change is required. The receipt already records the selected
route, backend, policy version, routing reason, and dispatch evidence; the pure
decision exposes structured floor application to its caller.

## Workflow and Installer Behavior

Both first-party PR-Agent examples pass `high-risk-route: deep`:

- `examples/pr-agent-router.yml`
- `examples/pr-agent-on-demand-review-router.yml`

Generic and Copilot-oriented examples omit the input and retain the action's
`copilot` default.

The consumer installer already owns and copies the event-driven PR-Agent
workflow exactly. Therefore:

- new installs receive the deep high-risk profile;
- `update` detects the template digest change and replaces the managed workflow;
- existing provider, cheap model, and deep model settings remain unchanged;
- unmanaged workflow collisions and drift protections remain unchanged;
- uninstall behavior and manifest schema remain unchanged.

The durable on-demand example remains a manual setup artifact and receives the
same explicit profile for behavioral parity.

## Documentation

Update action metadata, README routing summaries, `DESIGN.md`, and
`SETUP-PR-AGENT.md` to distinguish:

- generic default: high risk selects Copilot;
- shipped PR-Agent profile: high risk selects external `deep`;
- manual Copilot selection remains supported;
- model/provider choice remains the existing deep-lane configuration.

Remove statements that describe high-risk routing as unconditionally Copilot-
owned.

## Validation

- Pure router tests cover sensitive and threshold selection for both allowed
  targets, plus the exact threshold boundary.
- Input tests reject values other than `deep` and `copilot`.
- Standalone tests prove deep model/output selection and absence of Copilot API
  calls for high-risk PR-Agent behavior.
- Protocol tests prove the configurable durable risk floor cannot be bypassed
  and can still be strengthened by `independent-review-floor`.
- Durable operation tests prove selection of the external deep backend and one
  adapter request without leaking sensitive paths.
- Metadata tests prove both PR-Agent workflows opt into `deep` and generic
  examples do not.
- Installer tests prove install/update copy the managed profile while preserving
  provider/model settings.
- Full repository tests, checks, and metadata validation must pass.

## Compatibility and Rollback

The action-level default preserves current behavior for generic consumers. The
managed PR-Agent workflow update is intentionally behavior-changing and
requires no migration flag.

Rollback is explicit and local: set `high-risk-route: copilot` in the workflow
or use a generic/Copilot profile. Reinstalling an older managed template is not
part of the supported rollback contract because a subsequent managed update
would restore the current profile.

## Out of Scope

- Dispatch retries or automatic failover between Copilot and an external model.
- Provider/model/budget fallback chains and parallel reviewers.
- Dynamic selection of different high-risk targets for sensitive and large
  changes.
- New secrets, GitHub variables, labels, commands, permissions, or receipt
  fields.
