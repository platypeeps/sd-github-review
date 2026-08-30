---
title: Project local review assurance and gate
status: planning
created: 2026-07-25
---
# Project local review assurance and gate

## Goal

Project valid local-review attestations into truthful assurance and merge-gate Checks with stale-head invalidation.

## Requirements

- Consume only a verified immutable local-attested receipt and revalidate its
  exact PR head before projection.
- Reuse the stable `sd-review / assurance` and `sd-review / gate` names and the
  revisioned latest-authorized-attempt compare-and-swap rules.
- Map authorized `clean` to satisfied assurance/pass gate; findings, failure,
  cancellation, invalid evidence, and system errors to failed assurance/block;
  and missing/new-head evidence to deferred assurance/block. **Unresolved:** the
  `deferred` half contradicts the shipped decoder and fixture, which use
  `fail` + an `action_required` Check conclusion. See `implement.md` step 0; do
  not implement this bullet until the owner settles it.
- Use operator wording that says repository-trusted local review was attested;
  never claim GitHub ran the reviewer or that the evidence is independent.
- On a changed head, retain old receipts, prevent late writes, and publish a
  new awaiting-local-attestation projection for the new head.
- Keep only `sd-review / gate` branch-protection-required and make readiness
  detect absent/misconfigured local-attestation workflows and Checks.

## Acceptance Criteria

- [ ] Every local terminal/missing outcome maps to the documented independent
      review, assurance, and gate outcomes and Check conclusions.
- [ ] New-head, late-old-head, same-head retry, and conflicting projection
      races obey monotonic revision/CAS rules.
- [ ] Check titles and summaries expose actor, exact head, tool/profile, time,
      result, evidence digest, and trust limitation within privacy bounds.
- [ ] Branch-protection readiness requires only the gate and reports actionable
      local-attestation setup errors.
- [ ] No Check path publishes raw findings or labels local evidence independent.

## Dependencies

- `07-25-ingest-local-review-attestations`.
- `07-25-finalize-budget-review-evidence` projection rules.

## Out of Scope

- Running local review tools, remediating findings, or storing raw artifacts.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-project-local-review-assurance`:

- research/2026-08-20-research.md
