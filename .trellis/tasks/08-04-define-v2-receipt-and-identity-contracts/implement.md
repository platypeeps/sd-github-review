# Implement: v2 receipt and cross-contract identity contracts

Ordered plan. Context order: this file, `design.md`, `prd.md`,
`research/v2-receipt-identity-surface.md`. Reuse existing helpers in
`src/protocol-v2.js`; add no new primitives. Mirror `decodeLocalReviewReceipt`
(`:1258`) for the spread-binding pattern and `decodeRetentionStatus`
(`retention-policy.js:1032`) for the retention field set.

## Steps

1. **Import the shared retention vocabulary.** Add one import in
   `src/protocol-v2.js` for the already-exported frozen arrays
   `RETENTION_DATA_CLASSES` (`retention-policy.js:36`), `RETENTION_LIFECYCLE_STATES`
   (`:51`), `DELETION_STATUSES` (`:90`). Build protocol-local sets:
   `const RECEIPT_DATA_CLASS_SET = new Set(RETENTION_DATA_CLASSES)` (and likewise
   lifecycle, deletion). Do NOT export or mutate retention-policy's own sets (a
   `Set` export is mutable — C-6). No import cycle: retention-policy imports only
   `node:crypto`.

2. **`decodeAttemptReceipt`** (new export). Prologue: `rejectForbiddenFields` →
   `assertEncodedSize` → `objectValue` + `schemaVersion`. Then:
   - `const binding = mutableBinding(receipt, "attemptReceipt")` — this internal
     function IS the `decodeMutableBinding` export (`:1801`), so calling it
     consumes the AC-target export.
   - Candidate identity (B2, required — not optional):
     `const alias = aliasValue(receipt.alias, "attemptReceipt.alias")` and
     `const candidateDigest = digestValue(receipt.candidateDigest,
     "attemptReceipt.candidateDigest")`. These are the join key that locates the
     catalog candidate record in the step-7 AC2 assertions.
   - `const promptProfile = decodePromptProfileBinding(receipt.promptProfile,
     "attemptReceipt.promptProfile")` (AC5/AC2 receipt-level profile — C-2).
   - Retention projection: `retentionPolicyId` (`aliasValue`),
     `retentionPolicyVersion` (`semverLikeValue`), `retentionPolicyDigest`
     (`digestValue`); `dataClass`/`lifecycleState`/`deletionStatus` via the
     step-1 local sets; `legalHold:{held, expiresAt?}` (expiresAt valid only when
     held, else throw); `coverageStart` (required); `coverageEnd` (optional) with
     the new invariant `Date.parse(coverageEnd) >= Date.parse(coverageStart)` else
     `attemptReceipt.coverageEnd must not precede coverageStart` (C-8);
     `retainedUntil` (explicit `null` branch, else timestamp); `recordedAt`.
   - Assemble `body = {schemaVersion, ...binding, alias, candidateDigest,
     promptProfile, <retention fields>}` (add `coverageEnd` only when present), then
     `return Object.freeze({...body, receiptFingerprint: deriveV2Fingerprint(body)})`
     — fingerprint over the FULL body so any emitted-field change alters it (C-5).

3. **`decodeDurableAuthorization`** (new export). Prologue with the AUTHORITY extra
   set: `rejectForbiddenFields(value, "durableAuthorization",
   AUTHORITY_FORBIDDEN_FIELD_NAMES)` (arity confirmed `:228`; pattern `:948`). Then
   `mutableBinding` spread + `alias` (`aliasValue`) + `candidateDigest`
   (`digestValue`) — the same required B2 join key as the receipt — +
   `promptProfile: decodePromptProfileBinding(...)` + `authorizedAt`
   (`timestampValue`). `body` = all of that; return frozen
   `{...body, authorizationFingerprint: deriveV2Fingerprint(body)}` (full-body).

4. **`decodeAdapterAcknowledgment`** (new export). Do NOT add `alias` /
   `candidateDigest` here — the ack reaches candidate identity transitively via the
   `authorizationFingerprint` it references (design §3 "Candidate identity (B2)");
   duplicating them would create a divergence surface. Prologue; `mutableBinding`
   spread; `adapter` (use an existing adapter/alias validator — `aliasValue` if no
   dedicated one); `authorizationFingerprint` (`digestValue`) — the fingerprint of
   the authorization being acknowledged (the AC1 ack↔authorization linkage);
   `acknowledgedAt`. `body` = all of that; return frozen `{...body,
   acknowledgmentFingerprint: deriveV2Fingerprint(body)}` (full-body, so it also
   covers the referenced authorizationFingerprint).

