# Budget-Aware Review Engine Design

## Modules

```text
explicit v2 source -> mode-specific compiler -> active compiled contract
                                                   |
request/event -> prepare exact-head plan -----------+
                         |
              +----------------+----------------+
              |                |                |
       standalone direct   local attestation   managed private authorization
              |                |                |
              +----------------+----------------+
                         v
                  authorized adapter
                         |
                         v
             finalize -> receipt/check/status
```

The compiler and planner are deterministic and provider-neutral. Network,
credential, and provider/billing access occur only in trusted workflow or
private-control-plane components.

## Delivery Decomposition

| Child task | Delivery boundary |
| --- | --- |
| `07-25-define-budget-review-v2-contracts` | Versioned schemas, canonical identities, privacy bounds, and fixtures |
| `07-25-compile-routed-review-configuration` | Pure deterministic source/catalog compiler |
| `07-25-authorize-budget-aware-review-plans` | Trusted candidate-command parsing, side-effect-free options discovery, exact-head preparation, control-plane authorization, and durable pre-dispatch state |
| `07-25-finalize-budget-review-evidence` | Acknowledgment validation, reconciliation linkage, receipts, checks, status, recovery, and discovery |
| `07-25-support-standalone-review-mode` | Explicit no-control-plane fixed-profile routing, capability limits, migration, and managed-outage fail-closed behavior |
| `07-25-support-local-attested-reviews` | Explicit no-reviewer local evidence contract, authenticated ingestion, and truthful assurance/gate projection |

## Compiler Contract

Input is one explicit-mode human source. Managed input also requires a bounded
projection whose catalog identity matches the source pin. Standalone input
requires an explicit direct-handler profile or local-attestation policy per
lane and forbids catalog, chain, budget, and parallel-plan fields. Managed
output includes only safe prompt-
profile identity/compatibility metadata and exact candidate bindings, never
profile bodies. Output is canonical JSON with source and compiled digests plus
a catalog digest only in managed mode. Runtime accepts only an active compiled
output.

## Runtime Contract

Preparation is side-effect free. The authorization request is fingerprinted to
the exact repository/PR/head/attempt/configuration, ordered candidates, and
candidate-bound prompt-profile identities. A matching private response may
authorize one immutable candidate or declare bounded ineligibility/deferral.
Authorization becomes durable before dispatch.

Finalization validates adapter acknowledgment, records applied profile and
actual-model/provider provenance plus usage limitations, and reconciles through
the private boundary. Uncertainty stops the chain. Status and recovery
contracts expose opaque references and bounded facts, never credentials,
profile bodies, or source content.

Attempt receipts are immutable. Separate exact-head projections publish
`sd-review / assurance` as truthful assurance and `sd-review / gate` as the
sole branch-protection decision. Proven pre-dispatch budget exhaustion always
defers assurance; only explicit `budgetExhaustion.merge` may let the gate pass.
All other non-assurance outcomes block. Linked recovery uses monotonic
projection revisions so late older results cannot overwrite current state.

Standalone preparation emits one immutable direct-handler plan or awaits one
bounded repository-trusted local attestation and bypasses control-plane
authorization by contract, not because a request failed. Local-attested
execution has no reviewer dispatch path. Managed authorization failure never
selects a standalone profile or local policy. Every path exposes its explicit
mode, execution kind, trust, and capability limitations in final evidence.

Candidate override commands use strict stable aliases from the active compiled
contract. `/review options` uses the same validation and bounded status inputs
but stops before attempt identity, authorization, reservation, or persistence.
Candidate/slot control labels are reserved and unsupported; only the existing
broad lane labels participate in routing.

## Compatibility

Version 2 deliberately rejects legacy/default selectors for new dispatch.
Historical version-1 receipts have a separate read-only decoder. Emergency
rollback pins the last version-1 Action; normal rollback restores a prior valid
explicit v2 compiled contract. Existing fixed v1 routing may migrate once to an
explicit standalone v2 source without retaining a runtime v1 compatibility
branch.
