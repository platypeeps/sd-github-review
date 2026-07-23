# On-Demand Routed-Review Dispatch Design

## Overview

Extend `src/index.js` with explicit operation staging while keeping the current
event-driven path as the default compatibility mode.

## Proposal

- Add a versioned request input plus an operation enum. `route` validates live
  state, asks `ReceiptStore.begin()`, selects policy, and performs at most one
  native Copilot request or emits one external adapter request.
- `finalize` accepts one bounded adapter acknowledgment, revalidates identity
  and head, and transitions the existing durable receipt to acknowledged or
  failed. It never selects another backend.
- `query` is read-only and returns the canonical durable envelope.
- For same-workflow external adapters, the workflow calls the Action once to
  route, runs the secret-owning adapter step conditionally, then calls the
  Action again to finalize. The adapter receives no router credentials beyond
  documented GitHub/workflow context.
- Publish `config/routed-review-setup-v1.json` (or an equivalently canonical
  path) and a no-checkout `workflow_dispatch`/reusable on-demand example.

## Boundaries And Non-Goals

- Existing event routing remains default and need not enable durable receipts.
- No provider SDK, secret storage, local reviewer invocation, PR checkout, or
  interactive prompt.
- Setup descriptor proves declared capability; the command-pack client owns
  read-only enabled/missing/unavailable classification.

## Affected Files

- `src/index.js`, `action.yml`, and orchestration tests
- setup descriptor and `examples/on-demand-review-router.yml`
- README, DESIGN, release/security guidance
- backend specs for operation/output contracts

## Data And Command Contracts

- `operation=standalone|route|finalize|query` (final naming reviewed against
  Action compatibility).
- `review-request` and `adapter-acknowledgment` are bounded v1 JSON strings.
- Outputs add canonical `receipt`, logical identity, fingerprint, dispatch
  phase/status, backend metadata, finding channels, limitations, and durable
  check URL while retaining current route outputs.
- Any uncertain side effect returns a structured reconciliation-required error
  and the known logical identity.

## Risks And Edge Cases

- A second Action invocation may run on a changed head; finalization must reject
  it without updating the old receipt as current.
- GitHub output size and workflow-command escaping apply to JSON outputs.
- Adapter success without observable finding channels is invalid.
- Explicit `none` may record skipped; `delegated` is never a successful final
  receipt without acknowledgment.

## Validation

- focused operation/orchestration and action-metadata tests;
- workflow fixtures for no-checkout and permission boundaries;
- full repository, install, and review gates.
