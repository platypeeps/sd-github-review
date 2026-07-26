# Define the consumer review control plane

## Goal

Specify and track the private candidate catalog, budget ledger, reservation,
reconciliation, deferral, recovery, adjudication, and data-retention dependency.

## Background

The authoritative service does not belong in this public repository. Its
selected implementation destination is the private
`platypeeps/sd-review-control-plane` repository, with
`@platypeeps/infrastructure` accountable for operation and
`@platypeeps/security` required for security-boundary review. This local task
owns the provider-neutral contract, conformance evidence, and implementation
handoff; it does not pretend the service is implemented here. Catalog, ledger,
reconciliation, deferred recovery, adjudication evidence, and retention are
separate child contracts and future implementation slices.

## Requirements

- Define a pinned, immutable candidate catalog with stable aliases, handler and
  model target, credential/policy/budget bindings, capability, reserve, price,
  data, prompt, reasoning, token/counting units, hard request limits, required
  usage/finish-reason evidence, and same-model endpoint-failover policy.
- Define immutable prompt-profile metadata entries with stable alias, version,
  digest, and handler/capability compatibility. Require each external candidate
  to reference one entry and native candidates to declare handler-managed
  prompting. Do not store adapter-registry values, profile bodies, or rendered
  prompts in the control plane.
- Expose only a bounded safe catalog projection to the public compiler; keep
  secrets, raw billing responses, and management endpoints private.
- Define idempotent `observe`, `reserve`, `reconcile`, `release`, `defer`,
  `recover`, `quarantine`, and `clear_quarantine` semantics bound to tenant,
  repository, PR, head, attempt, candidate, actor, reason, and compiled
  configuration fingerprint as applicable.
- Make shared-pool reservation atomic inside the authoritative ledger, apply
  observation freshness and safety margins, and never claim transactional
  control over independent provider billing systems.
- Accept only digest-bound side-effect-free preflight facts, reserve a
  conservative maximum expected charge within the hard request limit, and
  reject unknown token/count/price/unit/capability evidence.
- Preserve unknown usage/cost as unknown, debit full authoritative actual usage,
  distinguish soft `budget_overrun` from hard `policy_violation`, quarantine
  hard-violating candidates, block `overdrawn` pools, and release only capacity
  proven unused.
- Store bounded deferred-review records with retention, tenant isolation,
  authorization, audit, deletion, repository transfer/removal, and exact-head
  recovery rules.
- Store trusted finding adjudication as append-only, actor-authorized events
  with correction/conflict history, bounded queries, retention, deletion, and
  explicit coverage effects through child
  `07-25-define-finding-adjudication-evidence-store`.
- Enforce the versioned `standard-v1` policy from child
  `07-25-define-review-data-retention-policy`, including prohibited-content
  persistence, 180-day deferred maximum, class-specific compaction/deletion,
  legal holds, transfer/removal, purge, backup expiry, and coverage reporting.
- Provide a deterministic in-memory conformance fake in this repository.
- Keep the control plane optional at the product boundary through explicit
  standalone mode. Absence by configuration is healthy; an outage in explicit
  managed mode never authorizes unmanaged dispatch.
- Before implementation starts, confirm the deployment/security boundary,
  workload authentication, PostgreSQL deployment, and secret-management path
  in the selected private repository.

## Child Deliverables

- `07-25-define-review-candidate-catalog` owns immutable candidate, prompt,
  capability, and safe-projection contracts.
- `07-25-define-review-budget-ledger` owns authoritative observations, pools,
  leases, and atomic reservations.
- `07-25-define-review-usage-reconciliation` owns actual usage, cost,
  release, overrun, and unknown-usage semantics.
- `07-25-define-deferred-review-recovery` owns deferred lifecycle and
  exact-head recovery.
- `07-25-define-finding-adjudication-evidence-store` owns append-only trusted
  adjudication persistence and conformance.
- `07-25-define-review-data-retention-policy` owns retention, purge, legal
  hold, transfer, and coverage contracts.

## Acceptance Criteria

- [ ] Versioned catalog and operation schemas have valid, invalid, stale,
      replay, concurrent, and shared-pool conformance fixtures.
- [ ] Catalog fixtures cover shared and candidate-specific prompt profiles,
      native handler-managed prompting, digest mismatch, and rejection of
      defaults, inheritance, and overrides.
- [ ] The public compiler receives only the exact digest-matched safe projection
      and no provider credential or raw billing payload.
- [ ] Reservation tests prove idempotence, internal atomicity, lease expiry,
      maximum-cost preflight, release, reconciliation, soft overrun, hard
      violation, quarantine, overdrawn blocking/recovery, and missing-usage
      behavior.
- [ ] Quarantine clearance requires authorized actor/reason/remediation
      evidence, is append-only and auditable, and never occurs automatically
      because a budget pool was replenished.
- [ ] Deferral/recovery tests prove tenant authorization, open-PR/exact-head
      checks, duplicate prevention, supersession, retention, and deletion.
- [ ] Adjudication-store tests prove actor-bound append, replay, conflict,
      correction, query authorization, retention/deletion coverage, and tenant
      isolation without raw findings.
- [ ] Retention conformance proves every `standard-v1` class, 180-day deferred
      expiry, legal hold, seven-day live purge, 35-day backup expiry, transfer/
      removal behavior, and coverage-aware deletion.
- [ ] Threat modeling covers catalog tampering, replay, cross-tenant access,
      forged authorization, secret leakage, and service unavailability.
- [ ] The selected private repository records Infrastructure ownership,
      Security review, deployment, authentication, PostgreSQL, and secret-store
      decisions before implementation begins.
- [ ] Conformance proves standalone operation requires no private service and
      managed-service absence cannot fail open or silently change modes.

## Dependencies

- Parent public schemas and fingerprints from
  `07-25-compile-and-execute-budget-aware-review-plans`.

## Out of Scope

- Hosting provider choice before the Infrastructure owner records the
  deployment decision in the private repository.
- Review prompts, diffs, findings, or GitHub review publication.

## Intended start order (2026-07-25 reconciliation)

- The parent-schema dependency above and the parent's dependency on this task are
  co-evolution, not a cycle: `07-25-define-budget-review-v2-contracts` lands first,
  then this task's definition children (catalog, ledger, reconciliation, recovery,
  evidence store, retention), then the parent's compiler/authorization children
  consume them.
