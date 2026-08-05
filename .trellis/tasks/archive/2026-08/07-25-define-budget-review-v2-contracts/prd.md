# Define budget review v2 contracts (core)

## Goal

Define the versioned v2 contract core: the strict source discriminated union,
prompt-profile binding, side-effect-free candidate preflight, bounded candidate-
options response, the three-axis review/assurance/gate outcome contract, the
revisioned exact-head Check projection, setup discovery, shared canonical
identity/fingerprint/bounded-output primitives, and the read-only historical v1
receipt decoder.

This task was split at implementation: the coherent contract core ships here;
the remaining v2 contract families are owned by dedicated follow-up tasks (see
Scope Split). `design.md` remains the shared design for the whole v2 contract
family and is inherited by the follow-up tasks.

## Requirements

- Define bounded version-2 schemas with forbidden-field and size validation
  before canonicalization, bounded errors that never echo forbidden/oversized
  values, and frozen canonical constants.
- Define the source contract as a strict `standalone`/`managed` discriminated
  union with capability-unavailable reasons and `budgetOutcome=not_managed`;
  forbid missing, inferred, and mixed modes.
- Define prompt-profile metadata/binding as a strict `referenced`
  (alias/version/digest) vs `handler-managed` union; no schema field represents a
  lane default, inheritance, fallback, or override.
- Require managed contracts to carry explicit
  `budgetExhaustion.<lane>.merge=block|allow` with no runtime default; reject
  legacy exhaustion values.
- Define a side-effect-free candidate request-preflight schema bound to exact
  head/candidate/prompt-profile/policy/configuration digests, with explicit
  units, bounded input, output cap, maximum expected charge, hard request limit,
  safety margin, and capability evidence — without request content.
- Define a bounded candidate-options response containing only safe aliases,
  display names, eligible lanes/slots, handler, cost tier, availability
  state/reason, and catalog/configuration digests; forbid credentials, raw
  balances, private policy; deterministic ordering; structurally unable to
  authorize or identify an attempt.
- Define independent `reviewOutcome`, `assuranceOutcome`, and `gateOutcome`
  fields plus stable reason codes; map proven pre-dispatch budget exhaustion to
  deferred assurance while every non-budget failure blocks the gate.
- Define the revisioned exact-head Check projection with stable names, monotonic
  revision, latest-authorized-attempt compare-and-swap token, same-head recovery,
  changed-head supersession, stale-write rejection, and branch-protection
  readiness.
- Define setup-discovery/readiness for the stable `sd-review / assurance` and
  `sd-review / gate` Checks, advertising one active major and exact optional
  capabilities.
- Keep historical version-1 receipt decoding read-only and reject v1/default
  selectors for new v2 dispatch.

## Acceptance Criteria

- [x] Strict standalone/managed union: standalone forbids catalog/control-plane
      fields and declares `budgetOutcome=not_managed`; managed forbids route/
      standalone fields; missing/unknown/mixed modes rejected.
- [x] Prompt-profile binding is a strict referenced-vs-handler-managed union with
      no default/inheritance/fallback/override field, and cross-field forbidden
      fields rejected.
- [x] Candidate-options fixtures prove deterministic ordering, privacy/size
      bounds, and a shape that cannot authorize or identify a review attempt.
- [x] Exhaustion fixtures require explicit merge policy, map proven pre-dispatch
      budget exhaustion to deferred assurance plus the explicit gate policy, and
      prove every non-budget failure blocks.
- [x] Check-projection fixtures cover stable names, conclusions, revision/CAS,
      same-head recovery, changed-head supersession, stale-write rejection, and
      branch-protection readiness.
- [x] Setup discovery advertises one active major and exact optional
      capabilities.
- [x] Historical v1 receipt decoding is read-only and v1/default selectors are
      rejected for new v2 dispatch.
- [x] Unknown additive non-forbidden fields follow an explicit compatibility rule
      (decoders project only allow-listed keys); nested forbidden fields and
      oversized inputs fail without echoing values.
- [x] `npm test`, syntax check, `validate:metadata`, `validate:ci-parity`, and the
      coverage gate are green.

## Scope Split

Remaining v2 contract acceptance criteria are owned by dedicated follow-up tasks,
each inheriting this task's `design.md`:

- `08-04-define-v2-receipt-and-identity-contracts` — immutable per-attempt
  receipt, safe-catalog/compiled-manifest projections, durable authorization and
  adapter-acknowledgment decoders, full cross-contract identity fixture matrix,
  and receipt privacy fixtures (parent AC1, AC5).
- `08-04-define-v2-local-attestation-envelope` — local-attestation evidence
  envelope decoder, actor/workflow enrichment, and `review:none`/v1-summary trust
  proofs (parent AC8).
- `08-04-define-v2-quarantine-clearance-contracts` — quarantine status and
  clearance request/response contracts plus the `candidate_quarantined` reason
  path (parent AC13, AC10 residual).
- `08-04-define-v2-retention-standard-v1-contracts` — the `standard-v1` retention
  contract family and its fixtures (parent retention AC).

## Dependencies

- Parent budget-aware design for ownership and v2 cutover decisions.

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.
- The contract families listed under Scope Split (owned by follow-up tasks).
