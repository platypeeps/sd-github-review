# Implement: v2 receipt and cross-contract identity contracts

Ordered plan. Context order: this file, `design.md`, `prd.md`,
`research/v2-receipt-identity-surface.md`. Reuse existing helpers in
`src/protocol-v2.js`; add no new primitives. Mirror `decodeLocalReviewReceipt`
(`:1258`) for the spread-binding pattern and `decodeRetentionStatus`
(`retention-policy.js:1032`) for the retention VOCABULARY and validation shape —
not as a field list to copy: it also emits `githubNativeArtifacts` (`:1057`) and
optional `lastDeletion` (`:1072`), which the receipt does not carry (design §3).

## Steps

1. **Import the shared retention vocabulary.** Add one import in
   `src/protocol-v2.js` for the already-exported frozen arrays
   `RETENTION_DATA_CLASSES` (`retention-policy.js:36`), `RETENTION_LIFECYCLE_STATES`
   (`:51`), `DELETION_STATUSES` (`:90`). Build protocol-local sets:
   `const RECEIPT_DATA_CLASS_SET = new Set(RETENTION_DATA_CLASSES)` (and likewise
   lifecycle, deletion). Do NOT export or mutate retention-policy's own sets (a
   `Set` export is mutable — C-6). No import cycle: retention-policy imports only
   `node:crypto`.

   **The import also needs a layering-matrix entry — empirically confirmed 2026-08-20, not
   merely read.** The adversarial-review pass added the exact import to a scratch copy of
   `src/protocol-v2.js` and ran the suite. With
   `test/dependency-boundaries.test.js:24` left at `"protocol-v2.js": ["protocol.js"]`, the
   test at `:98` fails with precisely the predicted message:

   ```
   AssertionError [ERR_ASSERTION]: src/protocol-v2.js imports src/retention-policy.js,
   which the layering forbids
   ```

   Widening line 24 to `["protocol.js", "retention-policy.js"]` and re-running clears it
   with no other failure. (Both edits were reverted; `src/` and `test/` are unmodified.)
   So the documented remedy is verified to work, not assumed. Make the matrix edit in the
   same commit as the import, and run `node --test test/dependency-boundaries.test.js`
   immediately after this step rather than discovering it at the final gate. If the owner
   instead chooses protocol-local vocabularies (research B-1), skip the import and add a
   drift test asserting the local arrays deep-equal the `retention-policy.js` exports.

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

4. **`decodeAdapterAcknowledgment`** (new export). **Name collision (verified
   2026-08-20):** `src/protocol.js:728` already exports `decodeAdapterAcknowledgment`
   (v1: `logicalDispatchId`/`backendId`/`status`/`acknowledgedAt`/`findingChannels`).
   Different module, so no export conflict, but any test or consumer importing both
   must alias — the repo's own convention for this is `protocol-v2.js:14`
   (`import { decodeReceipt as decodeV1Receipt }`). Either name the new export
   `decodeAdapterAcknowledgmentV2` or alias at every dual-import site; decide before
   writing the test file. Do NOT add `alias` /
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
   alias/candidateDigest (mirror `:1526-1531` — the alias guard is at `:1526-1528`
   and the digest guard at `:1529-1531`; they are two separate checks). Freeze.

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
     missing/malformed → decoder rejects; shared-vs-specific → compare the
     `promptProfile` BINDINGS ONLY, never the full triples (two distinct
     candidates always differ in alias/candidateDigest, so a triple compare can
     never prove sharing — C-2);
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
node --test test/dependency-boundaries.test.js   # run FIRST, right after step 1
npm test                     # baseline 647 (measured 2026-08-20 @ 40df292) + new, 0 fail
npm run test:coverage        # global floors: lines 88 / branches 77 / funcs 88
npm run check                # node --check chain (see caveat below)
npm run validate:metadata
npm run validate:ci-parity
node ~/.agents/bin/sd-ai-command-pack-review-preflight.mjs   # 0 failures
```

**Two gate caveats, verified 2026-08-20 — do not cite these as evidence the new
code is covered.**

- `npm run test:coverage` does NOT measure `src/protocol-v2.js`.
  `scripts/check-coverage.mjs:38-47` lists it (with 7 sibling v2 modules) in
  `QUARANTINED`, passed as `--test-coverage-exclude` at `:68` (corrected 2026-08-20 from
  `:70`), because those modules
  are unreachable from both Action entrypoints (~9,390 of 13,136 lines under `src/`,
  per the comment at `:28-37`). The command will go green while measuring none of
  this task's code. prd AC5's "coverage gate green" is therefore vacuous here; either
  scope a task-local coverage run that includes the file, or restate the AC honestly.
  Do not delete the `QUARANTINED` entry — this task does not make the module
  reachable from `src/index.js`.
- `npm run check` does NOT syntax-check `src/protocol-v2.js`. `package.json:12`
  enumerates its `node --check` targets and lists neither `protocol-v2.js`,
  `retention-policy.js`, nor any `review-*.js`. No new entry is needed, but the
  safety net for the new decoders is `npm test` importing the module, not this
  command.

## Review gates

- Planning-adversarial-review (host + Codex lanes) BEFORE `task.py start`.
- After implementation: full gate set green, then `sd-ship until=merge` with
  deterministic sd-check + Prism + Copilot fallback (routed backend absent).

## Rollback

Additive in `src/`: new decoders + new fixture files + new test blocks + one import
line in `protocol-v2.js`. One existing test file changes — the
`test/dependency-boundaries.test.js:24` matrix entry that authorizes the retention
import (step 1). Revert = drop the new decoders, import, fixtures, test blocks, and
that matrix entry. No existing decoder, fixture, signature, or `retention-policy.js`
line is mutated.
