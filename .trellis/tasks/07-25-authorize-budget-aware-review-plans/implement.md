# Budget-Aware Review Authorization Implementation Plan

1. Add trusted command, options, reserved-label, preparation, selection,
   override, and response fixtures.
2. Implement strict parsing, side-effect-free options discovery, and exact-head
   plan resolution.
3. Implement bounded request/response fingerprint validation including the
   candidate-bound prompt-profile mode and identity.
4. Persist authorization/rejection/deferral plus separate assurance/gate
   outcomes idempotently before dispatch output.
5. Add ambiguity, replay, changed-head, and exhaustion handling.

Validate named-chain ordering, explicit candidate behavior, shared pools,
stale/unknown state, budget-only merge allowance, non-budget hard blocks,
response mismatch, crash boundaries, options privacy and zero-side-effect
behavior, and no side effect before durable authorization.
