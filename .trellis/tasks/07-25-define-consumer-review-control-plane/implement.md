# Consumer Review Control Plane Handoff Plan

## Child Delivery Tasks

1. `07-25-define-review-candidate-catalog`
2. `07-25-define-review-budget-ledger`
3. `07-25-define-review-usage-reconciliation`
4. `07-25-define-deferred-review-recovery`
5. `07-25-define-finding-adjudication-evidence-store`
6. `07-25-define-review-data-retention-policy`

The public contract children can complete here. The corresponding private
implementation belongs in `platypeeps/sd-review-control-plane`, owned by
`@platypeeps/infrastructure` with `@platypeeps/security` boundary review.

## Handoff Evidence

- Private repository: `https://github.com/platypeeps/sd-review-control-plane`
- Bootstrap commit: `f454f7fc7ad4c28c95b3b5304253206690cd0185`
- Infrastructure has `maintain`; Security has `push` for CODEOWNERS review.
- Protected `main` requires one code-owner approval, last-push approval,
  resolved conversations, and linear history; force pushes/deletion are off.
- Initial private task: `07-25-implement-control-plane-mvp` (`planning`).

## Public-Repository Work

1. Freeze versioned catalog/prompt-profile projection and operation schemas.
2. Add deterministic in-memory fake and conformance fixtures.
3. Add replay, concurrency, stale-state, shared-pool, and privacy tests.
4. Add versioned `standard-v1` retention, deletion, legal-hold, transfer, purge,
   backup/restore, and coverage conformance.
5. Document threat model, retention, deletion, transfer, and outage semantics.
6. Add adjudication append/query conformance without storing raw finding text.

## Activation Gate

Before private implementation:

1. Bootstrap the private `platypeeps/sd-review-control-plane` repository with
   Infrastructure ownership and Security review rules.
2. Confirm tenant/authentication model, deployment boundary, PostgreSQL, and
   secret store.
3. Confirm authoritative budget sources and provider billing limitations.
4. Import the public conformance suite without copying protocol semantics.
5. Obtain explicit authorization for work outside this repository.

## Private Implementation Sequence

1. Implement immutable catalog/version storage, prompt-profile metadata and
   candidate bindings, and safe projection without adapter-registry values or
   profile bodies.
2. Implement observations, digest-bound request preflight validation, and atomic
   maximum-cost reservation ledger.
3. Implement full-actual reconciliation/release, soft/hard classification,
   overdrawn blocking/recovery, candidate quarantine/authorized clearance, and
   bounded audit records.
4. Implement deferred storage and explicit recovery authorization.
5. Implement append-only adjudication storage and bounded authorized queries.
6. Implement `standard-v1` scheduling, compaction, holds, purge, backup aging,
   restore deletion-journal replay, and coverage-aware reporting.
7. Run conformance, security, fault-injection, retention, and restore tests.
8. Prove managed outages fail closed and the public standalone mode remains
   operable without any service endpoint or credential.

## Rollback Gate

The public workflow must be able to disable control-plane routing and return to
an explicit earlier review configuration without exposing or deleting private
ledger evidence.
