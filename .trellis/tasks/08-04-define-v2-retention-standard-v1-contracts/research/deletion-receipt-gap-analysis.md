# Research: deletion-receipt decoder + residual retention fixture gaps

- **Query**: Gap analysis for `decodeDeletionReceipt` + 4 missing fixture families (task 08-04-define-v2-retention-standard-v1-contracts)
- **Scope**: internal
- **Date**: 2026-08-05

All line citations are against the merged 07-25 code as it exists now.

---

## 0. Files In Scope

| File Path | Role |
|---|---|
| `src/retention-policy.js` (1312 lines) | The single module that owns every `decode*` + digest helper. New decoder is added here. |
| `test/retention-policy.test.js` (739 lines) | Node built-in `test` suite; fixture loader + `eachInvalid` iteration live here. |
| `fixtures/protocol/v2/retention-*.json` | 8 existing fixture files (enumerated in §4). New fixtures land here. |
| `.trellis/tasks/archive/2026-08/07-25-define-review-data-retention-policy/design.md` | The retention design that governs the deletion-receipt/journal/purge semantics. |
| `.trellis/tasks/archive/2026-08/07-25-define-budget-review-v2-contracts/design.md` | The named dependency shared v2 design (§7). |

No fixture manifest / registry exists — fixtures are wired only by explicit `await fixture(...)` calls in the test file (see §6). A new fixture family is picked up ONLY when the test file adds a loader line + a test; nothing auto-discovers `fixtures/protocol/v2/*.json`.

---

## 1. Decoder Conventions in `src/retention-policy.js` (the shared shape every `decode*` follows)

Every public decoder in this module follows the SAME opening ritual, in this order. Reference implementations: `decodeRetentionProfile` (541), `decodeLegalHold` (708), `decodeRetentionStatus` (1020), `decodePurgeRequest` (1175), `decodeRepositoryLifecycleEvent` (1270).

**Canonical decoder prologue (copy this order):**
1. `rejectForbiddenContent(value, "<field>")` — privacy walker, FIRST, before anything else. E.g. line 1176, 709, 1021, 1271.
2. `assertEncodedSize(value, "<field>", CONTRACT_MAX_BYTES)` — 16 KiB for contracts (`CONTRACT_MAX_BYTES`, line 22); `RESPONSE_MAX_BYTES` = 32 KiB (line 23) is used for the report only (line 1075).
3. `const x = objectValue(value, "<field>")` — plain-object assertion (198-203).
4. `schemaVersion(x.schemaVersion, "<field>.schemaVersion")` — see below.
5. Field-by-field validation via the primitive validators.
6. Return `Object.freeze({ ... })` — every decoder returns a frozen object; nested objects are individually frozen too (e.g. 526, 578, 597, 1219, 1226).

### schemaVersion assertion
- Function: `schemaVersion(value, field)` (333-338).
- Constant: `RETENTION_SCHEMA_MAJOR = 2` (18).
- Error string: `` `${field} must use supported schema major ${RETENTION_SCHEMA_MAJOR}` `` (335).
- **Field-name convention is inconsistent and is a decision point for the new decoder:** the *profile* uses `schemaMajor` (line 545, and the returned object re-emits `schemaMajor`), but every *envelope* decoder uses `schemaVersion` (legalHold 712, retentionStatus 1024, purgeRequest 1179, repositoryLifecycleEvent 1274). A deletion-receipt is an envelope → **use `schemaVersion`** to match its siblings.

### Object.freeze pattern
- Top-level: `return Object.freeze({ ...body })`.
- Nested frozen objects: `deletionReceipt: Object.freeze({...})` (1219), `githubNativeArtifacts: Object.freeze({...})` (1226), per-class rules `Object.freeze({ ...rule })` (524). Any nested object the new decoder emits (a nested `deletionReceipt` or `githubNativeArtifacts`) must itself be `Object.freeze`d, matching `decodePurgeRequest`.

### Digest helpers
- `stableRetentionJson(value)` (414-416) — `JSON.stringify(canonicalize(value))`. `canonicalize` (403-412) recursively sorts object keys and drops `undefined`.
- `deriveRetentionDigest(fields)` (424-426) — `sha256(canonicalize(fields))`; **this is the ONLY digest minting entry point.** Reordered-equivalent input → same 64-hex digest.
- `digestValue(value, field)` (340-342) — validates a digest STRING: `stringValue` with `maximum: 64`, `pattern: /^[a-fA-F0-9]{64}$/u`, `lower: true`. So all digest fields are lowercased 64-hex on decode.
- `sha256` (418-420) is private; callers always go through `deriveRetentionDigest`.

