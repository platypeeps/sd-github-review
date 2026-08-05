# Implement: v2 quarantine status & clearance contracts

Ordered execution plan. See `design.md` for contracts; `prd.md` for ACs.

## Step 1 — Shared walker + enums in `src/protocol-v2.js`

1. Extend `rejectForbiddenFields` (:228) with a backward-compatible third param
   `extraForbidden = null` (NO undefined sentinel — C-7); inside the
   normalized-key match, throw if `FORBIDDEN_FIELD_NAMES.has(key) ||
   (extraForbidden && extraForbidden.has(key))`. Existing two-arg callers stay
   byte-identical. Validation: existing suite stays green.
2. Add `AUTHORITY_FORBIDDEN_FIELD_NAMES` (design §2.2 — normalized keys, from
   `src/review-budget-ledger.js` authorize()): `authorization`, `authorized`,
   `authorizedattempt`, `authorizedcapacity`, `revision`, `lease`, `leases`,
   `budget`, `budgets`, `capacity`, `reservation`, `reservations`, `dispatch`,
   `dispatched`, `allowance`, `pool`, `pools`, `quota`. Do NOT include
   `requestfingerprint`/`decisionfingerprint` (benign correlation digests).
2b. Add `REQUEST_DERIVED_FORBIDDEN_NORMALIZED` (normalized forms of every
   `REQUEST_DERIVED_FORBIDDEN` key: actor, association, publisher,
   publicationcontext, workflow, workflowref, runid, runattempt, authorization,
   authorized, authorizationresult, trustlevel, trusted). Request-only —
   status/response must NOT use it (they carry a legitimate auditIdentity
   subtree). Precompute the request UNION set once (C-8).
3. Add exported frozen enums + private sets:
   `QUARANTINE_STATUS_STATES = ["quarantined","cleared"]`,
   `CLEARANCE_DECISIONS = ["cleared","denied"]`,
   `QUARANTINE_STATUS_STATE_SET`, `CLEARANCE_DECISION_SET`.

## Step 2 — Three decoders in `src/protocol-v2.js`

Insert as a new `--- quarantine & clearance contracts ---` section immediately
after `decodeReviewOutcomes` (ends ~:875), BEFORE the `--- local-attested review
contracts ---` section (~:877). Templates: `decodeLocalAttestationRequest`
(request) / `decodeLocalReviewAuthorization` (ingestion-derived). Note the
research's "~:910 before decodeSelfReportedUsage" ref was imprecise.

Guard order (design §3): status/response call `rejectForbiddenFields(value,
<field>, AUTHORITY_FORBIDDEN_FIELD_NAMES)`; the request calls it with the
request UNION set (authority ∪ request-derived) — recursive, no shallow loop.
Then `assertEncodedSize(…, CONTRACT_MAX_BYTES)` → `objectValue` → `schemaVersion`
→ field decode → `Object.freeze(normalized + fingerprint)`. `deriveV2Fingerprint`
takes an OBJECT; the **status and response** fingerprints include `auditIdentity`,
the **request** fingerprint does NOT (identity-free — C-9).

1. `decodeQuarantineStatus` (design §3.1): fields incl. `auditIdentity` via
   `decodeLocalPublicationContext`; enforce the `decisionFingerprint`↔`state`
   cross-field invariant (required iff `cleared`, forbidden if `quarantined`);
   `statusFingerprint` per §3.1.
2. `decodeClearanceRequest` (design §3.2): recursive identity/authority walk via
   the request UNION set (no top-level loop); no auditIdentity/decision;
   `requestFingerprint` per §3.2 (excludes auditIdentity).
3. `decodeClearanceResponse` (design §3.3): `decision` (CLEARANCE_DECISION_SET),
   `requestFingerprint` (digestValue), `auditIdentity`, digests;
   `decisionFingerprint` per §3.3.
4. Export all three functions and both enums.

Validation: `node --check src/protocol-v2.js`.

## Step 3 — Contract fixtures

New files under `fixtures/protocol/v2/` (arrays of `{name,value,error?}`; compact
style; digests exactly 64 hex; `repository` `{owner,name}`; `auditIdentity` =
full tuple `{publisher, association, isPrAuthor, workflowRef, runId, runAttempt}`):

- `quarantine-status.valid.json` — ≥3: quarantined (no decisionFingerprint);
  cleared (with decisionFingerprint); a second cleared differing ONLY in
  `auditIdentity.publisher` (for the fingerprint-binds-actor test).
- `quarantine-status.invalid.json` — bad `state`, bad `reasonCode`,
  quarantined-with-decisionFingerprint, cleared-without-decisionFingerprint,
  forbidden-privacy field, top-level authority field, **nested** authority
  (`{meta:{lease:…}}`), **case-variant** authority (`{Authorized:true}`), v1
  receipt. Each `error` regex must NOT echo the offending value.
