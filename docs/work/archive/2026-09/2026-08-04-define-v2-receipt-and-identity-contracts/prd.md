---
title: Define v2 receipt and cross-contract identity contracts
status: planning
parked: 2026-09-01 bulk-park (D2)
created: 2026-08-04
---
# Define v2 receipt and cross-contract identity contracts

## Goal

Complete the immutable per-attempt v2 receipt schema, the safe-catalog and
compiled-manifest projection decoders, durable authorization and adapter-
acknowledgment decoders, and the full cross-contract identity fixture matrix.
Builds on the v2 contract core shipped in `07-25-define-budget-review-v2-contracts`.

## Requirements

- Consume the exported `decodeMutableBinding` helper in `src/protocol-v2.js` from
  a receipt/authorization decoder (currently defined but unconsumed).
- Define the immutable per-attempt receipt schema bound to repository, PR, exact
  head, attempt, and source/catalog/compiled digests + candidate plan
  fingerprint; carry retention policy ID/version/digest, data class, lifecycle,
  retained-until, hold/deletion state, and coverage window with no private content.
- Define safe-catalog projection and compiled-manifest decoders carrying only the
  referenced prompt-profile alias/version/digest or `handler-managed` mode.
- Define durable authorization and adapter-acknowledgment v2 decoders sharing the
  canonical identity tuple.
- Add the full valid/invalid cross-contract identity fixture matrix (AC1) proving
  every schema and identity relationship, and the receipt/safe-projection privacy
  fixtures (AC5) exposing only profile alias/version/digest and mode.
- Add the residual prompt-profile fixtures the core did not cover (parent AC2):
  shared vs candidate-specific profiles, and missing/unknown/incompatible/digest-
  mismatched profile references across the catalog/compiled/authorization/receipt
  contracts. (The core already rejects default/inheritance/fallback/override
  fields and proves the referenced-vs-handler-managed union.)

## Acceptance Criteria

- [ ] Canonical valid and invalid fixtures cover every schema and cross-contract
      identity relationship (parent AC1).
- [ ] Receipt and safe-projection fixtures expose only profile alias/version/
      digest and mode; prompt/configuration values remain forbidden (parent AC5).
- [ ] `decodeMutableBinding` is consumed by a receipt/authorization decoder.
- [ ] Residual prompt-profile fixtures cover shared/candidate-specific,
      missing/unknown/incompatible, and digest-mismatched profiles (parent AC2).
- [ ] npm test, syntax check, metadata + ci-parity validation, coverage gate green.
      **Caveat recorded 2026-08-20 (research B-5/B-6):** two of those three gates do not
      observe this task's code. `src/protocol-v2.js` is coverage-quarantined
      (`scripts/check-coverage.mjs:38-47`, excluded at `:68`) and is absent from the
      `npm run check` syntax chain (`package.json:12`), so "coverage gate green" is
      **vacuous** for this module and green there is not evidence the new decoders are
      covered or even parse. `npm test` — which imports the module — is the real safety net.
      Either scope a task-local coverage run that includes the file or restate this AC;
      **owner decision, unresolved.** Do not cite a green coverage gate as coverage.

## Dependencies

- `07-25-define-budget-review-v2-contracts` (v2 contract core + shared design.md).

## Out of Scope

- Compiler, network transport, storage, or workflow implementation.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/08-04-define-v2-receipt-and-identity-contracts`:

- research/2026-08-20-research.md
- research/v2-receipt-identity-surface.md
