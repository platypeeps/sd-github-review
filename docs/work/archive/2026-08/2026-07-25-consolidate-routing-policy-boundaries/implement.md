# Consolidate routing policy boundaries — Implementation Plan

Order keeps the suite green at every step. Each step names the SOURCE and TEST
consumers it must repoint (C-3): a moved symbol breaks any test importing it
until repointed, so import updates and their test edits land in the same step.

## Steps

1. **Baseline.** Run `npm test`, record pass count. Snapshot the import graph:
   `grep -nE "from \"\.\./src|from \"\./" src/*.js test/*.js` — note every module
   AND test that imports each symbol slated to move.

2. **Extract `src/path-match.js`.** Move `globToRegExp` + `findSensitiveFiles`
   from `router.js`.
   - Source repoint: `receipt.js` (`globToRegExp`), `router.js` internal use,
     `risk-context.js` (later), `index.js`/`operations.js` (`findSensitiveFiles`).
   - Test repoint: `test/router.test.js:3-12` imports `findSensitiveFiles` from
     `router.js` — repoint to `path-match.js` (or add a `test/path-match.test.js`
     and move those cases). Grep for any other `findSensitiveFiles`/`globToRegExp`
     test import.
   - Goal: `receipt.js` no longer imports `router.js`. Re-run
     `test/receipt.test.js`, `test/router.test.js`, `npm test`.

3. **Extract `src/normalize.js`.** Move the canonicalizers/parsers
   (`normalizeMode`, `normalizeEscalationRoute`, `normalizeConfidence`,
   `parseList`, `parseReviewCommand`, `modeFromLabels`, `resolveExplicitMode`,
   `reviewLabels`, `isTrustedCommand`, `ignoredEventDecision`). Finalize the exact
   set by following current `router.js` consumers.
   - Source repoint: `protocol.js`, `router.js`, `index.js`, `operations.js`.
   - Test repoint: `test/router.test.js:3-12` (canonicalizer/parser imports) and
     `test/consumer-installer.test.js:32` (`reviewLabels` from `router.js`) —
     repoint both to `normalize.js`. Grep every test for these symbols.
   - Note: this step does NOT yet claim `protocol.js` drops its `router.js`
     import — `selectProtocolRoute` still calls `routeReview` from `router.js`
     until Step 4 (C-2). `protocol.js` keeps only the `routeReview` import now.
   - Re-run `test/protocol.test.js`, `test/router.test.js`,
     `test/consumer-installer.test.js`, `npm test`.

4. **Relocate policy into `router.js` + close the decode boundary (C-1, C-2).**
   In one step so the intermediate state stays green:
   - Add `decodeRoutingInputs({request, routingContext, policy})` to
     `protocol.js` — a codec function returning validated typed routing inputs.
     Enumerate the COMPLETE set `selectProtocolRoute` validates today (G-A), not
     a "policy flags" bucket: `request` (`decodeReviewRequest`); `sensitiveFiles`
     (`stringArray`); `changedLines`, `changedLineThreshold` (min 1),
     `localConfidenceThreshold` (max 100) (`integerValue`); `confidence`
     (`enumValue`); `draft`, `reviewDrafts`, `allowBookkeepingNone`
     (`booleanValue`); `successorEvidence` (`decodeSuccessorEvidence` or
     `undefined`); and `lowConfidenceRoute`, `highRiskRoute`
     (`normalizeEscalationRoute` from `normalize.js`). Do NOT resolve
     `independentReviewFloor`/`localEvidenceRoute` here — those use `resolvedRoute`
     (policy strength); pass them through raw for the policy owner to resolve.
     Validators stay private; no policy in this function.
   - Move the policy (`ROUTE_STRENGTH`, `resolvedRoute`, `weakerRoute`,
     `strongerRoute`, `successorMatchesRequest`, floor/local-evidence/successor
     blocks) and the public `selectProtocolRoute` callable into `router.js`.
     `router.js`'s `selectProtocolRoute` calls `decodeRoutingInputs` (protocol)
     then applies `routeReview` + floors. Preserve signature + exact return shape.
   - NOW remove `protocol.js`'s `router.js` import entirely (routeReview left with
     the moved policy). Confirm `protocol.js` has zero policy/`router.js` imports.
   - Source repoint: `operations.js` (`selectProtocolRoute` from `router.js`).
   - Test repoint: `test/protocol.test.js:14` imports `selectProtocolRoute` from
     `protocol.js` — repoint to `router.js` (NOT a re-export from `protocol.js`,
     which would re-invert the edge). The decoder tests stay on `protocol.js`.
   - Re-run `test/protocol.test.js`, `test/operations.test.js`, `npm test`.

