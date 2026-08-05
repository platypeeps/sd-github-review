# Encapsulate mutable review-label registry (A-020)

## Goal

Close audit finding A-020 so the review-label registry can no longer be
silently mutated by any importer, while the routing/label behavior it drives
stays identical.

## Audit Finding

- ID: A-020 · severity P3 · effort S · confidence Plausible · dimension design
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: an exported mutable `Set` of review labels lets importers alter
  routing label behavior for the whole process.

## Evidence Boundary

- Ledger cites `src/router.js:167`; on main @ HEAD (2026-08-04) the registry has
  since moved to `src/normalize.js:101`:
  `export const reviewLabels = new Set(["review:auto", ...EXPLICIT_LABELS.keys()]);`
  A `Set` is a mutable reference — any importer can call `.add`, `.delete`, or
  `.clear` and change label routing for every consumer in the process.
- Consumers of the export (verified repo-wide):
  - `src/index.js` calls `reviewLabels.has(eventLabel)` at three sites to decide
    `isRelevantLabelEvent` (read-only membership).
  - `test/consumer-installer.test.js` compares it to `ROUTING_LABELS` for parity
    (read-only enumeration).
  No consumer mutates it, so no behavior depends on it being mutable.

## Requirements

- No mutable collection of review labels is exported from `src/normalize.js`.
- Membership checks keep working: `src/index.js` still decides
  `isRelevantLabelEvent` from the canonical label set, with identical results.
- The installer↔router label parity check still has a canonical, read-only way
  to enumerate the label names.
- The canonical label set remains single-sourced from `EXPLICIT_LABELS` plus
  `review:auto` (no duplicated literal list).

## Acceptance Criteria

- [x] `src/normalize.js` no longer exports a mutable `reviewLabels` `Set`.
- [x] A predicate (`isReviewLabel`) and an immutable collection replace it;
      importers cannot mutate the label registry.
- [x] `src/index.js` uses the new surface and produces identical
      `isRelevantLabelEvent` results.
- [x] A regression test asserts the mutable `Set` export is gone and that the
      replacement rejects mutation (guards against reintroducing a mutable
      registry).
- [x] Full suite green (baseline 234/234 after A-021; new test on top → 235/235).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-020 set to fixed only after verification;
      owner reassigned to this dedicated child.

## Verification Limits

- Pure in-process API-surface change with full unit coverage (membership,
  parity, immutability). No external runtime is involved.

## Out of Scope

- Broader router/normalize refactors (A-008/A-010).
- Changing which labels map to which routes.
