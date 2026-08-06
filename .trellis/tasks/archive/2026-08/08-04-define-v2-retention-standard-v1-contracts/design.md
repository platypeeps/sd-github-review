# Design: v2 standard-v1 retention residual contracts

Code-spec for the residual retention deliverables. Builds on the merged 07-25
retention family in `src/retention-policy.js`. Research:
`research/deletion-receipt-gap-analysis.md` (all line cites there).

## 1. Scope / Trigger

Cross-layer contract change (new wire decoder + fixture matrix). Two AC
deliverables remain after 07-25 shipped the bulk of `standard-v1`:

1. A standalone `decodeDeletionReceipt` decoder — an idempotent deletion
   outcome envelope with privacy + ordering + digest validation.
2. Fixture families still missing after 07-25: destructive-authorization,
   transfer/removal, deletion-journal restore, coverage-gaps.

Out of scope: compiler, transport, storage, workflow. No new authority minting
(shared v2 design: a receipt decoder is read-only).

## 2. Signatures

New export in `src/retention-policy.js`, placed immediately after
`decodePurgeRequest` (~line 1232), in the "purge + deterministic deletion
receipt" section:

```js
export function decodeDeletionReceipt(value)  // profile fixed to STANDARD_V1 internally
```

Single-arg, matching `decodeLegalHold`/`decodePurgeRequest` style. Deadlines are
verified against `STANDARD_V1` (7-day live SLA, 35-day backup hard-max), which
is what `decodePurgeRequest` mints — a single-arg signature keeps the decoder
byte-consistent with the minted envelope and avoids implying a caller can pick a
non-standard profile for a `standard-v1` receipt.

No other decoder is added. The four AC2 fixture families exercise EXISTING
decoders/helpers:
- destructive-authorization → `decodePurgeRequest` (its full authorization
  boundary: `confirmed` required + all six `PURGE_FORBIDDEN_AUTHORITY` denials +
  required tenant/repository/actor/reason/requestId identity). Folding this into
  an `authorized_purge` lifecycle fixture does NOT close the AC:
  `decodeRepositoryLifecycleEvent` validates only a `purgeRequestId`
  (`src/retention-policy.js:1308-1310`) — it never checks confirmation, identity,
  or forbidden authority the way `decodePurgeRequest` does (`:1180-1191`).
- transfer/removal → `decodeRepositoryLifecycleEvent` (incl. the
  `authorized_purge` kind, which binds a `purgeRequestId`).
- deletion-journal restore → `authorizeRestoreReads`
- coverage-gaps → `summarizeCoverage` (NO new decoder — confirmed against
  research §4/§8)

## 3. Contracts

### `decodeDeletionReceipt` input envelope (the reconciled superset)

The nested `deletionReceipt` minted by `decodePurgeRequest` (fields:
`deletionReceiptDigest, requestId, requestedAt, liveDeletionDeadline,
backupPurgeDeadline`) structurally CANNOT self-verify its digest — the digest is
derived over `{tenant, repository, actor, reason, requestId, requestedAt}` which
the nested shape omits. The standalone envelope therefore carries the full
authorized identity plus the outcome, and recomputes-and-compares the digest so
it is genuinely idempotent (mirrors `decodeRetentionProfile` digest-match at
:594-596).

| Field | Type / constraint |
|---|---|
| `schemaVersion` | major 2 (envelope convention — `schemaVersion`, not `schemaMajor`) |
| `authorization.tenant` | alias (`aliasValue`) |
| `authorization.repository` | `{owner,name}` (`repositoryValue`) |
| `actor` | alias |
| `reason` | string ≤ `REASON_MAX_BYTES` (512) |
| `requestId` | 64-hex digest (`digestValue`) |
| `requestedAt` | ISO-8601 UTC (`timestampValue`) |
| `deletionStatus` | enum ∈ `DELETION_STATUSES` |
| `liveDeletionDeadline` | ISO-8601 UTC; MUST equal `addDays(requestedAt, 7)` |
| `backupPurgeDeadline` | ISO-8601 UTC; MUST equal `addDays(requestedAt, 35)` |
| `deletedAt` | OPTIONAL ISO-8601 UTC; required iff status past `purge_pending`; upper bound is status-gated (see §4) |
| `deletionReceiptDigest` | 64-hex; MUST equal `deriveRetentionDigest({tenant,repository,actor,reason,requestId,requestedAt})` |