5. **`decodeSafeCatalogProjection`** + **`decodeCompiledManifestProjection`** (new
   exports). Prologue; bind `catalogDigest` (+ `sourceDigest`/`compiledDigest` for
   compiled, via `digestValue`); decode a bounded `candidates`/`entries` array
   (non-empty, ≤ `MAX_COLLECTION_ITEMS`) where each item is
   `{alias: aliasValue(...), candidateDigest: digestValue(...), promptProfile:
   decodePromptProfileBinding(item.promptProfile, ...)}` — naming matches the
   existing `decodeReviewerCatalog` (`:1520`/`:1532`). Reject duplicate
   alias/candidateDigest (mirror `:1526`). Freeze.

6. **Fixtures.** Add valid/invalid pairs under `fixtures/protocol/v2/`:
   `v2-attempt-receipt`, `v2-durable-authorization`, `v2-adapter-acknowledgment`,
   `v2-safe-catalog`, `v2-compiled-manifest`, `v2-prompt-profile-residual`. Entry
   shape `{name, value}` (valid) / `{name, error, value}` (invalid). Generate via a
   scratchpad generator importing the live decoders (mirror the retention
   iteration) and self-validate before wiring. Invalid coverage per the §4 matrix:
   forbidden field, authority field (authorization only), bad identity field,
   schema major 1, unknown enum, `legalHold.expiresAt` with `held:false`,
   `coverageEnd` before `coverageStart`, bad `retainedUntil`,
   handler-managed-with-reference, referenced-missing-field, empty/oversize array,
   duplicate alias/digest, plus (B2) missing `alias`, malformed `alias`, missing
   `candidateDigest`, and non-64-hex `candidateDigest` on BOTH the receipt and the
   durable-authorization invalid fixtures.

7. **Wire tests** in `test/protocol-v2.test.js`: one `fixture(...)` per file; valid
   loops assert `Object.isFrozen` + domain checks; invalid loops via `eachInvalid`.
   Add the design §6 assertion points:
   - AC1 identity matrix: three contracts from one tuple share all tuple fields; a
     mismatched head/attempt diverges; ack.authorizationFingerprint ===
     authorization.authorizationFingerprint (and a mismatched pair diverges).
   - decodeMutableBinding-consumed: import the export, deep-equal the receipt's
     tuple vs `decodeMutableBinding(v, "attemptReceipt")`; bad headSha/attempt
     throws.
   - AC5 privacy non-echo; profile exposes only mode/alias/version/digest.
   - AC2 residual (design §6 taxonomy): membership is over the FULL catalog
     candidate record `(alias, candidateDigest, promptProfile)`, not digest alone.
     missing/malformed → decoder rejects; shared-vs-specific → full-record compare;
     digest-mismatch / unknown (incl. unknown alias reusing a known digest) /
     incompatible (per-candidate profile divergence) → full-record set-membership
     fails. Assert each of those three membership-failure cases three times — once
     for a compiled entry, once for a receipt, once for a durable authorization —
     so prd line 27's "across the catalog/compiled/authorization/receipt contracts"
     is covered explicitly, not by implication. Registry/handler
     `compatibleHandlers` resolution is out of scope; do not add a handler set to
     the projections.
   - Cross-contract digest consistency (receipt/catalog/compiled).

## Validation commands (gate — prd AC)

```bash
npm test                     # expect prior 595 + new tests pass, 0 fail
npm run test:coverage        # global floors: lines 88 / branches 77 / funcs 88
npm run check                # node --check all src (no new file entry needed)
npm run validate:metadata
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs   # 0 failures
```

## Review gates

- Planning-adversarial-review (host + Codex lanes) BEFORE `task.py start`.
- After implementation: full gate set green, then `sd-ship until=merge` with
  deterministic sd-check + Prism + Copilot fallback (routed backend absent).

## Rollback

Purely additive: new decoders + new fixture files + new test blocks + one import
line in `protocol-v2.js`. Revert = drop those. No existing decoder, fixture,
signature, or `retention-policy.js` line is mutated.
