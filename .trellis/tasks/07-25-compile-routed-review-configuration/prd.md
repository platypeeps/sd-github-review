# Compile routed review configuration

## Goal

Build the pure deterministic source and catalog compiler with canonical diagnostics and digests.

## Requirements

- Accept a versioned explicit-mode human source. Require a digest-matching
  bounded catalog projection only for managed mode; require setup-discovered
  fixed handler profiles for standalone mode. Perform no network or credential
  access.
- Reject unknown fields, imports, inheritance, runtime presets, inferred slots,
  invalid aliases, chain/slot references, policy incompatibility, overlap, and
  the unsupported `overrides.labels` field.
- Validate every external candidate's exact prompt-profile alias/version/digest
  and handler compatibility. Validate native `handler-managed` declarations;
  reject missing/unknown profiles, lane defaults, inheritance, fallback, and
  runtime or command overrides.
- Normalize ordering, durations, units, and safe candidate fields into canonical
  JSON with source, catalog, and output digests.
- Return field/source-location diagnostics without exposing secret or raw catalog
  data.
- Reject missing mode, mixed standalone/managed fields, and any attempt to
  infer or rewrite mode based on endpoint or credential availability.
- Require explicit `budgetExhaustion.<lane>.merge=block|allow` in managed
  source, normalize it into each compiled lane, and reject missing or legacy
  exhaustion values after the v2 migration cutover.

## Acceptance Criteria

- [ ] Equivalent semantic inputs compile byte-for-byte identically across runs.
- [ ] Every semantic source/catalog change alters the canonical output digest.
- [ ] Invalid reference, mismatch, composition, and capability fixtures fail
      before producing an active manifest.
- [ ] Shared and candidate-specific profile fixtures compile deterministically;
      missing, incompatible, substituted, or digest-mismatched profiles fail.
- [ ] Candidate/slot label configuration is not representable in compiled v2
      output and legacy `overrides.labels` input fails with a field diagnostic.
- [ ] The compiler remains pure and testable without filesystem or network
      access.
- [ ] Standalone compilation succeeds with no catalog input, while managed
      compilation still fails without the exact catalog projection.
- [ ] Managed fixtures prove explicit block/allow policy changes the canonical
      digest and that no default or contextual inference is synthesized.

## Dependencies

- `07-25-define-budget-review-v2-contracts`.
- `07-25-define-review-candidate-catalog` for safe projection semantics.

## Out of Scope

- Catalog retrieval, manifest promotion, budget authorization, or dispatch.
