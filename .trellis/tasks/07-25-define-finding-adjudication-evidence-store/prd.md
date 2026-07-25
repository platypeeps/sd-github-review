# Define Trusted Finding Adjudication Evidence Store

## Goal

Specify the consumer private control-plane append-only store and conformance
contract for trusted finding adjudication events.

## Requirements

- Persist immutable events keyed by tenant, repository, finding identity,
  actor, trust policy, and idempotency identity.
- Support atomic append, idempotent replay, exact-event query, bounded filtered
  query, supersession, dispute projection, retention, deletion, and repository
  transfer/removal.
- Authenticate trusted workflows and authorize tenant/repository scope; never
  accept actor trust solely from request fields.
- Encrypt private state, isolate tenants, audit reads/writes, and keep
  management credentials outside public workflows and repositories.
- Return bounded signed/fingerprinted acknowledgments and query responses.
- Apply `standard-v1`: retain an adjudication correction/conflict chain as one
  unit until 13 months after its newest event. After deletion, preserve only
  non-identifying 25-month aggregate/coverage facts; never retain raw finding
  bodies or actor/repository/finding identifiers in those aggregates.
- Apply shared legal-hold, seven-day live purge, 35-day backup expiry,
  repository removal/transfer, deletion-journal, and coverage-gap semantics.
- Provide an in-memory conformance fake here; identify a private
  implementation repository and owner before activation.

## Acceptance Criteria

- [ ] Conformance fixtures cover append, replay, conflict, correction,
      concurrency, query bounds, retention, deletion, transfer, backup/restore,
      and outage recovery.
- [ ] Cross-tenant/repository access, forged actor/trust data, stale policy,
      malformed identity, and oversized events fail before persistence.
- [ ] Uncertain writes reconcile by idempotency identity without duplicate
      events.
- [ ] Deletion and retention preserve the declared audit/legal boundary and
      cannot silently alter aggregate coverage.
- [ ] Fake-clock tests prove chain-unit expiry is based on the newest event and
      that correction, hold, purge, backup restore, and aggregate anonymization
      cannot create a partial authoritative chain.
- [ ] The private implementation repository, accountable owner, secret store,
      and security profile are named and accept `standard-v1` before
      implementation begins.

## Dependencies

- `07-25-define-finding-adjudication-contract`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Raw finding bodies, prompts, diffs, provider transcripts, reviewer scoring,
  or GitHub publication.
