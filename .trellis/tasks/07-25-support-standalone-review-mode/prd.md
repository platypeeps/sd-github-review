# PARKED: Support standalone review mode

## Goal

Keep the existing cheap, deep, and direct-Copilot review experience usable for
consumers that do not operate a private control plane, without pretending that
budget, catalog, adjudication, or other shared-state guarantees exist.

## Background

The managed v2 design requires a private control plane for candidate catalogs,
authorization, shared budgets, deferred recovery, adjudication, and retention.
Making that service mandatory would prevent smaller consumers from using the
core router. Silently bypassing it during an outage would be worse: it could
dispatch an unauthorized or over-budget reviewer.

Version 2 therefore has two explicit modes, never an inferred `auto` mode:

- `standalone`: no control plane is configured or contacted.
- `managed`: the configured control plane is an authorization dependency and
  an outage never downgrades the attempt to standalone.

## Requirements

- Define a discriminated v2 source, compiled, receipt, status, and setup-
  discovery contract with explicit `standalone` and `managed` modes. Reject a
  missing or unknown mode; never infer one from credential or endpoint state.
- In standalone mode, preserve deterministic risk routing, broad cheap/deep/
  Copilot labels, exact lane commands, one explicit route execution kind per
  lane, exact-head execution, bounded acknowledgments, stable assurance/gate
  Checks, and consumer install/update/check/uninstall behavior. A
  `direct-handler` lane names one fixed profile; a `local-attested` lane names
  one explicit trust policy and dispatches no reviewer.
- Keep standalone source free of provider-management credentials and private
  catalog contents. Direct-handler routes may reference setup-discovered fixed
  profiles; local-attested routes may reference only explicit actor/
  association, PR-author, and evidence-age policy. Adapter-owned repository
  variables/secrets continue to supply direct reviewer configuration.
- Do not expose candidate aliases, ordered candidate chains, cross-model
  fallback, shared or repository budgets, reservation/reconciliation, budget-
  aware deferral/recovery, candidate quarantine, centralized price/data/region
  policy, parallel reviewer plans, trusted adjudication storage, retention
  operations, or effectiveness claims in standalone mode.
- Represent unavailable managed capabilities as `unsupported_in_standalone` or
  `control_plane_not_configured`, never as zero budget, zero cost, success, or
  an empty authoritative result.
- Emit `mode=standalone`, execution kind, direct handler/profile or local-
  attestation provenance, known limitations, and
  `budgetOutcome=not_managed` in bounded receipts, checks, status, explain, and
  setup discovery. Preserve actual provider/model only when reliably
  acknowledged; local usage remains explicitly self-reported.
- Preserve `sd-review / assurance` and `sd-review / gate` names for branch-
  protection continuity. Derive both from the direct fixed review or a valid
  repository-trusted exact-head local attestation. Standalone never emits
  `deferred_budget`, budget-based merge allowance, pending recovery, or a claim
  of managed budget/gate authority. Missing local evidence blocks.
- Keep `/review options` side-effect free. In standalone mode it may list lanes
  and fixed handler profiles but must not advertise candidate, budget, pending,
  recovery, quarantine, adjudication, or parallel-plan operations.
- When a valid managed configuration exists but the control plane is
  unavailable, fail closed before dispatch. Do not reuse standalone profiles,
  cached availability, stale authorization, or a prior candidate decision.
- Permit an operator to migrate deliberately between modes through a reviewed
  configuration change and semantic diff. Migration to standalone must list
  every lost capability and preserve historical managed receipts and private
  evidence without attempting to delete or reinterpret them.
- Keep managed-only configuration fields invalid in standalone mode and
  standalone handler-profile fields invalid in managed mode.

## Acceptance Criteria

- [ ] Fresh standalone install, v1-to-standalone migration, update, check,
      reapply, rollback, and uninstall fixtures run without a control-plane
      endpoint or credential.
- [ ] Standalone cheap, deep, and direct-Copilot fixtures dispatch exactly one
      fixed configured handler for direct routes; all-local and mixed fixtures
      prove local-attested routes dispatch none and produce exact-head bounded
      evidence.
- [ ] Standalone Check fixtures use the stable names, pass only after the direct
      review or authorized exact-head clean local attestation satisfies
      assurance, block on failure/missing local evidence, and never produce a
      budget-deferred gate pass.
- [ ] Managed configuration with an absent, unreachable, stale, or mismatched
      control plane fails before reviewer side effects and never switches modes.
- [ ] Schema/compiler fixtures reject missing mode, mixed-mode fields, inferred
      mode, candidate overrides, chains, budgets, and parallel slots in
      standalone configuration.
- [ ] Status and command fixtures distinguish `not_managed`, unavailable, and
      unknown from numeric zero and successful authoritative evidence.
- [ ] Mode migration produces a deterministic semantic diff naming unavailable
      capabilities and never rewrites historical receipts or private records.
- [ ] Documentation gives consumers a concise capability matrix and clearly
      distinguishes control-plane absence from a managed-service outage.

## Dependencies

- `07-25-define-budget-review-v2-contracts` for the mode discriminator and
  capability/status schemas.
- `07-25-compile-routed-review-configuration` for pure mode-specific
  compilation and mixed-mode rejection.
- Existing fixed Copilot and PR-Agent adapter profiles and setup discovery.

## Child Tasks

- `07-26-route-high-risk-to-external-reviewer` delivers the standalone routing
  increment that lets high-risk changes use the configured deep external
  reviewer while retaining direct Copilot as an explicit route.

## Out of Scope

- Local emulation of shared budgets, a private catalog, or trusted
  adjudication.
- Runtime failover from managed to standalone.
- Parallel standalone dispatch before a separate policy and cost design is
  approved.
- Managed/parallel local-attested child slots in the MVP.
