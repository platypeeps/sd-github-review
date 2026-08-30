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

## Existing v1 Seam (extend, do not rebuild)

A narrower version of this boundary already ships and is reachable from the
Action entrypoint. `route` emits a bounded canonical adapter request
(`src/operations.js:141-160`, output at `:204`), a credential-scoped job runs
the reviewer (`examples/sd-review.yml:69-159`), and `acknowledge`/`finalize`
close the loop (`src/operations.js:242-259`, `:455-485`) against decoders in
`src/protocol.js:661` and `:728`. Credential isolation
(`examples/sd-review.yml:75-77`), the empty internal fallback list
(`examples/sd-review.yml:135`, asserted at `test/metadata.test.js:294`), and
single-target execution are already delivered here. Single-target execution is
two steps, not one: a preflight shell gate rejects a wrong backend id, a missing
model, or a provider-prefix mismatch (`examples/sd-review.yml:79-115`), and the
reviewer step then runs one container against one `--pr_url`
(`examples/sd-review.yml:116-159`).

The v2 contracts this design depends on exist as decoders with no producer and
no reachable caller (`src/protocol-v2.js`, `src/review-plan-authorization.js`,
`src/review-candidate-catalog.js`). The allowed-import matrix at
`test/dependency-boundaries.test.js:18-55` grants neither `operations.js` nor
`index.js` an edge into any of them, so the parent's first structural decision
is where the adapter seam sits and which single edge that matrix gains.

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