5. **Extract `src/risk-context.js`.** One builder for the shared risk context;
   wire `index.js` + `operations.js` to it. Entrypoint-specific extras stay put
   (standalone command/label/trust; durable policy block + `route==="auto"`
   gating + successor compare). Verify standalone STILL calls `routeReview`
   directly (policy-free) — do NOT route it through `selectProtocolRoute`.
   Re-run `test/action.test.js`, `test/operations.test.js`.

6. **Extract `src/reviewer-dispatch.js`.** One presence-probe (requested +
   reviewed-at-head skipping `DISMISSED`, case-insensitive `commit_id`) +
   conditional `requestReviewer`. Standalone calls it directly; durable wraps it
   in its existing `store.observe`/reconciliation try/catch. Preserve
   `copilot-requested` output + durable reconciliation. Re-run
   `test/action.test.js`, `test/operations.test.js`.

7. **AC1 dependency-boundary test** `test/dependency-boundaries.test.js`: parse
   every `src/*.js` module's imports and assert the full allowed-import matrix
   from design.md — including `path-match.js`/`normalize.js` have zero local
   imports, `protocol.js`/`receipt.js` import no policy/`router.js`, and
   `selectProtocolRoute` is defined in exactly one module (C-5).

8. **AC2 shared-service parity fixture** with the discriminating case (C-4):
   (a) same inputs → identical shared risk-context + dispatch structures across
   both entrypoints; (b) a configured independent-review floor raises the durable
   route but leaves the standalone route unchanged; (c) dispatch parity over
   already-requested, exact-head reviewed, `DISMISSED`, and newly-requested.

9. **Exact-shape assertions (C-6).** Add exact-key assertions on
   `selectProtocolRoute`'s return for the explicit and automatic branches,
   including `policyVersion` and stable `reason` values.

10. **AC4 docs.** Update `DESIGN.md` and the directory-structure spec for
    `path-match.js`, `normalize.js`, the policy owner, and the two services.

11. **Update the `check` script (C-7).** `package.json:12` `check` enumerates
    files statically; add `node --check` for `src/path-match.js`,
    `src/normalize.js`, `src/risk-context.js`, `src/reviewer-dispatch.js` (and
    keep it consistent with any bounded `src/*.js` approach). Re-run
    `npm run check`.

12. **Final full suite + gates.** Run the complete CI-parity set from the
    Validation section — `npm test`, `npm run test:coverage`, `npm run check`,
    `npm run validate:metadata`, `npm run validate:ci-parity` (equivalently
    `npm run check:full`) — plus `git diff --check` and the sd-check preflight.
    A green local run must mean the same gates CI runs are green (G-B).

## Validation

Run the SAME gate set CI runs (`.github/workflows/ci.yml`), not a subset (G-B) —
CI runs `npm test`, `npm run test:coverage`, `npm run check`,
`npm run validate:metadata`, `npm run validate:ci-parity`.

- Focused: `node --test test/router.test.js test/protocol.test.js
  test/receipt.test.js test/operations.test.js test/action.test.js
  test/consumer-installer.test.js test/dependency-boundaries.test.js`.
- `npm test`
- `npm run test:coverage` — the four new `src/*.js` modules auto-enter coverage
  (`check-coverage.mjs` INCLUDES `src/**`). Extracting code into leaf modules can
  shift the GLOBAL floor and adds per-file surface, so give `path-match.js`,
  `normalize.js`, `risk-context.js`, `reviewer-dispatch.js` direct test coverage
  (the AC1/AC2 fixtures plus leaf-unit cases) rather than relying on incidental
  coverage; do not lower any existing floor to pass.
- `npm run check` (must include the four new modules — Step 11)
- `npm run validate:metadata`
- `npm run validate:ci-parity` — proves `check:full` still runs every CI package
  gate; unaffected by this change but must stay green.
- `git diff --check`
- `node scripts/sd-ai-command-pack-review-preflight.mjs` (sd-check)

## Rollback Gate

Do not ship if the A-008 regression fixtures fail (dependency-boundaries matrix,
standalone-policy-free discriminating parity, dispatch parity, exact return
shape), if any existing route/protocol/receipt/operation/action assertion
regresses, or if an exact-head, privacy, ownership, or no-duplicate-side-effect
guarantee regresses. Restore the offending seam and keep the failing fixture.

## Post-merge

Update the audit ledger (`.trellis/audit/ledger.md`) marking A-008 fixed only
after the fix is verified on the implementation head.
