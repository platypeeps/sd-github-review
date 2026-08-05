# Implement — v2 local-attestation evidence envelope

Ordered, gated execution plan. Every code change lives in `src/protocol-v2.js`
(one guard), `fixtures/protocol/v2/`, and `test/protocol-v2.test.js`.

## Pre-flight

- [ ] `trellis-before-dev` for the backend layer; confirm protocol-v2 idioms
      (fail-closed decoders, `[{name,error,value}]` fixtures, `fixture()` +
      `eachInvalid` harness).
- [ ] Re-read `decodeReviewOutcomes` (`src/protocol-v2.js:803-862`) and the
      valid/invalid outcomes fixtures to confirm the insertion point.

## Step 1 — Contract rule (AC2 enablement)

- [ ] In `decodeReviewOutcomes`, after the local-blocking pass-guard (`:842-844`),
      add the two `reviewNone` guards (keyed on `reviewOutcome.reasonCode ===
      "review_none"`) — assurance cannot `pass`, gate must `block` — exactly as
      specified in design.md. Do NOT key on the skipped state, and do NOT broaden
      the existing `reviewSkippedNonBudget` rule. Keep the existing comment style.
- [ ] `node --check src/protocol-v2.js`.

## Step 2 — Fixtures

- [ ] `fixtures/protocol/v2/outcomes.valid.json`: add
      `"review:none blocks the gate and does not satisfy assurance"` —
      reviewOutcome `{skipped, review_none}`, assuranceOutcome
      `{not_applicable, review_none}`, gateOutcome `{block, review_none}`.
- [ ] `fixtures/protocol/v2/outcomes.invalid.json`: add three cases —
      (a) `"review:none cannot satisfy assurance (skipped)"`: `{skipped,
      review_none}` + assurance `pass`; error regex
      `assuranceOutcome cannot pass when the review reason is review_none`.
      (b) `"review:none cannot satisfy assurance or free the gate (completed)"`:
      `{completed, review_none}` + assurance `pass` + gate `pass`; same
      assurance error regex (assurance guard fires first).
      (c) `"review:none cannot free the gate"`: `{skipped, review_none}` +
      assurance `not_applicable` + gate `pass`; error regex
      `gateOutcome must block when the review reason is review_none`.
- [ ] No new v1 fixture — reuse the real `validV1Receipts` in the test.

## Step 3 — Tests (AC-mapped)

- [ ] AC1 test: load `local-authorization.valid.json` + `local-receipt.valid.json`;
      assert each carries `headSha`, `evidenceDigest`, `publicationContext` with
      `publisher`/`association`/`isPrAuthor`/`workflowRef`/`runId`, and
      `trustLevel === ATTESTED_TRUST_LEVEL` (already imported at test:6).
- [ ] AC2a test: valid review:none outcomes fixture decodes; each invalid
      review_none case (incl. `{completed, review_none}`) throws via
      `eachInvalid(..., decodeReviewOutcomes)`.
- [ ] AC2b test: for each `validV1Receipts` entry (`test:54`), assert
      `decodeLocalReviewAuthorization(value)` and `decodeLocalReviewReceipt(value)`
      both throw `/must use supported schema major 2/`. Pass `entry.value` (the v1
      receipt) **directly** — these decoders take the object itself
      (`objectValue` returns its argument; the string is only an error label), so
      wrapping in `{localReviewAuthorization: …}` would vacuously test a
      schemaVersion-less wrapper instead of the real v1 receipt. Confirm the exact
      message at runtime; relax to a plain throw only if a forbidden-field check
      fires first.

## Step 4 — Validation gates (must be green before commit)

- [ ] `node --test test/protocol-v2.test.js`
- [ ] `npm test` (full suite)
- [ ] `npm run test:coverage` (global floor; run twice to confirm the new branch
      is stably covered)
- [ ] `npm run check`
- [ ] `npm run validate:metadata`
- [ ] `npm run validate:ci-parity`

## Step 5 — Task bookkeeping

- [ ] Mark all three PRD acceptance criteria `[x]` once their gates pass.
- [ ] Ship via `sd-ship until=merge` (the work-loop composite).

## Review gates / rollback

- Convergence boundary: run the planning-adversarial-review contract before
  `task.py start`.
- Rollback point: the entire change is one guard + fixtures + tests; `git revert`
  of the single feature commit fully removes it. No schema-major bump, no data
  migration.

## Out of scope

Compiler, transport, storage, workflow, and any new named envelope decoder
(the envelope is the existing authorization/receipt composition).
