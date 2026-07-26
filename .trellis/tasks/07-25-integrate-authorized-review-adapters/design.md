# Authorized Review Adapter Design

## Adapter Boundary

```text
exact-head candidate + prompt-profile identity + safe policy
          |
          +--> side-effect-free external request preflight
          |
          v
reservation + durable child authorization
          |
          +--> native Copilot request + bounded observer
          |
          +--> external PR-Agent invocation + bounded acknowledgment
```

Both paths consume the same immutable identity and provenance requirements but
use separate credentials and completion observers. Adapters execute policy;
they do not select candidates, reserve budgets, or persist durable routing
state.

External preflight prepares the complete request and returns bounded token,
cost, unit, and capability facts without invoking the reviewer or exposing
request content to the private control plane. Authorization binds those facts
to the exact head, candidate, and policy digest. Dispatch must use the same
prepared-request fingerprint and immutable output cap.

## Delivery Decomposition

| Child task | Delivery boundary |
| --- | --- |
| `07-25-integrate-copilot-review-adapter` | Native request, exact-head observation, and ambiguity handling |
| `07-25-integrate-pr-agent-review-adapter` | Single external candidate, exact private profile resolution, compiled policy, credential isolation, and model/profile provenance |

## External Adapter

The adapter receives one model target, exact prompt-profile identity, and safe
policy projection. It resolves and digest-verifies the private registry entry
by that identity before preparation. Internal cross-model and prompt-
profile fallback are disabled. Same-model endpoint failover is allowed only
when the candidate policy permits it. The acknowledgment is bound to the child
authorization and reports applied-profile and actual model/provider evidence
without prompt values or raw provider routing payloads.

A length/token-limit finish reason produces `incomplete_token_limit` even when
partial output parses. The adapter reports usage but does not publish the
partial review or invoke another candidate.

## Native Adapter

The Copilot path requests the exact PR/head and records request identity. Its
observer correlates the eventual review to the request/head within a bounded
window. Timeout or missing correlation is not silently replaced by another
candidate.

## Secrets And Ambiguity

Each child job receives only its reviewer credential. The management credential
remains in the separate control-plane step. Any state after which a reviewer
side effect might have started is terminal for fallback and enters
reconciliation.