### enum helper + frozen enum Sets
- `enumValue(value, field, allowed)` (304-310): runs `stringValue` (128-byte max) then `allowed.has(normalized)`. Error: `` `${field} must be one of: ${[...allowed].join(", ")}` `` (307).
- Declaration idiom: an exported frozen array + a private Set built from it. Pattern repeated for every vocabulary:
  - `RETENTION_DATA_CLASSES` (36) → `RETENTION_DATA_CLASS_SET = new Set(...)` (48).
  - `RETENTION_LIFECYCLE_STATES` (51) → `RETENTION_LIFECYCLE_STATE_SET` (60).
  - `LEGAL_HOLD_STATES` (82) → `LEGAL_HOLD_STATE_SET` (88).
  - `DELETION_STATUSES` (90-97) → `DELETION_STATUS_SET` (97). **This is the enum the deletion-receipt's `deletionStatus` must draw from.** Members: `not_requested`, `purge_pending`, `live_deleted`, `backup_expired`, `complete`.
  - `REPOSITORY_LIFECYCLE_KINDS` (99-106) → `REPOSITORY_LIFECYCLE_KIND_SET` (106).

### Privacy / forbidden-field validation (the walker)
- There IS a general walker: `rejectFieldNames(value, field, forbidden, boundaryLabel)` (207-256). Iterative (explicit stack), `WeakSet` cycle guard, enforces `MAX_NESTING_DEPTH = 32` (27), rejects non-JSON scalars, and normalizes each key via `key.toLowerCase().replace(/[^a-z0-9]/gu, "")` (245) before membership test. On a hit: `` `${current.field}.${key} is forbidden by the ${boundaryLabel}` `` (247) — it NEVER echoes the value (only the field path + boundary label).
- Two bound wrappers:
  - `rejectForbiddenContent(value, field)` (259-261) → forbidden set `FORBIDDEN_CONTENT_FIELDS` (112-156), boundary label **"retention privacy boundary"**. Use this in the deletion-receipt decoder.
  - `rejectIdentifyingFields(value, field)` (264-266) → `IDENTIFYING_FIELDS` (160-177), boundary label **"retention anonymization boundary"** (only used for anonymous aggregates + static profiles; NOT needed for a receipt, which legitimately carries tenant/repository/actor).
- Authority-forbid pattern (distinct, purge-only): `PURGE_FORBIDDEN_AUTHORITY` array (181-188) + explicit loop (1180-1184) with error `` `purgeRequest.${forbidden} is forbidden; a purge never grants ledger, dispatch, or recovery authority` ``. Relevant to the "destructive-authorization" fixtures (§5).

### Other primitives the new decoder will reuse
`stringValue` (283), `timestampValue` (352-361, ISO-8601 UTC, error `must be an ISO-8601 UTC timestamp`), `optionalTimestamp` (363), `aliasValue` (348, `[A-Za-z0-9][A-Za-z0-9._-]*`, lowercased), `repositoryValue` (385-399, `{owner,name}`), `trueValue` (326-331, `must be explicitly true`), `enumValue`, `digestValue`.

---

## 2. The ALREADY-EXISTING embedded deletion receipt (`decodePurgeRequest`, lines 1175-1232)

`decodePurgeRequest` mints — it does NOT decode — a receipt. Two nested shapes exist here and BOTH matter for reconciliation:

### (a) The digest source (1195-1204)
```js
const deletionReceiptDigest = deriveRetentionDigest({
  tenant, repository, actor, reason, requestId, requestedAt,
});
```
Derived over the **authorized identity**: `{tenant, repository, actor, reason, requestId, requestedAt}`. Comment (1195-1196): "deterministic over the authorized identity: an idempotent replay of the same request reproduces the same receipt." This is exactly what "idempotent" means here — same authorized identity in ⇒ same digest out; the test at 435-441 asserts replay-equal and that a changed `requestId` changes the digest.