Additionally, every authority-grant field name is rejected on the receipt —
`rejectForbiddenContent` covers privacy/content keys only, so a separate
deny-list loop (mirroring `src/retention-policy.js:1180-1184`) is required or
authority claims would be silently ignored rather than rejected. The deny-set is
the union of BOTH name forms:
- the six request-form names `decodePurgeRequest` forbids (`PURGE_FORBIDDEN_AUTHORITY`:
  `ledgerAuthority`, `dispatchAuthority`, `recoveryAuthority`, `grantLedger`,
  `grantDispatch`, `grantRecovery`); AND
- the three result-form flags the purge OUTPUT emits as hard-`false`
  (`grantsLedgerAuthority`, `grantsDispatchAuthority`, `grantsRecoveryAuthority`,
  `src/retention-policy.js:1216-1218`) — the receipt envelope never carries these,
  so a supplied `grantsLedgerAuthority:true` must be REJECTED, not dropped.

Compare with normalized keys (`toLowerCase().replace(/[^a-z0-9]/gu,"")`) so
case/separator variants are caught, consistent with the walker at `:245`.

Returns `Object.freeze({ schemaVersion, authorization:{tenant,repository},
actor, reason, requestId, requestedAt, deletionStatus, liveDeletionDeadline,
backupPurgeDeadline, deletedAt?, deletionReceiptDigest })`. `deletedAt` is
emitted only when supplied.

### deletionStatus ↔ deletedAt rule (the "idempotent OUTCOME" semantics)

`DELETION_STATUSES` order: `not_requested`(0) `purge_pending`(1)
`live_deleted`(2) `backup_expired`(3) `complete`(4).

- A deletion receipt is minted for an ACCEPTED purge, so `not_requested` is
  rejected: `deletionReceipt.deletionStatus must be a requested deletion state`.
- `purge_pending`: `deletedAt` MUST be absent (no live deletion has occurred).
- `live_deleted`: `deletedAt` REQUIRED, `deletedAt >= requestedAt`, and
  `deletedAt <= liveDeletionDeadline` (the 7-day live SLA — a live deletion
  recorded after the live deadline would violate the SLA `assertLivePurgeWithinSla`
  enforces at `src/retention-policy.js:1240`).
- `backup_expired` | `complete`: `deletedAt` REQUIRED, `deletedAt >= requestedAt`,
  and `deletedAt <= backupPurgeDeadline` (35-day backup hard-max).

### Prologue ordering (identical to sibling decoders)

1. `rejectForbiddenContent(value, "deletionReceipt")` — FIRST; retention privacy
   boundary; receipt legitimately carries tenant/repo/actor so do NOT call
   `rejectIdentifyingFields`.
2. `assertEncodedSize(value, "deletionReceipt", CONTRACT_MAX_BYTES)` — 16 KiB.
3. `objectValue`, then `schemaVersion`.
4. Field validation in the order above.
5. `Object.freeze` return (nested `authorization` frozen too).

Read-only: the decoder mints no `grants*Authority` fields and asserts none.

### Fixture contracts (JSON, `fixtures/protocol/v2/`)

Valid entries `{name, value}`; invalid entries `{name, error, value}` where
`error` is a regex source matched against the thrown message.

- `retention-deletion-receipt.{valid,invalid}.json` → `decodeDeletionReceipt` (AC1)
- `retention-destructive-authorization.{valid,invalid}.json` → `decodePurgeRequest` (AC2)
- `retention-lifecycle.{valid,invalid}.json` → `decodeRepositoryLifecycleEvent` (AC2)
- `retention-restore.{valid,invalid}.json` → `authorizeRestoreReads` (AC2)
- `retention-coverage.{valid,invalid}.json` → `summarizeCoverage` (AC2)

Five families = ten files.

### Environment keys

None. Pure ESM contract module; no env, network, or storage.

## 4. Validation & Error Matrix

`decodeDeletionReceipt`:

