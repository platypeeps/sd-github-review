# Authorize budget-aware review plans

## Goal

Prepare exact-head managed-mode plans, validate control-plane authorization,
and persist authorization before dispatch.

## Requirements

- Accept only explicit `mode=managed` compiled contracts. Standalone direct-
  handler planning belongs to `07-25-support-standalone-review-mode` and is
  never selected because a control-plane request failed.
- Parse only exact trusted comment commands for candidate overrides and options
  discovery. Candidate commands take precedence over persistent broad route
  labels for one new attempt; candidate/slot control labels are rejected.
- For audit finding A-011, resolve configured mode and a validated trusted
  command before parsing broad route-label selection. Conflicting lower-
  priority labels cannot block or alter either higher-priority decision.
- Support `/review options`, `/review options <lane>`, and
  `/review options <lane> --slot <slot-id>` as bounded read-only queries over
  the active compiled contract and current safe availability projection. They
  create no attempt identity, reservation, durable authorization, or dispatch.
- Return strict valid lane, slot, and candidate aliases for invalid input; do
  not fuzzy-match or silently correct a command.
- Resolve one exact-head logical lane request against one active compiled digest,
  named chain, explicit slot, and optional authorized candidate override.
- Bind the selected candidate's exact prompt-profile mode and alias/version/
  digest into preparation and authorization. Candidate commands cannot select,
  replace, or override that profile.
- Validate a side-effect-free request preflight for every considered candidate
  before reservation. Treat an oversized or unverifiable candidate as pre-
  dispatch ineligible; automatic selection may continue only within its named
  lane chain, while an explicit candidate blocks without fallback.
- Prepare the request without side effects and send only bounded aliases,
  fingerprints, policy/budget references, preflight facts, maximum expected
  charge, hard request limit, and reserve requirements to the trusted control-
  plane boundary.
- Validate a response against the complete request identity and persist durable
  authorization before any reviewer side effect.
- Continue within the named chain only after proven pre-dispatch ineligibility;
  stop and reconcile after any ambiguous possible dispatch.
- For an explicit candidate, bypass normal ordering but never fall through when
  it is unavailable or unfunded. Proven budget exhaustion records deferred
  assurance and applies the lane's explicit `budgetExhaustion.merge` gate
  policy; every other cause blocks.

## Acceptance Criteria

- [x] Tests cover first eligible selection, explicit override, shared pool,
      stale/unknown state, proven budget exhaustion, deferred assurance, and
      blocked/passing gate outcomes.
- [x] Unverifiable, policy, authentication, and framework failures always block
      regardless of the lane's budget-exhaustion merge policy.
- [x] Trusted/untrusted, malformed, ambiguous, and invalid-alias command tests
      cover one-attempt precedence and deterministic safe suggestions.
- [x] Fixed-mode and trusted-command fixtures with conflicting broad route
      labels retain the higher-priority decision; automatic mode with the same
      conflict still fails visibly.
- [x] Every options form returns bounded deterministic choices and proves zero
      attempt, reservation, persistence, and dispatch side effects.
- [x] Reserved candidate/slot labels fail visibly while stable broad route
      labels retain their existing route semantics.
- [x] Response mismatch, replay conflict, changed head, or stale configuration
      cannot authorize dispatch.
- [x] Prompt-profile mismatch, private-resolution failure, or prepared-request
      fingerprint drift cannot authorize dispatch or another candidate.
- [x] Oversized, uncountable, unpriced, unit-mismatched, or unenforceable
      requests fail before reservation; no fixture silently truncates context
      or escalates to another lane.
- [x] Authorization persistence is idempotent and precedes every adapter call.
- [x] No internal adapter fallback or post-ambiguity next-candidate selection is
      possible.

## Dependencies

- `07-25-compile-routed-review-configuration`.
- `07-25-define-review-budget-ledger`.

## Out of Scope

- Reviewer execution, usage reconciliation, or aggregate parallel plans.
- Standalone fixed-handler planning or mode migration.
