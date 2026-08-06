# Research: v2 receipt + cross-contract identity surface

- **Query**: Map the existing v2 contract surface in `src/protocol-v2.js` (and sibling contract files) so a design.md can be written against real signatures, covering decodeMutableBinding, the canonical identity tuple, existing v2 decoders + fail-closed pattern, prompt-profile handling, receipt schema gaps, fixture conventions, and coverage/gate specifics.
- **Scope**: internal
- **Date**: 2026-08-05

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/protocol-v2.js` | 1801 lines. Home of all v2 contract decoders, the shared identity binding (`mutableBinding` / `decodeMutableBinding`), fail-closed helpers, prompt-profile binding, and the reviewer plan/catalog compiler. The v2 receipt + identity contracts land here. |
| `src/retention-policy.js` | 1413 lines. `RETENTION_SCHEMA_MAJOR = 2`. Retention vocabularies (data classes, lifecycle states, deletion statuses, legal-hold states), `decodePolicyBinding` (the policy id/version/digest triple), `decodeRetentionStatus` (already carries dataClass/lifecycle/deletion/hold/coverage/retainedUntil — the field model the receipt must mirror). |
| `src/receipt.js` | 752 lines. **v1** receipt only (`RECEIPT_MARKER = "<!-- sd-github-review-receipt:v1 -->"`, `RECEIPT_CHECK_NAME = "sd-github-review/receipt"`). Not the v2 receipt; the v2 immutable per-attempt receipt is new and belongs in `protocol-v2.js`. |
| `test/protocol-v2.test.js` | Loads `fixtures/protocol/v2/*.{valid,invalid}.json` via `fixture(...)`; reference for how new decoders are exercised. |
| `test/retention-policy.test.js` | Reference for the `fixture(...)` + `eachInvalid(...)` pattern and the `{name, error, value}` / `{name, value}` fixture entry shape. |
| `fixtures/protocol/v2/` | 60+ paired `<name>.valid.json` / `<name>.invalid.json` fixtures. |
| `scripts/check-coverage.mjs` | Global + per-file coverage floors (`npm run test:coverage`). |
| `package.json` | Gate command set (`check`, `test`, `test:coverage`, `validate:metadata`, `validate:ci-parity`, `check:full`). |

---

### 1. `decodeMutableBinding` — signature, semantics, consumers

**Definition**: `src/protocol-v2.js:469` — internal `function mutableBinding(value, field)`.
**Export**: `src/protocol-v2.js:1801` — `export { mutableBinding as decodeMutableBinding };`

```js
function mutableBinding(value, field) {          // protocol-v2.js:469
  const binding = objectValue(value, field);
  return {
    repository: repositoryValue(binding.repository, `${field}.repository`),         // {owner,name}
    pullRequestNumber: integerValue(..., { minimum: 1 }),                           // :473
    headSha: headShaValue(binding.headSha, `${field}.headSha`),                     // 40|64 hex, :476
    attempt: integerValue(..., { minimum: 1, maximum: 100 }),                       // :477
    sourceDigest: digestValue(...),                                                 // 64 hex, :478
    catalogDigest: digestValue(...),                                                // :479
    compiledDigest: digestValue(...),                                               // :480
    candidatePlanFingerprint: digestValue(...),                                     // :481
  };
}
```

**Semantics**: the exact-attempt identity tuple — repository + PR + exact head + attempt + the three pipeline digests (source/catalog/compiled) + the candidate plan fingerprint. It does NOT run a fail-closed prologue itself (no `rejectForbiddenFields`, no `assertEncodedSize`, no `schemaVersion`, no `Object.freeze`) — it is a field-builder meant to be spread into a decoder that supplies those.

**Consumer confirmation (prd claim "defined but unconsumed")**: grep for `decodeMutableBinding`/`mutableBinding` across `src/` and `test/` returns only the definition (`:469`) and the export (`:1801`). **No call site exists.** Confirmed unconsumed. AC requires a receipt/authorization decoder to consume it.

**Which contract must consume it**: the immutable per-attempt **v2 receipt** is the natural consumer (it is the durable record of an exact attempt bound to source/catalog/compiled + candidate plan fingerprint). The durable **authorization** decoder is the alternative. Note the analogous local-attested path (`decodeLocalEvidenceBinding` :1084) is spread into `decodeLocalReviewAuthorization` (:1211) and `decodeLocalReviewReceipt` (:1258) via `...binding` — that is the exact spread-into-decoder idiom the new receipt/authorization decoders should follow for `decodeMutableBinding`.

---

### 2. Canonical identity tuple — where defined/validated

The canonical tuple is **`mutableBinding` (:469)**, exported as `decodeMutableBinding`. Fields: `repository{owner,name}`, `pullRequestNumber`, `headSha`, `attempt`, `sourceDigest`, `catalogDigest`, `compiledDigest`, `candidatePlanFingerprint`.

**Is there a shared helper or is it repeated?** There are currently **two parallel identity builders**, not one shared one:
- `mutableBinding` (:469) — the full source/catalog/compiled + candidate-plan-fingerprint tuple (currently unconsumed).
- `decodeLocalEvidenceBinding` (:1084) — the local-attested variant: `repository, pullRequestNumber, headSha, lane, attempt, configurationDigest, localReceiptDigest, contentDigest, evidenceDigest`. Consumed by the local request/authorization/receipt/status decoders.

Field-level primitives are shared: `repositoryValue` (:410), `headShaValue` (:352, accepts 40- or 64-hex), `digestValue` (:348, strict 64-hex lowercased), `integerValue` (:327). So the recommended approach for the new durable authorization + adapter-acknowledgment decoders is to **share `decodeMutableBinding` via `...binding` spread** (mirroring how `decodeLocalEvidenceBinding` is spread), giving all identity-bearing v2 contracts one canonical tuple.

---

### 3. Existing v2 decoders + fail-closed prologue pattern

**Exported `decode*` / decoder functions in `protocol-v2.js`** (all `export function` unless noted):

| Line | Export | Notes |
|---|---|---|
| :494 | `decodePromptProfileBinding(value, field="promptProfile")` | referenced vs handler-managed union |
| :595 | `decodeSourceContract(value)` | standalone \| managed |
| :669 | `decodeCandidatePreflight(value)` | side-effect-free preflight |
| :763 | `decodeCandidateOptionsResponse(value)` | catalog view, attempt-forbidden |
| :806 | `decodeReviewOutcomes(value)` | |
| :947 | `decodeQuarantineStatus(value)` | **reference pattern** |
| :1002 | `decodeClearanceRequest(value)` | **reference pattern** (recursive identity+authority rejection) |
| :1035 | `decodeClearanceResponse(value)` | **reference pattern** |
| :1118 | `decodeSelfReportedUsage(value, field="usage")` | advisory, non-authoritative |
| :1182 | `decodeLocalAttestationRequest(value)` | |
| :1211 | `decodeLocalReviewAuthorization(value)` | **authorization pattern** — spreads `...binding`, derives `attemptToken` |
| :1258 | `decodeLocalReviewReceipt(value)` | **receipt pattern** — spreads `...binding`, `Object.freeze`s output |
| :1292 | `decodeLocalAttestationStatus(value)` | |
| :1324 | `decodeCheckProjection(value)` | |
| :1351 | `authorizeProjectionWrite(previous, next, {authorizedAttemptToken})` | compare-and-swap |
| :1397 | `decodeSetupDiscoveryV2(value)` | |
| :1470 | `decodeReviewerPlanSource(value)` | |
| :1504 | `decodeReviewerCatalog(value)` | |
| :1651 | `compileReviewerPlan({source,catalog,headSha,compiledDigest,overrides})` | pure compile → frozen parent+child ids |
| :1713 | `decodeReviewerPlanOptions(value)` | |
| :1757 | `assertReviewerSelectionLabel(value, field)` | |
| :1774 | `decodeHistoricalV1Receipt(value)` | read-only v1 bridge |
| :1781 | `assertV2DispatchSelector(value, field)` | |

Non-decoder exports: `stableV2Json` (:439), `deriveV2Fingerprint(fields)` (:449), `boundedOutput(value, allowedKeys)` (:455), plus frozen vocab constants (`PROMPT_PROFILE_MODES` :47, `REVIEW_LANES` :61, `OUTCOME_REASON_CODES` :131, `QUARANTINE_STATUS_STATES` :883, `CLEARANCE_DECISIONS` :886, etc.).

**Fail-closed prologue pattern** (the invariant every top-level decoder opens with — see `decodeQuarantineStatus` :947-951, `decodeSourceContract` :595-599, `decodeReviewerCatalog` :1504-1508):
1. `rejectForbiddenFields(value, "<contractName>"[, extraForbiddenSet])` — recursive walker at `:228`. Walks the whole tree (WeakSet cycle guard, `MAX_NESTING_DEPTH` limit), normalizes each key via `key.toLowerCase().replace(/[^a-z0-9]/gu, "")`, and throws `"<field>.<key> is forbidden by the v2 privacy boundary"` if it hits `FORBIDDEN_FIELD_NAMES` (:168 — prompt/prompts/promptbody/profilebody/configuration/config/source/path/file/finding/transcript/credential/secret/token/apikey/balance/output/content/artifact, singular+plural) or a caller-supplied `extraForbidden` set. Also enforces JSON-values-only and plain-object-only.
2. `assertEncodedSize(value, "<contractName>", CONTRACT_MAX_BYTES)` — `:283`. `CONTRACT_MAX_BYTES = 16*1024` (:20); `RESPONSE_MAX_BYTES = 32*1024` (:21) used by catalog/options views.
3. `const x = objectValue(value, "<contractName>")` (:221) then `schemaVersion(x.schemaVersion, "<contractName>.schemaVersion")` (:341) — must equal `PROTOCOL_V2_SCHEMA_MAJOR = 2` (:16).

**Normalize / freeze / return**: decoders build a fresh `normalized` object with only allow-listed keys (never spread raw input except vetted sub-bindings), append an identity fingerprint via `deriveV2Fingerprint({...})` (canonical sha256 over sorted keys — `canonicalize` :428, `sha256` :443), then `return Object.freeze(normalized)`. See `decodeQuarantineStatus` :969-996 (conditional field + `statusFingerprint` + freeze) and `decodeLocalReviewReceipt` :1276-1287 (`Object.freeze({schemaVersion, ...binding, ...})`). Some views intentionally do NOT freeze (`decodeLocalReviewAuthorization` returns unfrozen at :1242 because it derives `attemptToken`; `decodeCheckProjection` :1330 unfrozen).

**Extra-forbidden sets to mirror**: `AUTHORITY_FORBIDDEN_FIELD_NAMES` (:895 — authorization/authorized/lease/budget/capacity/reservation/dispatch/quota…) is passed as the 3rd arg to `rejectForbiddenFields` on quarantine/clearance so those contracts adjudicate eligibility only and never mint budget/dispatch authority. A durable receipt/authorization decoder that must not mint budget authority should reuse this set. `REQUEST_DERIVED_FORBIDDEN` (:1163) blocks caller-asserted GitHub identity (actor/association/publisher/workflow/runId/authorization/trustLevel).

---

### 4. Prompt-profile handling

**Union model** — `decodePromptProfileBinding(value, field="promptProfile")` at `:494`:
- Modes vocabulary: `PROMPT_PROFILE_MODES = Object.freeze(["referenced", "handler-managed"])` (:47), set `PROMPT_PROFILE_MODE_SET` (:48).
- **Rejects (never strips)** `default`, `inheritance`, `fallback`, `commandOverride`, `runtimeOverride` for BOTH arms (:499-503). This is the "core already rejects default/inheritance/fallback/override fields" the prd references.
- `handler-managed`: forbids `alias`/`version`/`digest`, returns `{ mode }` (:505-512).
- `referenced`: returns `{ mode, alias, version, digest }` where `alias`=`aliasValue` (:364, `[A-Za-z0-9][A-Za-z0-9._-]*` lower, max 64), `version`=`semverLikeValue` (:360, `N.N.N`), `digest`=`digestValue` (64-hex) (:513-518).

**Where consumed**: `decodeStandaloneRoute` direct-handler route (:557), `decodeManagedLane` candidate (:587-590). Also `decodeCandidatePreflight` carries a flat `promptProfileDigest` (:714).

**"shared vs candidate-specific" and "digest-mismatched" references** — existing fixture shapes to model against:
- `fixtures/protocol/v2/prompt-profile-registry.valid.json` — array of immutable profile metadata `{alias, version, digest, compatibleHandlers[], capabilities[]}`, already includes shared (`thorough-shared`) vs specific (`gate-specific`) entries.
- `fixtures/protocol/v2/routed-review-handler-profiles.valid.json` — `{schemaMajor:2, handlers:[{handler, promptProfile:{mode:"referenced", alias, version, digest}}, {handler, promptProfile:{mode:"handler-managed"}}]}`.
- A **digest-mismatched** reference = a `referenced` binding whose `{alias,version}` matches a registry entry but whose `digest` differs; **missing/unknown/incompatible** = alias absent from the registry / not in `compatibleHandlers`. These residual cases (parent AC2) are what the new catalog/compiled/authorization/receipt fixtures must add — the core already proved the referenced-vs-handler-managed union and default/inheritance/fallback/override rejection.

---

### 5. Receipt schema gaps

There is **no v2 receipt in `protocol-v2.js`** carrying retention lifecycle. `src/receipt.js` is v1 GitHub-check text only. The retention field vocabulary the immutable per-attempt receipt must carry ALREADY EXISTS in `src/retention-policy.js` (schema major 2) and should be mirrored/embedded:

- **Retention policy ID/version/digest** — `decodePolicyBinding(source, field, {requireDigestMatch})` at `:614`: `{ retentionPolicyId: aliasValue, version: semverLikeValue, digest: digestValue }`; with `requireDigestMatch` the `standard-v1` binding must match `STANDARD_V1.version`/`.digest` (:618-622). `STANDARD_V1` constant at `:541`.
- **Data class** — `RETENTION_DATA_CLASSES` (:36): prohibited_content, operational_state, deferred_review, budget_observation, bounded_event, adjudication_chain, catalog_policy_version, static_prompt_profile, anonymous_aggregate, backup. Single-class only (a `dataClasses`/`secondaryDataClass` set fails closed — `decodeRecordClassification` :637-641).
- **Lifecycle** — `RETENTION_LIFECYCLE_STATES` (:51): active, terminal, compacted, deleted, purge_pending, live_deleted, backup_expired.
- **Deletion state** — `DELETION_STATUSES` (:90): not_requested, purge_pending, live_deleted, backup_expired, complete.
- **Hold state** — `LEGAL_HOLD_STATES` (:82): active, released, expired, renewed. In `decodeRetentionStatus` the projected form is `legalHold {held: boolean, expiresAt?}` (:1041-1049) — `expiresAt` valid only when `held`.
- **Retained-until** — `retainedUntil` in `decodeRetentionStatus` (:1071-1076): may be `null` (indefinitely retained referenced version or currently held) else an ISO timestamp.
- **Coverage window** — `coverageStart` (required) + optional `coverageEnd` (:1057-1069); `coverageEnd` must not precede `coverageStart`.

**Reference decoder that already assembles all of these into one frozen record**: `decodeRetentionStatus` (`src/retention-policy.js:1032-1084`) — it is the closest existing template for the receipt's retention-bearing section (policy binding + dataClass + lifecycleState + deletionStatus + legalHold + coverageStart/End + retainedUntil + optional `lastDeletion {deletionReceiptDigest, deletedAt}`, all `Object.freeze`d). The new v2 receipt = `decodeMutableBinding` identity tuple + this retention field set + `schemaVersion` + a `receiptFingerprint` via `deriveV2Fingerprint`, all with the fail-closed prologue and no private content.

---

### 6. Fixture conventions

**Loader** (identical in both test files) — `test/retention-policy.test.js:27-30`, `test/protocol-v2.test.js:41-44`:
```js
async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));   // import { readFile } from "node:fs/promises"
}
const validX   = await fixture("protocol/v2/<name>.valid.json");
const invalidX = await fixture("protocol/v2/<name>.invalid.json");
```

**Invalid driver** — `test/retention-policy.test.js:62-66`:
```js
function eachInvalid(entries, decode) {
  for (const entry of entries) {
    assert.throws(() => decode(entry.value), new RegExp(entry.error, "u"), entry.name);
  }
}
```

**JSON entry shapes** (arrays of objects):
- valid entry: `{ "name": "<description>", "value": { ...decodable payload... } }` (e.g. `retention-coverage.valid.json`).
- invalid entry: `{ "name": "<description>", "error": "<regex substring of thrown message>", "value": { ...payload... } }` (e.g. `retention-coverage.invalid.json`). The `error` string is compiled as a `RegExp` and must match the decoder's thrown message — so error strings in new decoders and fixtures must agree.
- Some fixtures are single-object-wrapped and dereferenced with `[0].value` (e.g. `reviewerCatalog = (await fixture("protocol/v2/reviewer-catalog.valid.json"))[0].value` — `test/protocol-v2.test.js:62`).

**Pairing convention**: every decoder gets a `<name>.valid.json` whose every entry must decode, plus a `<name>.invalid.json` whose every entry must throw a message matching its `error`. Valid tests typically iterate and assert `decode(entry.value)` does not throw / matches expected normalized output; invalid tests use `eachInvalid`. Privacy fixtures (e.g. `privacy-fields.invalid.json`, `retention-privacy-fields.invalid.json`) are invalid-only, one entry per forbidden field name, proving the walker rejects prompt/config/content/etc. Fake-clock fixtures exist (`catalog-retention.fake-clock.json`) for time-dependent lifecycle.

For this task the new fixtures land in `fixtures/protocol/v2/` and follow the same pairing (e.g. a per-attempt receipt `*.valid/invalid.json`, safe-catalog/compiled projection pairs, durable authorization + adapter-acknowledgment pairs, a cross-contract identity matrix, and the residual prompt-profile pairs for shared/candidate-specific/missing/unknown/incompatible/digest-mismatched).

---

### 7. Coverage / gate specifics

**Coverage floors** — `scripts/check-coverage.mjs`, run via `npm run test:coverage`:
- Global floor (`GLOBAL_FLOOR`, :29): `{ lines: 88, branches: 77, functions: 88 }`.
- Per-file floors (`FILE_FLOORS`, :31-41) exist only for `src/index.js` and the consumer-installer scripts; there is **no** dedicated per-file floor for `src/protocol-v2.js` or `src/retention-policy.js` — they are held to the global floor. Metrics checked: `lines`, `branches`, `functions` (:85). The script fails if the underlying test run failed (:96-98).

**Full gate command set** — `package.json` scripts:
- `check` (:12) — `node --check` syntax pass over every `src/*.js` (incl. `protocol-v2.js`, `retention-policy.js`, `receipt.js`) and every `scripts/*.mjs`. **Any new source file must be added to this `node --check` chain.**
- `test` (:16) — `node --test`.
- `test:coverage` (:17) — `node scripts/check-coverage.mjs`.
- `validate:metadata` (:13) — `node scripts/validate-action-metadata.mjs`.
- `validate:ci-parity` (:15) — `node scripts/validate-ci-parity.mjs`.
- `check:full` (:18) — `npm test && npm run test:coverage && npm run check && npm run validate:metadata && npm run validate:ci-parity && … sd-ai-command-pack-full-check.sh`.

AC5 gate line = "npm test, syntax check, metadata + ci-parity validation, coverage gate green" maps to `npm run check:full`.

## Caveats / Not Found

- The active-task resolver (`task.py current`) reports a different, stale task (`08-05-guard-v2-fingerprint-identity-completeness`); I wrote to the task dir named in the task brief (`08-04-define-v2-receipt-and-identity-contracts`) as instructed.
- The "adapter-acknowledgment" contract has no existing decoder or fixture; it is net-new (no prior signature to anchor to beyond the shared identity tuple + fail-closed prologue conventions above).
- `decodeMutableBinding` performs no prologue/freeze itself — confirm the design has exactly one top-level decoder own `rejectForbiddenFields`/`assertEncodedSize`/`schemaVersion` when spreading it, to avoid a binding used without the boundary.
- Retention lifecycle fields live in `retention-policy.js` (its own `RETENTION_SCHEMA_MAJOR`/helpers), not `protocol-v2.js`; the design must decide whether the receipt imports `decodePolicyBinding` etc. from `retention-policy.js` or re-declares mirrored validators in `protocol-v2.js`. Both modules define their own private `rejectForbidden*`/`assertEncodedSize`/`digestValue` — they are not currently shared.