### (b) The emitted top-level purge result (1205-1231) includes:
`schemaVersion:2`, `authorization:{tenant,repository}`, `actor`, `reason`, `requestId`, `confirmed:true`, `requestedAt`, `liveDeletionDeadline` (= `addDays(requestedAt, 7)`, line 1193), `backupPurgeDeadline` (= `addDays(requestedAt, 35)`, line 1194), `deletionStatus:"purge_pending"` (1215), three `grants*Authority:false` flags (1216-1218), a nested `deletionReceipt` (1219-1225), and `githubNativeArtifacts` (1226-1230).

### (c) The nested `deletionReceipt` envelope (1219-1225) — **THE shape a standalone decoder must decode:**
```js
deletionReceipt: Object.freeze({
  deletionReceiptDigest,   // 64-hex, derived from authorized identity (a)
  requestId,               // 64-hex digest
  requestedAt,             // ISO-8601 UTC
  liveDeletionDeadline,    // requestedAt + 7d
  backupPurgeDeadline,     // requestedAt + 35d
})
```

### (d) A THIRD, thinner receipt reference: `retentionStatus.lastDeletion` (1060-1066)
```js
lastDeletion: {
  deletionReceiptDigest: digestValue(...),  // 64-hex
  deletedAt: timestampValue(...),           // ISO-8601 UTC
}
```
Note this carries `deletedAt` (an OUTCOME timestamp) that the minted nested receipt (c) does NOT have. The design (below) says deletion is an *outcome* that "appends a minimal deletion receipt" — so a standalone deletion-receipt envelope is conceptually the (c) shape PLUS an outcome (`deletedAt` and/or `deletionStatus` progressing past `purge_pending`).

### Design constraints (sibling `07-25-define-review-data-retention-policy/design.md`)
- L51: "Deletion appends a minimal deletion receipt and updates coverage metadata." L67-70: purge "returns progress plus a final deletion receipt. Live data must be removed within seven days. Backups expire within 35 days; every restore replays the deletion journal before serving reads."
- L24: deletion evidence is an immutable bounded event, 13-month retention.

---

## 3. `authorizeRestoreReads` + deletion-journal replay (1246-1261)

Contract (comment 1246-1248): "A restore may serve reads only after it replays the deletion journal, and only from a backup within the 35-day hard maximum. Neither path can rehydrate purged data."

- Input `restore` object (`objectValue`, 1250). Required fields:
  - `backupCreatedAt` — `timestampValue` (1251).
  - `restoredAt` — `timestampValue` (1252).
  - `deletionJournalReplayed` — must be `=== true` (1257), else throw.
- Deadline: `backupDeadline = addDays(backupCreatedAt, profile.backupHardMaxDays)` (1253); `profile` defaults to `STANDARD_V1` (`backupHardMaxDays = 35`, line 507/518).
- Error strings (exact):
  - `` `restore rejected: the backup exceeded the ${profile.backupHardMaxDays}-day hard maximum` `` (1255) when `restoredAt > backupDeadline`.
  - `"restore must replay the deletion journal before restored data becomes queryable"` (1258) when `deletionJournalReplayed !== true`.
- Returns `Object.freeze({ queryable: true, backupDeadline, restoredAt })` (1260).
- Tests: 466-501. Message is profile-derived (asserted with `backupHardMaxDays: 10` override at 493-500), so the **"deletion-journal restore" fixtures must exercise both failure edges + the happy path**, parameterizing on profile where the message asserts the day count.
- Note: `authorizeRestoreReads` takes `(value, profile)` and does NOT do `rejectForbiddenContent`/`schemaVersion`/`assertEncodedSize` — it is a lighter helper, not a full envelope decoder. Restore has no `schemaVersion` field today.

---

## 4. Repository lifecycle transfer/removal + existing fixtures inventory

