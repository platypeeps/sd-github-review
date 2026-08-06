# Implement: v2 standard-v1 retention residual contracts

Ordered plan. Context order: this file, `design.md`, `prd.md`,
`research/deletion-receipt-gap-analysis.md`. Reuse existing helpers in
`src/retention-policy.js`; do not add new primitives.

## Steps

1. **Add `decodeDeletionReceipt` to `src/retention-policy.js`** (after
   `decodePurgeRequest`, ~line 1232, in the "purge + deterministic deletion
   receipt" section). Follow the design §3 prologue and §4 matrix exactly:
   - `rejectForbiddenContent(value, "deletionReceipt")` FIRST, then
     `assertEncodedSize(value, "deletionReceipt", CONTRACT_MAX_BYTES)`,
     `objectValue`, `schemaVersion`.
   - Authority deny-list: reject any authority-grant field via a normalized
     key check (`key.toLowerCase().replace(/[^a-z0-9]/gu,"")`) against the UNION
     of the six request-form `PURGE_FORBIDDEN_AUTHORITY` names AND the three
     result-form names `grantsLedgerAuthority`/`grantsDispatchAuthority`/`grantsRecoveryAuthority`
     (normalized: `grantsledgerauthority` etc.). Throw `deletionReceipt.<field>
     is forbidden; a deletion receipt never grants ledger, dispatch, or recovery
     authority`. Declare a module-level frozen normalized set (e.g.
     `DELETION_RECEIPT_FORBIDDEN_AUTHORITY`) rather than re-checking raw names —
     `rejectForbiddenContent` covers privacy keys only, so without this a
     `grantsLedgerAuthority:true` would be silently dropped, not rejected
     (`src/retention-policy.js:1216-1218`).
   - Validate `authorization.{tenant,repository}`, `actor`, `reason`,
     `requestId`, `requestedAt`, `deletionStatus`, both deadlines, optional
     `deletedAt`, `deletionReceiptDigest` — feeding the DECODED/normalized locals
     into the digest (aliasValue lowercases, digestValue lowercases), matching
     what `decodePurgeRequest` hashes.
   - Reject `deletionStatus === "not_requested"`.
   - Hard-assert `liveDeletionDeadline === addDays(requestedAt, STANDARD_V1.livePurgeSlaDays)`
     and `backupPurgeDeadline === addDays(requestedAt, STANDARD_V1.backupHardMaxDays)`.
   - Gate `deletedAt` on status (design §3/§4): absent for `purge_pending`;
     required for the rest with `deletedAt >= requestedAt` AND a status-gated
     upper bound — `<= liveDeletionDeadline` for `live_deleted` (7-day live SLA),
     `<= backupPurgeDeadline` for `backup_expired`/`complete`.
   - Recompute `deriveRetentionDigest({tenant,repository,actor,reason,requestId,requestedAt})`
     and require equality with supplied `deletionReceiptDigest` (field SET must
     match the purge minting exactly; canonicalize sorts keys).
   - `return Object.freeze({...})` with nested `authorization` frozen.
   - `export` it.

2. **Fixtures — deletion receipt.** Add
   `fixtures/protocol/v2/retention-deletion-receipt.valid.json` and
   `.invalid.json`. Valid: a `purge_pending` (no deletedAt) case, a
   `live_deleted` (deletedAt within the 7-day live window) case, a
   `backup_expired` (deletedAt within the 35-day window) case, and a `complete`
   (deletedAt within the 35-day window) case — cover BOTH backup-bound statuses,
   not just `complete`. Invalid: unknown status, `not_requested`, wrong live
   deadline, wrong backup deadline, deletedAt on pending, missing deletedAt on a
   completed status, deletedAt before requestedAt, `live_deleted` with deletedAt
   after the live deadline (SLA breach), `backup_expired` with deletedAt after
   the backup deadline, an authority-grant field in request-form (`grantLedger`)
   AND one in result-form (`grantsLedgerAuthority:true`), digest mismatch,
   forbidden content field, schema major 1. Build valid digests to
   match `deriveRetentionDigest` inputs — the TEST derives the expected digest
   from `decodePurgeRequest(...).deletionReceipt.deletionReceiptDigest` so
   fixtures stay in lock-step (design §6).

3. **Fixtures — destructive-authorization.** Add
   `retention-destructive-authorization.{valid,invalid}.json` →
   `decodePurgeRequest` (its full authorization boundary; NOT foldable into the
   lifecycle family — `decodeRepositoryLifecycleEvent` checks only a
   `purgeRequestId`). Valid: a confirmed, fully-identified purge request. Invalid:
   `confirmed` absent/false; missing `authorization.tenant` / `authorization.repository`
   / `actor` / `reason` / `requestId`; and one entry PER `PURGE_FORBIDDEN_AUTHORITY`
   field (`ledgerAuthority`, `dispatchAuthority`, `recoveryAuthority`,
   `grantLedger`, `grantDispatch`, `grantRecovery`) each asserting
   `is forbidden; a purge never grants ledger, dispatch, or recovery authority`;
   schema major 1. The existing `retention-purge.*` fixtures cover only one
   forbidden-authority case — this family exhaustively closes AC2's
   destructive-authorization bullet.

4. **Fixtures — transfer/removal (lifecycle).** Add
   `retention-lifecycle.{valid,invalid}.json` → `decodeRepositoryLifecycleEvent`.
   Valid: `uninstall`, `removal`, `transfer_same_tenant`,
   `transfer_cross_tenant`, `authorized_purge`. Invalid: transfer_same_tenant
   missing revalidation; transfer_cross_tenant with same dest tenant / missing
   destinationAuthorization / missing policyRevalidated; authorized_purge missing
   `purgeRequestId`; unknown kind. Every entry carries `schemaVersion:2` and the
   base required fields — `decodeRepositoryLifecycleEvent` runs the standard
   `schemaVersion` prologue and per-kind fields; confirm the base required fields
   in `src/retention-policy.js:1270-1312` when authoring.

5. **Fixtures — deletion-journal restore.** Add
   `retention-restore.{valid,invalid}.json` → `authorizeRestoreReads`. Valid:
   replayed journal, backup within 35-day window. Invalid: journal not replayed
   (`deletionJournalReplayed` !== true); backup past the hard-max. Restore has no
   `schemaVersion`; the test invokes `authorizeRestoreReads(value)` (default
   profile) for the fixtures asserting the 35-day message.

6. **Fixtures — coverage-gaps.** Add `retention-coverage.{valid,invalid}.json` →
   `summarizeCoverage`. Valid: (a) exact-partition denominator with
   `complete:true`; (b) exact-partition with `unknown>0` yielding
   `complete:false` — an incomplete-but-partitioned coverage gap the contract
   SURFACES (via the returned `complete` flag), NOT rejects. The valid loop
   asserts `Object.isFrozen` and, for (b), `decoded.complete === false`. Invalid:
   buckets that do not sum to the denominator
   (`coverage buckets must partition the eligible denominator exactly`); a
   non-integer / out-of-range bucket (existing `integerValue` message). No new
   decoder. Note: `summarizeCoverage` does NOT reject `complete:false`; that is a
   surfaced gap, so it belongs in the VALID fixture, not the invalid one.

7. **Wire tests** in `test/retention-policy.test.js`: one `await fixture(...)`
   line per new file (ten files); valid loops asserting `Object.isFrozen` + domain checks;
   invalid loops via `eachInvalid`; the digest lock-step and privacy-non-echo
   assertions from design §6.

## Validation commands (gate — prd AC L46)

```bash
npm test                     # expect prior 588 + new tests pass, 0 fail
npm run test:coverage        # global floors: lines 88 / branches 77 / funcs 88
npm run check                # node --check all src
npm run validate:metadata
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs   # 0 failures
```

## Review gates

- Planning-adversarial-review (host + Codex lanes) BEFORE `task.py start`.
- After implementation: full gate set green, then sd-ship until=merge with
  deterministic sd-check + Prism + Copilot fallback (routed backend absent).

## Rollback

Pure additive: new decoder + new fixture files + new test blocks. Revert = drop
the `decodeDeletionReceipt` export, the ten new fixture files (five
valid/invalid pairs), and the added test loader lines/blocks. No existing
decoder or fixture is mutated.