- `clearance-request.valid.json` — ≥1.
- `clearance-request.invalid.json` — top-level identity (`authorized`, `actor`,
  `publicationContext`), **nested** identity (`{meta:{authorizationResult:…}}`),
  **case-variant** identity (`{Actor:…}`, `{publication_context:…}`), authority
  field (nested + case-variant), bad `reasonCode`, v1 receipt. These prove the
  recursive request boundary (C-8), not just the top-level form.
- `clearance-response.valid.json` — a `cleared` and a `denied`; plus a second
  `cleared` differing ONLY in `auditIdentity.publisher`; the primary `cleared`
  must derive the SAME `decisionFingerprint` cited by the cleared status fixture.
- `clearance-response.invalid.json` — bad `decision`, authority field
  (nested + case-variant), missing `requestFingerprint`, v1 receipt.

## Step 4 — Residual reason-code outcome fixtures (AC10-residual)

Append to `fixtures/protocol/v2/outcomes.valid.json` / `outcomes.invalid.json`
(unique 64-hex `logicalDispatchId` per entry; keep the compact axis style).
Exercise each code as an **outcome reason code** via `decodeReviewOutcomes`.

Valid (one per code):
- `input_ineligible`: `{skipped,input_ineligible}` / `{not_applicable,…}` / `{block,…}`.
- `incomplete_token_limit`: `{skipped,…}` / `{not_applicable,…}` / `{block,…}`.
- `budget_overrun`: `{failed,budget_overrun}` / `{fail,budget_overrun}` /
  `{block,budget_overrun}` (non-deferrable → gate blocks; R2: reason-code path only).
- `candidate_quarantined`: `{skipped,…}` / `{not_applicable,…}` / `{block,…}`.

Invalid — **ALL FOUR codes** (closes C-5):
- `input_ineligible`: `{skipped,…}` + `{not_applicable}` + **gate pass** →
  `gateOutcome must block`.
- `incomplete_token_limit`: `{skipped,…}` + `{not_applicable}` + **gate pass** →
  `gateOutcome must block`.
- `candidate_quarantined`: `{skipped,…}` + `{not_applicable}` + **gate pass** →
  `gateOutcome must block`.
- `budget_overrun`: `{skipped,budget_overrun}` + assurance **deferred** →
  `deferred requires the budget_exhausted_deferred reason` (proves non-deferrable).

Verify every digest length via a `python3 -c` json load before running tests
(prior gotcha: pasted digests were 66 chars).

## Step 5 — Tests (`test/protocol-v2.test.js`)

1. Add `fixture(...)` loaders for the six new files (~:41-69); import
   `decodeQuarantineStatus`, `decodeClearanceRequest`, `decodeClearanceResponse`,
   `QUARANTINE_STATUS_STATES`, `CLEARANCE_DECISIONS`.
2. Valid tests: loop each `*.valid`; assert shape + fingerprint present.
3. `eachInvalid(...)` for status/request/response invalids.
4. **Fingerprint-binds-actor** (closes C-3): decode the two response fixtures
   differing only in `auditIdentity.publisher`; assert `decisionFingerprint`
   values DIFFER. Same for the two cleared-status fixtures / `statusFingerprint`.
5. **Cross-link**: assert the cleared-status fixture's `decisionFingerprint`
   equals the primary cleared-response fixture's derived `decisionFingerprint`.
6. **Invariant**: quarantined+decisionFingerprint and cleared−decisionFingerprint
   both throw (covered by status invalids).
7. AC10-residual: the 4 valid + 4 invalid outcome fixtures are auto-covered by
   the outcomes valid loop (~:215-221) and `eachInvalid(invalidOutcomes,
   decodeReviewOutcomes)` (~:232-233); add a targeted assertion that each
   residual code decodes.

Note: do NOT add an output-absence "no authority key" test — it proves nothing
(decoders copy only known fields). Authority rejection is proven by the throwing
invalid fixtures in Step 3 (C-4).

## Step 6 — Validate (full PRD gate)

```bash
node --check src/protocol-v2.js
npm test
npm run test:coverage        # node scripts/check-coverage.mjs
npm run check                # syntax check across all src/scripts
npm run validate:metadata
npm run validate:ci-parity
```

- All green. Coverage GLOBAL_FLOOR lines 88 / branches 77 / funcs 88 (no
  per-file floor on protocol-v2.js). If the known persistence.mjs branch flake
  trips, re-run once.
- `validate:metadata` + `validate:ci-parity` are REQUIRED by prd AC line 26
  (closes C-6).
- Mark prd ACs `[x]` only after all commands above pass.

## Rollback points

- Step 1's `rejectForbiddenFields` change is additive (default param) — revert in
  isolation if the existing suite regresses.
- Steps 2–5 are additive to one module + fixtures + one test file; revert by
  `git checkout -- src/protocol-v2.js test/protocol-v2.test.js
  fixtures/protocol/v2/` and deleting the six new fixture files.
- No schema-major bump, no change to existing decoder behavior → no compatibility
  risk (the walker change only adds an opt-in set for the three new callers).