| Condition | Error (regex source) |
|---|---|
| forbidden content field (any nesting) | `retention privacy boundary` (never echoes value) |
| authority-grant field present at ANY nesting depth — request-form (`ledgerAuthority`/`dispatchAuthority`/`recoveryAuthority`/`grantLedger`/`grantDispatch`/`grantRecovery`) OR result-form (`grantsLedgerAuthority`/`grantsDispatchAuthority`/`grantsRecoveryAuthority`), any case/separator variant | `deletionReceipt.<path> is forbidden by the deletion-receipt authority boundary` (recursive walk, so a grant nested under `authorization` fails closed too) |
| oversize (>16 KiB) | existing `assertEncodedSize` message |
| wrong schema major | `must use supported schema major 2` |
| bad tenant/actor alias | existing `aliasValue` message |
| bad repository | existing `repositoryValue` message |
| reason > 512 | existing `stringValue` maximum message |
| bad requestId / digest not 64-hex | existing `digestValue` message |
| bad timestamp | `must be an ISO-8601 UTC timestamp` |
| unknown deletionStatus | `must be one of: not_requested, ...` |
| deletionStatus === not_requested | `deletionReceipt.deletionStatus must be a requested deletion state` |
| liveDeletionDeadline ≠ requestedAt+7d | `deletionReceipt.liveDeletionDeadline must be seven days after requestedAt` |
| backupPurgeDeadline ≠ requestedAt+35d | `deletionReceipt.backupPurgeDeadline must be thirty-five days after requestedAt` |
| deletedAt present while purge_pending | `deletionReceipt.deletedAt is not permitted while the deletion is still pending` |
| deletedAt absent while status past pending | `deletionReceipt.deletedAt is required once the deletion has occurred` |
| deletedAt < requestedAt | `deletionReceipt.deletedAt must not precede requestedAt` |
| deletedAt > liveDeletionDeadline while status === live_deleted | `deletionReceipt.deletedAt must not follow the live deletion deadline` |
| deletedAt > backupPurgeDeadline while status ∈ {backup_expired, complete} | `deletionReceipt.deletedAt must not follow the backup purge deadline` |
| digest mismatch | `deletionReceipt.deletionReceiptDigest does not match its canonical content` |

Restore / lifecycle / coverage fixtures assert the EXISTING error strings
documented in research §3/§4 (e.g. `restore must replay the deletion journal
before restored data becomes queryable`, `cross-tenant transfer must name a
distinct destination tenant`, `must partition the eligible denominator
exactly`). No new error strings for those helpers.

## 5. Good / Base / Bad Cases

`decodeDeletionReceipt`:
- Good: `complete` status, `deletedAt` within window, digest matches → frozen
  echo.
- Base: `purge_pending`, no `deletedAt`, deadlines exactly +7/+35 → frozen echo.
- Bad: digest recomputed from tampered `reason` no longer matches → digest
  mismatch throw; `deletedAt` set on `purge_pending` → pending throw.

## 6. Tests Required (assertion points)

In `test/retention-policy.test.js`:
- One top-level `await fixture("protocol/v2/retention-<x>.{valid,invalid}.json")`
  per new file (nothing auto-discovers fixtures).
- Valid loops: `for (const e of validX) { const d = decodeX(e.value);
  assert.ok(Object.isFrozen(d), e.name); }` plus targeted domain asserts.
- Invalid loops: `eachInvalid(entries, decodeX)`.
- Digest lock-step (CRITICAL): build the valid deletion-receipt fixture's
  `deletionReceiptDigest` in the TEST by deriving it from
  `decodePurgeRequest(validPurges[0].value).deletionReceipt.deletionReceiptDigest`
  (or by constructing the identity and calling the same fields), NOT by
  hand-coding a sha256 — otherwise the fixture rots. Assert one
  `decodeDeletionReceipt(...)` round-trips a purge-minted receipt superset.
- Privacy non-echo: `{...base, prompt:"leak-me-please"}` throws
  `/retention privacy boundary/u` AND `!msg.includes("leak-me-please")`.
- Ordering: assert deadline-mismatch and deletedAt/status invariants each throw.

## 7. Wrong vs Correct

### Wrong
Decode the thin nested `deletionReceipt` shape (no tenant/actor/reason) and
claim digest/idempotency validation — impossible; the digest inputs are absent,
so the decoder would treat the digest as opaque while advertising verification.

### Correct
Envelope carries the full authorized identity superset; decoder recomputes
`deriveRetentionDigest({tenant,repository,actor,reason,requestId,requestedAt})`
and requires equality — self-verifying, idempotent, and byte-consistent with
what `decodePurgeRequest` mints.

## Design decisions

- **Single-arg signature (STANDARD_V1 fixed).** A `standard-v1` receipt has one
  lawful deadline schedule; accepting a `profile` arg would invite decoding a
  standard receipt under non-standard deadlines. `assertLivePurgeWithinSla`
  takes a profile because it is a generic SLA assertion, not a `standard-v1`
  envelope decoder.
- **Hard-assert deadline equality (not just ordering).** `decodePurgeRequest`
  COMPUTES the deadlines; a receipt that merely ordered them could carry a
  fabricated 10-day live deadline. Equality to `addDays(requestedAt,7/35)` binds
  the receipt to the SLA the purge promised.
- **`deletedAt` optional + status-gated.** Preserves the outcome distinction
  research §2(d) flagged: the minted nested receipt has no `deletedAt` (pending),
  `retentionStatus.lastDeletion` does (occurred). The standalone envelope spans
  both by gating `deletedAt` on `deletionStatus`.
