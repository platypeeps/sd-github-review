# Consumer Review Control Plane Contract Design

## Deployment Boundary

This repository owns only schemas, a conformance fake, and the handoff. The
consumer-owned private implementation holds management credentials, provider
billing adapters, the catalog, ledger, and deferred records.

The selected private destination is `platypeeps/sd-review-control-plane`.
`@platypeeps/infrastructure` is accountable for deployment and operation;
`@platypeeps/security` reviews authentication, secret, tenant, and destructive-
operation boundaries. The implementation is one service backed by PostgreSQL,
with scheduled reconciliation, recovery, and retention workers in the same
deployment unless measured scaling requires a later split. Provider secrets
live in the deployment platform's secret manager and the catalog stores only
opaque references.

## Delivery Decomposition

| Child task | Delivery boundary |
| --- | --- |
| `07-25-define-review-candidate-catalog` | Immutable candidates, prompt-profile metadata/bindings, policy bindings, and safe projection |
| `07-25-define-review-budget-ledger` | Observations, shared pools, leases, and atomic reservation |
| `07-25-define-review-usage-reconciliation` | Actual usage/cost, reserve release, overruns, and unknowns |
| `07-25-define-deferred-review-recovery` | Pending records, exact-head recovery, authorization, retention, and deletion |
| `07-25-define-finding-adjudication-evidence-store` | Append-only trusted adjudication events, conflict/correction history, bounded queries, and retention coverage |
| `07-25-define-review-data-retention-policy` | Versioned `standard-v1` classes, lifecycle, holds, purge, backup, transfer, deletion, and coverage |

```text
trusted workflow -> bounded request -> private service -> provider/billing APIs
                       ^                  |
                       +-- bounded signed/fingerprinted response
```

## Data Domains

- Catalog: immutable version/digest and candidate policy bindings.
- Observation: value, unit, source, observed-at, freshness deadline, confidence.
- Reservation: idempotency key, request-preflight fingerprint, explicit units,
  maximum expected charge, hard request limit, pool, lease, and authorization.
- Reconciliation: full actual usage/cost or explicit unknown, soft/hard outcome,
  released reserve, overdrawn state, and candidate-quarantine signal.
- Quarantine: candidate, triggering authorization/reconciliation, reason,
  policy digest, state, actor-bound audited clearance, and remediation evidence.
- Deferral: opaque pending ID, exact-head identity, policy outcome, retention.
- Adjudication: stable finding/event identity, actor authorization, trust,
  correction/conflict chain, bounded query, and retention coverage.
- Retention: immutable policy ID/version/digest, data class, lifecycle,
  retained-until, hold, purge/deletion, backup expiry, and coverage state.

Catalog projections expose only fields required for compilation and dispatch.
Credential bindings may be represented by opaque aliases but secret values and
management endpoints never leave the service boundary.

## Consistency And Failure

The ledger serializes reservations for pools it owns. Provider balances are
observations, not transactionally locked truth. Stale/unknown state fails
closed according to lane policy. A timeout before authorization permits an
idempotent retry; uncertainty after authorization requires reconciliation and
must not select another candidate.

The ledger debits full authoritative usage rather than clamping to a reserve.
Soft overruns may preserve content success. Hard request-limit violations
quarantine the candidate; negative pool capacity becomes `overdrawn`. Verified
pool recovery does not clear candidate quarantine without an explicit audited
operator decision.

Control-plane absence is handled only by explicit standalone configuration,
which does not call this service and does not claim its capabilities. Once a
consumer activates managed mode, service timeout, authentication failure,
schema mismatch, or stale state fails closed before dispatch. Runtime health
never downgrades managed mode to standalone.

## Handoff Gate

Service implementation starts only in the selected private repository after
Infrastructure records the deployment boundary, workload authentication,
PostgreSQL deployment, and secret store; Security approves the boundary; and
the implementation accepts `standard-v1` plus the published conformance suite.
