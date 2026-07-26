# Define budget review v2 contracts

## Goal

Define versioned source, catalog, manifest, authorization, receipt, status, and discovery schemas.

## Requirements

- Define bounded version-2 schemas for human source, safe catalog projection,
  compiled manifest, budget operations, durable authorization, adapter
  acknowledgment, receipts, status/recovery, and setup discovery.
- Define prompt-profile metadata and binding shapes across safe catalog,
  compiled candidate, authorization, adapter acknowledgment, and receipt
  contracts. External candidates use an exact alias/version/digest reference;
  native candidates use `handler-managed`.
- Define the source/compiled contract as a strict `standalone`/`managed`
  discriminated union plus capability-unavailable reasons and
  `budgetOutcome=not_managed`; forbid missing, inferred, and mixed modes.
- Within standalone mode, define a strict per-route
  `direct-handler|local-attested` execution union. Require explicit local-
  attestation actor/association, PR-author, and age policy; forbid inferred
  trust, mixed execution fields, and local-attested managed/parallel slots in
  the initial contract.
- Require managed source and compiled contracts to carry explicit
  `budgetExhaustion.<lane>.merge=block|allow`. Define no runtime default and
  reject legacy exhaustion values after one-time migration.
- Define a side-effect-free candidate request-preflight schema bound to exact
  head, candidate, prompt-profile, policy, and configuration digests. Include
  explicit units, counted/conservatively bounded input, output cap, maximum
  expected charge, hard request limit, safety margin, and capability evidence
  without request content.
- Define a bounded candidate-options response containing only safe aliases,
  display names, eligible lanes/slots, handler, cost tier, availability state
  and reason, and catalog/configuration digests. Explicitly forbid credentials,
  raw balances, and private policy details.
- Define immutable retention-profile, record-classification, lifecycle, legal-
  hold, status, purge request/progress/result, deletion-receipt, backup-expiry,
  transfer/removal, and coverage schemas for `standard-v1`.
- Require bounded receipts/status to carry retention policy ID/version/digest,
  data class, lifecycle, retained-until, hold/deletion state, and coverage
  window without exposing retained private content.
- Bind mutable operations to repository, PR, exact head, attempt, source/catalog/
  compiled digests, and candidate plan fingerprints.
- Define independent `reviewOutcome`, `assuranceOutcome`, and `gateOutcome`
  fields plus stable reason codes. Define immutable attempt receipts separately
  from revisioned exact-head Check projections and bind projection writes to a
  latest-authorized-attempt compare-and-swap token.
- Define setup-discovery and readiness fields for the stable
  `sd-review / assurance` and `sd-review / gate` Checks, including whether only
  the gate is branch-protection-required.
- Define forbidden privacy/secret fields, scalar/container/size bounds, canonical
  identity rules, and capability version negotiation.
- Keep historical version-1 receipt decoding read-only and reject v1/default
  selectors for new v2 dispatch.

## Acceptance Criteria

- [ ] Canonical valid and invalid fixtures cover every schema and cross-contract
      identity relationship.
- [ ] Fixtures cover shared/candidate-specific profiles, native handler-managed
      prompting, missing/unknown/incompatible/digest-mismatched profiles, and
      reject defaults, inheritance, fallback, or command/runtime overrides.
- [ ] Unknown additive fields follow an explicit compatibility rule and never
      enter canonical policy accidentally.
- [ ] Forbidden nested fields and oversized inputs fail without echoing values.
- [ ] Receipt and safe-projection fixtures expose only profile alias/version/
      digest and mode; actual prompt/configuration values remain forbidden.
- [ ] Setup discovery advertises one active major and exact optional
      capabilities.
- [ ] Standalone fixtures contain no catalog/control-plane requirement and
      managed fixtures cannot authorize through standalone fields after a
      missing or failed control-plane response.
- [ ] Local-attestation fixtures bind exact-head evidence and authenticated
      publication context, use `repository_attested` trust, and prove that
      `review:none` and historical v1 local summaries cannot satisfy v2
      assurance.
- [ ] Candidate-options fixtures prove deterministic ordering, privacy/size
      bounds, and a response shape that cannot authorize or identify a review
      attempt.
- [ ] Preflight and outcome fixtures distinguish input ineligibility,
      `incomplete_token_limit`, `budget_overrun`, `policy_violation`,
      candidate quarantine, and pool `overdrawn` without exposing prompts or
      output.
- [ ] Exhaustion fixtures require explicit merge policy, map proven
      pre-dispatch budget exhaustion to deferred assurance plus pass/block gate,
      and prove every non-budget failure blocks.
- [ ] Check-projection fixtures cover stable names, conclusions, revision/CAS,
      same-head recovery, changed-head supersession, stale-write rejection, and
      branch-protection readiness.
- [ ] Quarantine status and clearance request/response fixtures bind candidate,
      actor, reason, remediation evidence, policy/configuration digest, and
      audit identity without granting implicit budget or dispatch authority.
- [ ] Retention fixtures cover `standard-v1`, destructive authorization,
      idempotent purge, seven-day live deletion, 35-day backup expiry, holds,
      transfer/removal, deletion-journal restore, and coverage gaps.

## Dependencies

- Parent budget-aware design for ownership and v2 cutover decisions.

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.
