# Scaffold routed review source

## Goal

Generate one complete explicit sd-review source file without candidate or slot
label controls.

## Requirements

- Generate one complete `.github/sd-review.yml` for an explicitly selected
  mode: explicit direct-handler profiles and/or local-attestation policies for
  standalone, or exact catalog pin, cheap/deep chains, slots, completion, and
  explicit per-lane `budgetExhaustion.merge` policy for managed.
- Scaffold local-attested execution only from an explicit operator selection
  and require complete allowed-actor/association, PR-author, and evidence-age
  inputs; never infer it from missing provider or control-plane setup.
- Accept explicit scaffold inputs or a versioned installer preset, but always
  materialize the full source without imports, inheritance, or hidden defaults.
- Emit `merge: block` for every managed lane unless an explicit reviewed
  scaffold input chooses `allow`; never omit the field for runtime inference.
- Exclude provider/model parameters, credential references, budget endpoints,
  prompts, and secrets from the human source.
- Refuse unmanaged collisions and expose a conflict-aware dry run before write.

## Acceptance Criteria

- [ ] Fresh-install fixtures produce schema-valid explicit source for both
      lanes in each mode and no generated runtime manifest before compilation.
- [ ] Reapplying the same inputs is idempotent; changed unmanaged source is not
      overwritten.
- [ ] The source has no label-override field; candidate/slot labels are never
      provisioned or adopted and are reported as unsupported if pre-existing.
- [ ] Alternate candidate aliases can be scaffolded without code changes.
- [ ] Managed fixtures contain explicit `block|allow` values for both lanes;
      fresh defaults are visibly `block` and no fixture relies on inference.
- [ ] Standalone scaffolding requires no catalog endpoint or credential and
      never includes managed-only fields.
- [ ] Standalone fixtures cover direct-only, all-local-attested, and mixed
      routes; incomplete trust policy and implicit direct-to-local conversion
      fail visibly.

## Dependencies

- `07-25-define-budget-review-v2-contracts` for source schema.

## Out of Scope

- Legacy migration, exact catalog retrieval, compilation, or manifest promotion.
