# Qualify cheap review candidates

## Goal

Validate each cheap candidate independently for runtime capability, policy, provenance, and cost controls.

## Requirements

- Qualify every cheap-chain candidate and its exact prompt profile as one tuple
  against the pinned PR-Agent/LiteLLM runtime, exact model/profile provenance,
  token/prompt/reasoning capability,
  provider-compatible input counting or conservative bounds, output-cap and
  finish-reason enforcement, price/unit/max-cost policy, data/region/parameter
  policy, and usage attribution.
- Record evidence against stable candidate/catalog aliases without making Qwen,
  Mistral, OpenRouter, or another provider a protocol constant.
- Fail qualification when any mandatory control is unsupported, ignored,
  unproven, or cannot be acknowledged at runtime.
- Require requalification when the model target, runtime pin, prompt-profile
  alias/version/digest, or relevant policy digest changes.
- Keep qualification as a technical and policy conformance gate. Once a
  candidate passes it, version 1 may add or reorder that candidate through the
  normal reviewed repository workflow without a separate pilot approval,
  mandatory sample size, or signed promotion decision.

## Acceptance Criteria

- [ ] Current and replacement candidate fixtures prove portable qualification.
- [ ] Fixtures cover candidates sharing a profile, candidates using distinct
      profiles, exact profile application, and rejection of missing,
      incompatible, or digest-mismatched profiles.
- [ ] Unsupported capability, missing provenance, price/data mismatch, and
      unknown usage behavior fail visibly.
- [ ] Qualification exercises exact token boundaries and proves that length-
      limited completion, soft overrun, and hard violation are distinguishable.
- [ ] Qualification evidence is bounded and contains no source, prompt, finding,
      transcript, or credential.
- [ ] An unqualified candidate cannot enter an automatic named chain.
- [ ] A qualified candidate cannot run with a different profile, including
      through an explicit candidate command.
- [ ] Qualification evidence distinguishes hard conformance failures from
      optional advisory operating evidence.

## Dependencies
- `07-25-bound-cheap-review-token-usage` — exact token boundaries and
  length-limit/overrun/violation distinctions the qualification exercises.
- `07-25-reduce-cheap-review-prompt` — candidate/profile tuples and immutable
  profile bindings under qualification.
- `07-25-control-cheap-review-reasoning-effort` — reasoning-capability policy
  qualified per candidate.
- `07-25-enforce-cheap-provider-cost-policy` — price/data/region/parameter
  policy the qualification validates.

## Out of Scope

- Provider endpoint failover enforcement or observation-pilot execution.