### `decodeRepositoryLifecycleEvent` (1270-1312) / `REPOSITORY_LIFECYCLE_KINDS` (99-106)
Kinds: `uninstall`, `removal`, `transfer_same_tenant`, `transfer_cross_tenant`, `authorized_purge`.
Derived flags (1278-1287): `stopsCollection` (true unless a transfer), `purges` (true iff `authorized_purge`), `marksInactive` (true iff `removal`), `retentionContinues` (true iff uninstall|removal).
Per-kind required fields + error strings:
- `transfer_same_tenant`: `revalidatedRepositoryIdentity` must be true — `must be explicitly true` (1289 via `trueValue`); sets `crossesTenant:false`.
- `transfer_cross_tenant`: `destinationTenant` (aliasValue, 1294) must differ from `tenant` else `"repositoryLifecycleEvent cross-tenant transfer must name a distinct destination tenant"` (1296); `destinationAuthorization` true (1298) + `policyRevalidated` true (1299) both via `trueValue` (`must be explicitly true`); sets `crossesTenant:true`, `reassignsHistoricalAuthority:false` (1306).
- `authorized_purge`: requires `purgeRequestId` (digestValue, 1309).

### Existing `fixtures/protocol/v2/retention-*.json` (8 files)
| Fixture | Shape | Decoder exercised |
|---|---|---|
| `retention-standard-v1.json` | single object | `decodeRetentionProfile` |
| `retention-status.valid.json` | array of `{name,value}` | `decodeRetentionStatus` |
| `retention-status.invalid.json` | array of `{name,error,value}` | `decodeRetentionStatus` |
| `retention-purge.valid.json` | array (1 entry) | `decodePurgeRequest` |
| `retention-purge.invalid.json` | array (4 entries) | `decodePurgeRequest` |
| `retention-legal-hold.valid.json` | array (3 entries) | `decodeLegalHold` |
| `retention-legal-hold.invalid.json` | array (5 entries) | `decodeLegalHold` |
| `retention-privacy-fields.invalid.json` | object `{contentFields[],identifyingFields[]}` | privacy loops |

