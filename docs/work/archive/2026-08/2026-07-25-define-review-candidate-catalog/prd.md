---
title: Define review candidate catalog
status: done
created: 2026-07-25
branch: feat/07-25-define-review-candidate-catalog
---
# Define review candidate catalog

## Goal

Specify immutable candidate and prompt-profile aliases, safe projections,
bindings, capabilities, and policy versioning.

## Requirements

- Define immutable catalog name/version/digest and stable candidate aliases.
- Define a reusable immutable prompt-profile registry containing stable alias,
  version, digest, and compatible handler/capabilities. Actual prompt/
  configuration values are adapter-owned in a private registry keyed by that
  same identity and are not catalog content.
- Bind each candidate to lane eligibility, handler/model target, opaque
  credential/budget/policy references, reserve, capability, price/data/prompt/
  reasoning rules, hard input/output/per-request cost limits, tokenizer/counting
  evidence, explicit units, finish-reason/usage capabilities, and permitted
  same-model endpoint failover.
- Require each external PR-Agent candidate to reference exactly one compatible
  prompt profile by alias/version/digest. Allow several compatible candidates
  to share one profile and allow a candidate-specific profile when needed.
  Require native candidates to declare `handler-managed` prompting instead.
- Reject lane defaults, inheritance, merging, fallback profiles, runtime
  substitution, and independent profile overrides.
- Produce a bounded safe projection containing only fields required for compile
  and dispatch; exclude secret values and management endpoints.
- Define disablement, replacement, retention, and audit semantics without
  mutating an already pinned version.
- Apply `standard-v1`: retain a catalog/safe-policy version while any retained
  record references it, then for 13 months after the final retained reference.
  After deletion retain only the non-reversible digest/coverage fact allowed by
  the shared policy.

## Acceptance Criteria

- [x] Catalog fixtures prove immutability, digest verification, alias stability,
      lane/capability validation, and portable model replacement.
- [x] Prompt-profile fixtures prove reuse and candidate-specific binding,
      handler compatibility, native handler-managed prompting, and rejection
      of missing, unknown, duplicate, mismatched, or substituted profiles.
- [x] Projection fixtures contain no credential, billing payload, or private
      endpoint.
- [x] Unknown, duplicate, disabled, malformed, or policy-incomplete candidates
      fail closed.
- [x] Safe-projection fixtures include only the non-secret facts required for
      request preflight and hard-limit enforcement and reject unverifiable token,
      price, unit, finish-reason, or usage capabilities.
- [x] Safe projections expose profile alias/version/digest and compatibility
      facts but no prompt body or configuration value.
- [x] Kimi, Qwen, Copilot, and providers remain consumer choices, not protocol
      constants.
- [x] Fake-clock fixtures cover active references, final-reference removal, the
      13-month tail, hold/purge interaction, and no dangling retained receipt.

## Dependencies

- `07-25-define-budget-review-v2-contracts` for projection schema.
- `07-25-define-review-data-retention-policy` for lifecycle semantics.

## Out of Scope

- Balance observation, reservation, reviewer execution, or repository source
  authoring.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-08/07-25-define-review-candidate-catalog`:

- research/catalog-reuse-map.md