### Coverage of the 4 required NEW fixture families — de-dup analysis
| Required family | Already covered? | Genuine net-new gap |
|---|---|---|
| **destructive-authorization** | PARTIAL. `retention-purge.{valid,invalid}` already exercise confirmation (`confirmed` must be true) + the `PURGE_FORBIDDEN_AUTHORITY` boundary (invalid entry "purge attempting to grant recovery authority"). `decodeRepositoryLifecycleEvent(authorized_purge)` has NO fixture (it's tested inline only for uninstall/removal/transfers, 505-582). | The authorization-to-destroy path via `authorized_purge` repository-lifecycle events (missing `purgeRequestId`, etc.) is unfixtured; and there is no *dedicated* named "destructive-authorization" fixture that ties purge-confirmation + forbidden-authority into one family. See §5. |
| **transfer/removal** | NOT fixtured as JSON. `decodeRepositoryLifecycleEvent` is tested only with inline object literals (505-582). No `retention-lifecycle*.json` file exists. | Entire family is net-new: valid `uninstall/removal/transfer_same_tenant/transfer_cross_tenant/authorized_purge` + invalids (missing revalidation, same dest tenant, missing dest auth/policy-revalidated, missing purgeRequestId). |
| **deletion-journal restore** | NOT fixtured. `authorizeRestoreReads` tested only inline (466-501). No `retention-restore*.json`. | Net-new: valid replayed-in-window restore + invalids (journal not replayed, backup past 35-day max). Message asserts profile day-count. |
| **coverage-gaps** | PARTIAL. `summarizeCoverage` + `coverageGaps` are exercised inline in `decodeRetentionStatusReport` test (596-639) and `summarizeCoverage` test (643-653). No standalone `retention-coverage*.json`. | Net-new: a fixture family for non-partitioning denominators (`must partition the eligible denominator exactly`) + lost-evidence (`complete:false`) cases, and/or report-level `coverageGaps` entries. Confirm with planner whether this decodes via `summarizeCoverage`/`decodeRetentionStatusReport` (no new decoder needed) — it does NOT need a new decoder. |

---

## 5. What is "destructive-authorization" in this codebase?

There is no literal `destructive` identifier in `src/`; the ONLY occurrence is the sibling design L67: "`purge_repository_data` is idempotent and **destructive**. It requires explicit confirmation…". So "destructive-authorization" = **the authorization required to run a destructive (deletion) operation**, expressed in TWO existing places:

1. **`decodePurgeRequest` (1175-1232)** — the authorization envelope for destruction:
   - `authorization: {tenant, repository}` required (1185-1187).
   - `actor` + `reason` required (1188-1189).
   - `requestId` (idempotency key) required (1190).
   - `confirmed` must be `=== true` (1191, error `purgeRequest.confirmed must be explicitly true`).
   - `PURGE_FORBIDDEN_AUTHORITY` (181-188): the request may NOT carry `ledgerAuthority`, `dispatchAuthority`, `recoveryAuthority`, `grantLedger`, `grantDispatch`, `grantRecovery` — enforced 1180-1184. Emitted result hard-codes `grants*Authority:false` (1216-1218). i.e. authorization to DELETE never escalates into authorization to LEDGER/DISPATCH/RECOVER.
2. **`decodeRepositoryLifecycleEvent` kind `authorized_purge` (1308-1310)** — carries a `purgeRequestId` binding the lifecycle event back to an authorized purge; `purges:true` (1284).

**Contract the destructive-authorization fixtures must exercise:** explicit confirmation is mandatory; tenant+repository+actor+reason+requestId identity is mandatory; the six forbidden authority-grant fields are each rejected; and the `authorized_purge` lifecycle event must name a valid `purgeRequestId`. The idempotency guarantee (same identity → same `deletionReceiptDigest`) is the bridge to the new `decodeDeletionReceipt`.

---

## 6. Test wiring (`test/retention-policy.test.js`)

- **Loader** (26-29): `async function fixture(relative)` → `JSON.parse(await readFile(new URL(\`../fixtures/${relative}\`, import.meta.url)))`. Loaded at top-level `await` (31-38), one `const` per fixture file. **A new fixture family requires a new top-level `await fixture("protocol/v2/retention-<x>.{valid,invalid}.json")` line — nothing is auto-discovered.**
- **Valid iteration idiom** (e.g. holds 324-331, statuses 586-594): `for (const entry of validX) { const decoded = decodeX(entry.value); assert.ok(Object.isFrozen(decoded), entry.name); ...domain asserts... }`. Valid fixture entries are `{name, value}`.
- **Invalid iteration idiom**: `eachInvalid(entries, decode)` (51-55):
  ```js
  for (const entry of entries)
    assert.throws(() => decode(entry.value), new RegExp(entry.error, "u"), entry.name);
  ```
  Invalid fixture entries are `{name, error, value}` where `error` is a regex source string matched against the thrown message.
- **Privacy assertion idiom** (681-691): builds `{...base, [field]: "leak-me-please"}` and asserts the throw matches `/retention privacy boundary/u` AND `!error.message.includes("leak-me-please")` — the new decoder MUST preserve non-echoing behavior (inherited free from `rejectForbiddenContent`).
- **Digest constant available in tests:** `STANDARD_V1.digest` (imported line 8) — value `f5eb685c9ef6af284603b74c915db1e3464f0ac17e0f462b74c40b280da65d64` (used in every status fixture). New tests reproduce a deterministic `deletionReceiptDigest` by calling `decodePurgeRequest(validPurges[0].value).deletionReceipt.deletionReceiptDigest`, NOT by hand-coding a hex string — this is the safe way to build a matching valid deletion-receipt fixture without pre-computing sha256 by hand.
- Time helpers in-test: `shift(iso, ms)` (47-49), `DAY_MS`/`HOUR_MS` (40-41), `clone` = `structuredClone` (43-45).

---

## 7. Shared v2 design.md dependency (`07-25-define-budget-review-v2-contracts`)

Located at `.trellis/tasks/archive/2026-08/07-25-define-budget-review-v2-contracts/design.md` (this is the exact dependency named in prd.md L50). Relevant constraints it imposes on any receipt decoder:
- L10-12: "Forbidden-field and size validation happens before canonicalization. Version 1 has a read-only **receipt decoder** and cannot authorize v2 work." → confirms the decode-before-canonicalize + forbidden-field-first ordering the retention module already follows, and that a receipt decoder is read-only (no authority minting).
- L24-25: "Receipts are immutable per attempt … a separate exact-head Check projection carries a monotonic revision and latest-authorized-attempt token." → receipts are immutable; a deletion receipt likewise must be a frozen, immutable projection.
- It does NOT define a `deletionReceipt` schema itself (that lives in the retention design, §2/§3). The retention deletion-receipt contract is governed by the sibling `07-25-define-review-data-retention-policy/design.md`, not this budget one.

---

## 8. RECONCILIATION — where a standalone `decodeDeletionReceipt` could CONTRADICT the shipped embedded receipt

This is the load-bearing risk. There are THREE receipt shapes already in the module and they are NOT field-identical:

| Field | minted nested `deletionReceipt` (1219-1225) | `retentionStatus.lastDeletion` (1060-1066) | authorized-identity digest source (1197-1204) |
|---|---|---|---|
| `deletionReceiptDigest` | yes | yes | (this is the output) |
| `requestId` | yes | no | yes |
| `requestedAt` | yes | no | yes |
| `liveDeletionDeadline` | yes | no | no |
| `backupPurgeDeadline` | yes | no | no |
| `deletedAt` | **no** | **yes** | no |
| `deletionStatus` | no (top-level only, 1215) | no | no |
| `tenant/repository/actor/reason` | **no** | no | **yes** (needed to recompute digest) |

**The contradiction:** the digest is derived from `{tenant, repository, actor, reason, requestId, requestedAt}` (1197-1204), but the minted nested `deletionReceipt` envelope (1219-1225) does NOT carry `tenant/repository/actor/reason`. Therefore a standalone `decodeDeletionReceipt` that receives ONLY the nested-envelope shape **cannot recompute or verify `deletionReceiptDigest`** — it can only treat the digest as opaque. If the new decoder claims to validate idempotency/digest-match while decoding the (c) shape, it will be making a promise it structurally cannot keep — a direct contradiction with the "idempotent deletion outcome envelope with … validation" AC.

**Recommended reconciliation (for design.md):**
- Define the standalone deletion-receipt envelope to carry the FULL authorized identity plus the outcome, i.e. superset that is consistent with all three existing shapes:
  `{ schemaVersion:2, authorization:{tenant,repository}, actor, reason, requestId, requestedAt, deletionStatus (∈ DELETION_STATUSES), liveDeletionDeadline, backupPurgeDeadline, deletedAt?, deletionReceiptDigest }`.
- On decode, **recompute** `deriveRetentionDigest({tenant, repository, actor, reason, requestId, requestedAt})` and require it to equal the supplied `deletionReceiptDigest` — mirroring the digest-match pattern already used by `decodeRetentionProfile` (594-596: `"retentionProfile.digest does not match its canonical content"`). This makes the envelope self-verifying and genuinely idempotent, and keeps it byte-consistent with what `decodePurgeRequest` mints. Reuse the SAME field ordering `{tenant, repository, actor, reason, requestId, requestedAt}` — canonicalization sorts keys, so ordering is safe, but the field SET must match exactly or the digest will differ.
- "Ordering validation" (from the AC): enforce `requestedAt <= liveDeletionDeadline <= backupPurgeDeadline`, and if `deletedAt`/an outcome status is present, `deletedAt >= requestedAt` and consistency with `deletionStatus` progression (`purge_pending` → `live_deleted`/`backup_expired` → `complete`, ordered per the `DELETION_STATUSES` array 90-96). The deadlines should equal `addDays(requestedAt,7)` / `addDays(requestedAt,35)` under `STANDARD_V1` — decide whether to hard-assert equality (like the purge decoder computes them) or only assert ordering; hard-assert is more consistent with `decodePurgeRequest`.
- "Privacy validation": call `rejectForbiddenContent(value, "deletionReceipt")` FIRST (the receipt legitimately carries tenant/repo/actor, so do NOT call `rejectIdentifyingFields`).
- Do NOT let the decoder mint any authority (design L12: read-only). No `grants*` fields; if present, reject or ignore consistent with §5.
- **Alignment nit to flag:** `deletionReceiptDigest` in `retentionStatus.lastDeletion` is validated by `digestValue` (lowercase 64-hex). Keep the new decoder's digest field on the same `digestValue` rule so a receipt digest can round-trip into a status `lastDeletion.deletionReceiptDigest` without re-normalization.

---

## 9. Concrete outputs a planner can lift

### Proposed decoder signature
`export function decodeDeletionReceipt(value)` — same arity/style as `decodeLegalHold`/`decodePurgeRequest` (single arg, `STANDARD_V1` used internally for deadline checks; optionally accept `(value, profile = STANDARD_V1)` like `authorizeRestoreReads`/`assertLivePurgeWithinSla` if deadline equality is asserted).

### Field/validation/error matrix (proposed, consistent with existing conventions)
| Field | Validator | Notes / error source |
|---|---|---|
| (whole) | `rejectForbiddenContent(value,"deletionReceipt")` | `retention privacy boundary`, never echoes |
| (whole) | `assertEncodedSize(value,"deletionReceipt",CONTRACT_MAX_BYTES)` | 16 KiB |
| `schemaVersion` | `schemaVersion(...)` | `must use supported schema major 2` |
| `authorization.tenant` | `aliasValue` | matches purge |
| `authorization.repository` | `repositoryValue` | `{owner,name}` |
| `actor` | `aliasValue` | |
| `reason` | `stringValue(..,{maximum:REASON_MAX_BYTES})` | 512 |
| `requestId` | `digestValue` | 64-hex |
| `requestedAt` | `timestampValue` | ISO-8601 UTC |
| `deletionStatus` | `enumValue(..,DELETION_STATUS_SET)` | `must be one of: not_requested, ...` |
| `liveDeletionDeadline` | `timestampValue` + order check | `requestedAt <= live <= backup` (new error string) |
| `backupPurgeDeadline` | `timestampValue` + order check | |
| `deletedAt` (optional) | `optionalTimestamp` + `>= requestedAt` | present when status past `purge_pending` |
| `deletionReceiptDigest` | `digestValue` + **recompute-and-compare** | new error e.g. `deletionReceipt.deletionReceiptDigest does not match its canonical content` (mirror 595) |
| return | `Object.freeze({...})` | frozen, incl. nested `authorization` |

### Ordered implement steps (for implement.md)
1. Add `decodeDeletionReceipt` to `src/retention-policy.js` in the "purge + deterministic deletion receipt" section (after `decodePurgeRequest`, ~1232), reusing existing helpers; export it.
2. Add fixtures: `fixtures/protocol/v2/retention-deletion-receipt.valid.json` + `.invalid.json` (arrays; valid `{name,value}`, invalid `{name,error,value}`). Build the valid digest by mirroring `deriveRetentionDigest({tenant,repository,actor,reason,requestId,requestedAt})` — in the TEST, derive it from `decodePurgeRequest(...).deletionReceipt.deletionReceiptDigest` so the fixture stays in lock-step.
3. Add fixtures for the other 3 families (see §4 gap column): `retention-lifecycle.{valid,invalid}.json` (transfer/removal + authorized_purge → `decodeRepositoryLifecycleEvent`), `retention-restore.{valid,invalid}.json` (→ `authorizeRestoreReads`), `retention-coverage.{valid,invalid}.json` (→ `summarizeCoverage`/`decodeRetentionStatusReport`; NO new decoder). "destructive-authorization" is satisfied by the `authorized_purge` lifecycle invalids + reusing/extending purge invalids per §5.
4. Wire each into `test/retention-policy.test.js`: one `await fixture(...)` line per file, valid loop with `Object.isFrozen`, invalid via `eachInvalid`.
5. Run `npm test` + syntax + metadata/ci-parity + coverage gate (prd AC L46).

---

## Caveats / Not Found

- **No fixture manifest/registry** exists; I confirmed fixtures are referenced only by explicit loader lines in `test/retention-policy.test.js` (grep of `protocol/v2` across `scripts test` returned only test files). If "metadata + ci-parity validation" (prd L46) enforces a fixture allow-list somewhere, I did not find it under `scripts/`; the planner should confirm what the ci-parity step actually checks before assuming new `.json` files are auto-validated.
- I did NOT run the test suite; all behavior is read from source. The digest constant `f5eb685c...d64` is taken verbatim from `retention-standard-v1.json` and matches `STANDARD_V1.digest` per test line 72 assertion — not independently recomputed here.
- The exact field set / naming for the new deletion-receipt envelope is a DESIGN decision (§8 recommends a superset). The AC says "matching existing decoder conventions" but the three existing receipt shapes are not field-identical, so the planner must pick the reconciled shape; I flagged the digest-recompute impossibility as the binding constraint.
- Whether coverage-gaps needs its own decoder: it does not (reuses `summarizeCoverage`/`decodeRetentionStatusReport`). Confirm with the planner that a fixture-only deliverable satisfies that AC bullet.
