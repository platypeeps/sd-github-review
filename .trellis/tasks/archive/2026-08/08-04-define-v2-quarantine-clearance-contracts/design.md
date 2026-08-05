# Design: v2 quarantine status & clearance contracts

## 1. Scope / Trigger

Cross-layer wire-contract change (mandatory code-spec depth): three net-new
fail-closed decoders in the pure-ESM contract module `src/protocol-v2.js`, plus
distinct fixtures for four residual reason codes. Completes parent AC13
(quarantine status + clearance request/response binding candidate, actor,
reason, remediation evidence, policy/configuration digest, and audit identity
with no implicit budget or dispatch authority) and parent AC10-residual
(distinct valid AND invalid fixtures for `input_ineligible`,
`incomplete_token_limit`, `budget_overrun`, `candidate_quarantined`).

Research: `research/quarantine-clearance-gap-analysis.md`. Reason enum already
frozen (`OUTCOME_REASON_CODES`); two existing quarantine decoders
(`decodeCandidateQuarantine`, `decodeQuarantineRecord`) bind only a partial
tuple and are treated as distinct siblings, NOT extended (they deliberately
forbid identity fields). No clearance surface exists anywhere.

## 2. Signatures

New in `src/protocol-v2.js`, placed as their own `--- quarantine & clearance
contracts ---` section immediately after `decodeReviewOutcomes` (ends ~:875) and
before the `--- local-attested review contracts ---` section (~:877):

```js
export const QUARANTINE_STATUS_STATES = Object.freeze(["quarantined", "cleared"]);
export const CLEARANCE_DECISIONS = Object.freeze(["cleared", "denied"]);

export function decodeQuarantineStatus(value)    // -> frozen normalized status + statusFingerprint
export function decodeClearanceRequest(value)    // -> frozen normalized request + requestFingerprint
export function decodeClearanceResponse(value)   // -> frozen normalized response + decisionFingerprint
```

### 2.1 Two-stage trust model (mirrors attestation)

The request is a raw caller submission; the response is ingestion-derived. This
is the established `decodeLocalAttestationRequest` → `decodeLocalReviewAuthorization`
pattern (protocol-v2.js): the request carries NO GitHub-derived identity and NO
authority, and the **response** binds the requester's ingestion-derived audit
identity plus the policy/configuration digests. The requester is audited at the
response, not by self-asserting identity in the request. The status is the
control-plane's current view, ingestion-derived, and cites the response that
last changed it.

### 2.2 No-authority enforcement (recursive, shared walker)

`rejectForbiddenFields` (protocol-v2.js:228-277) already walks nested objects and
arrays and normalizes each key (`toLowerCase().replace(/[^a-z0-9]/gu,"")`) before
matching. Extend that ONE recursive walker with an optional extra set rather than
adding a shallow top-level loop:

```js
// signature change (backward-compatible default): rejectForbiddenFields(value, field, extraForbidden = null)
// In the normalized-key match, throw if FORBIDDEN_FIELD_NAMES.has(key) ||
// (extraForbidden && extraForbidden.has(key)). Default null keeps every
// existing two-argument caller byte-identical (no undefined sentinel — C-7).

// Genuine budget/dispatch AUTHORITY-GRANT vocabulary (normalized keys). Sourced
// from src/review-budget-ledger.js authorize() (:872-878): authorization,
// authorizedAttempt, revision, lease/leases; plus capacity/reservation/dispatch
// /pool/quota/allowance. Rejected recursively on all three contracts.
const AUTHORITY_FORBIDDEN_FIELD_NAMES = new Set([
  "authorization", "authorized", "authorizedattempt", "authorizedcapacity",
  "revision", "lease", "leases", "budget", "budgets", "capacity",
  "reservation", "reservations", "dispatch", "dispatched", "allowance",
  "pool", "pools", "quota",
]);
```

Case-variant (`Authorized`) and nested (`meta.lease`) authority fields are
therefore rejected. `requestFingerprint`/`decisionFingerprint` are benign
correlation digests, NOT authority grants, so they are deliberately NOT in this
set (see C-4 rebuttal in §Design decisions).

The clearance REQUEST additionally rejects GitHub-derived identity RECURSIVELY
(C-8): the existing shallow top-level `REQUEST_DERIVED_FORBIDDEN` loop misses
nested/case-variant forms (`meta.authorizationResult`, `Actor`,
`publication_context`). Because the request has NO legitimate identity subtree,
route a normalized set through the same recursive walker:

```js
// Normalized REQUEST_DERIVED_FORBIDDEN keys (actor, association, publisher,
// publicationcontext, workflow, workflowref, runid, runattempt, authorization,
// authorized, authorizationresult, trustlevel, trusted). Passed to the request's
// recursive walk. Safe ONLY for the request: status/response carry a legitimate
// auditIdentity subtree (publisher/association/workflowRef/runId/runAttempt) and
// therefore must NOT apply this set, or they would reject their own identity.
const REQUEST_DERIVED_FORBIDDEN_NORMALIZED = new Set([...]); // normalized forms
```

The request's single `rejectForbiddenFields` call passes the UNION of
`AUTHORITY_FORBIDDEN_FIELD_NAMES` and `REQUEST_DERIVED_FORBIDDEN_NORMALIZED` as
`extraForbidden`, so identity/authority rejection is recursive and case-insensitive
in one pass — replacing the shallow top-level loop entirely for the request.

Reused as-is: `decodeLocalPublicationContext` (audit identity),
`deriveV2Fingerprint` (takes an OBJECT), `assertEncodedSize`, `objectValue`,
`schemaVersion`, `repositoryValue`, `aliasValue`, `digestValue`, `enumValue`,
`timestampValue`, `OUTCOME_REASON_CODE_SET`, `CONTRACT_MAX_BYTES`,
`REQUEST_DERIVED_FORBIDDEN` (clearance request only), `PROTOCOL_V2_SCHEMA_MAJOR`.

## 3. Contracts

Guard order:
- **status / response**: `rejectForbiddenFields(value, <field>,
  AUTHORITY_FORBIDDEN_FIELD_NAMES)` (recursive privacy + authority walk) →
  `assertEncodedSize(…, CONTRACT_MAX_BYTES)` → `objectValue` → `schemaVersion` →
  field decode → `Object.freeze(normalized + fingerprint)`.
- **request**: `rejectForbiddenFields(value, "clearanceRequest",
  UNION(AUTHORITY_FORBIDDEN_FIELD_NAMES, REQUEST_DERIVED_FORBIDDEN_NORMALIZED))`
  (recursive privacy + authority + identity walk — no shallow loop) →
  `assertEncodedSize` → `objectValue` → `schemaVersion` → field decode →
  `Object.freeze(normalized + requestFingerprint)`.

### 3.1 `decodeQuarantineStatus` — control-plane quarantine status (ingestion-derived)

| Field | Type / helper | Constraint |
|---|---|---|
| `schemaVersion` | `schemaVersion()` | strict major == 2 |
| `repository` | `repositoryValue` | `{owner,name}` |
| `candidate` | `aliasValue` | immutable candidate alias |
| `state` | `enumValue(QUARANTINE_STATUS_STATES)` | `quarantined` \| `cleared` |
| `reasonCode` | `enumValue(OUTCOME_REASON_CODE_SET)` | why quarantined |
| `remediationDigest` | `digestValue` | 64-hex digest of remediation evidence — a reference, never a body |
| `policyDigest` | `digestValue` | 64-hex |
| `configurationDigest` | `digestValue` | 64-hex |
| `auditIdentity` | `decodeLocalPublicationContext` | authenticated GitHub actor tuple |
| `recordedAt` | `timestampValue` | ISO-8601 UTC |
| `decisionFingerprint` | `digestValue` | REQUIRED iff `state === "cleared"`; FORBIDDEN when `quarantined` — cites the clearance response that cleared it |

Cross-field invariant (makes the "response-driven transition" real & testable):
`state === "cleared"` ⇒ `decisionFingerprint` present; `state === "quarantined"`
⇒ `decisionFingerprint` absent, else throw
`quarantine status decisionFingerprint is valid only for a cleared status`.

`statusFingerprint = deriveV2Fingerprint({ repository, candidate, state,
reasonCode, remediationDigest, policyDigest, configurationDigest, auditIdentity,
recordedAt, decisionFingerprint })` — includes `auditIdentity` so the bound
actor is part of the identity (mirrors `attemptToken` at protocol-v2.js:1031-1037).

### 3.2 `decodeClearanceRequest` — caller-submitted request (authority-free, identity-free)

| Field | Type / helper | Constraint |
|---|---|---|
| `schemaVersion` | `schemaVersion()` | major == 2 |
| `repository` | `repositoryValue` | `{owner,name}` |
| `candidate` | `aliasValue` | alias being contested |
| `reasonCode` | `enumValue(OUTCOME_REASON_CODE_SET)` | the quarantine reason being cleared |
| `remediationDigest` | `digestValue` | caller's remediation-evidence reference |
| `requestedAt` | `timestampValue` | ISO-8601 UTC |

Identity/authority rejection is RECURSIVE via the walker's `extraForbidden`
union (§2.2, §3 request guard) — no shallow top-level loop, so nested/case-variant
identity (`meta.authorizationResult`, `Actor`, `publication_context`) is rejected.
No `auditIdentity`, no `decision`, no digests the adjudicator owns. The request
fingerprint deliberately EXCLUDES audit identity because the request is
identity-free: `requestFingerprint = deriveV2Fingerprint({ repository, candidate,
reasonCode, remediationDigest, requestedAt })`.

### 3.3 `decodeClearanceResponse` — adjudicated decision (ingestion-derived; audits the requester)

| Field | Type / helper | Constraint |
|---|---|---|
| `schemaVersion` | `schemaVersion()` | major == 2 |
| `repository` | `repositoryValue` | `{owner,name}` |
| `candidate` | `aliasValue` | alias adjudicated |
| `decision` | `enumValue(CLEARANCE_DECISIONS)` | `cleared` \| `denied` |
| `reasonCode` | `enumValue(OUTCOME_REASON_CODE_SET)` | quarantine reason adjudicated |
| `remediationDigest` | `digestValue` | evidence reference |
| `policyDigest` | `digestValue` | 64-hex |
| `configurationDigest` | `digestValue` | 64-hex |
| `requestFingerprint` | `digestValue` | binds the exact clearance request adjudicated |
| `auditIdentity` | `decodeLocalPublicationContext` | the REQUESTER's ingestion-derived identity — this audits the requester (closes C-2) |
| `decidedAt` | `timestampValue` | ISO-8601 UTC |

`decisionFingerprint = deriveV2Fingerprint({ repository, candidate, decision,
reasonCode, remediationDigest, policyDigest, configurationDigest,
requestFingerprint, auditIdentity, decidedAt })` — includes `auditIdentity` and
`requestFingerprint` so the decision is bound to the audited requester and the
specific request. A `cleared` response's `decisionFingerprint` is what a
`cleared` quarantine status must cite (§3.1).

Clearing lifts the quarantine but reserves no budget and dispatches nothing —
enforced structurally (no capacity field exists in any normalized shape) AND by
the recursive `AUTHORITY_FORBIDDEN_FIELD_NAMES` walk.

### 3.4 Residual reason-code outcome fixtures (AC10-residual)

Home is the outcome axes (`decodeReviewOutcomes`), per research §(b)3 —
`decodeCandidatePreflight` does not validate `reasonCode`. Append to existing
`fixtures/protocol/v2/outcomes.{valid,invalid}.json`; the valid loop and
`eachInvalid(invalidOutcomes, decodeReviewOutcomes)` auto-cover new entries.
**Every one of the four codes gets BOTH a valid and an invalid outcome fixture.**

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| unknown `state` / `decision` / `reasonCode` | `enumValue` throws (fail-closed) |
| `schemaVersion` major != 2 | `must use supported schema major 2` (a v1 receipt cannot masquerade) |
| any `FORBIDDEN_FIELD_NAMES` present (finding/output/content/prompt/secret…), nested or case-variant | `rejectForbiddenFields` throws (privacy) |
| any `AUTHORITY_FORBIDDEN_FIELD_NAMES` present (all 3 decoders), nested or case-variant | `rejectForbiddenFields` throws `… is forbidden by the v2 privacy boundary` |
| request carries any `REQUEST_DERIVED_FORBIDDEN` field, nested or case-variant | request-only recursive walk (union set) throws `… is forbidden by the v2 privacy boundary` |
| digest field not 64-hex | `digestValue` throws |
| `state:quarantined` with `decisionFingerprint`, or `state:cleared` without it | cross-field invariant throws |
| oversized encoded payload | `assertEncodedSize` throws (no value echoed) |
| non-object / missing required field | `objectValue`/helper throws |

R2 (`budget_overrun` overload): fixtures exercise it as an **outcome reason
code** through `decodeReviewOutcomes`, never as a reconciliation `budgetClass`.

## 5. Good / Base / Bad Cases

- **Good (status, quarantined)**: `{quarantined, candidate_quarantined}` + all
  digests + `auditIdentity`, no `decisionFingerprint` → decodes.
- **Good (status, cleared)**: `{cleared, …}` + `decisionFingerprint` citing a
  clearance response → decodes.
- **Good (request)**: repo + candidate + reasonCode + remediationDigest +
  requestedAt, no identity/authority → decodes; `requestFingerprint` set.
- **Good (response)**: `{cleared|denied, …}` + `requestFingerprint` +
  `auditIdentity` + digests → decodes; `decisionFingerprint` binds all.
- **Bad**: request with `authorized:true` → REQUEST_DERIVED_FORBIDDEN throw;
  any decoder with nested `{meta:{lease:…}}` or `{Authorization:…}` → authority
  walk throw; response with `decision:"granted"` → enumValue throw; status
  `{quarantined}` + `decisionFingerprint` → invariant throw; any decoder fed a
  v1 receipt → major-2 throw.

## 6. Tests Required (`test/protocol-v2.test.js`)

- **AC13-status**: valid entries (quarantined + cleared) decode; assert
  state/reasonCode/digests/auditIdentity bound and `statusFingerprint` present;
  invariant tests for the `decisionFingerprint`↔`state` rule;
  `eachInvalid(quarantineStatusInvalid, decodeQuarantineStatus)`.
- **AC13-request**: valid decode + `eachInvalid` (REQUEST_DERIVED_FORBIDDEN,
  authority nested/case-variant, v1 receipt).
- **AC13-response**: valid `cleared` and `denied` decode; assert `auditIdentity`,
  `requestFingerprint`, `decisionFingerprint` bound + `eachInvalid`.
- **AC13-fingerprint-binds-actor** (closes C-3, not mere presence): decode two
  response fixtures identical except `auditIdentity.publisher`; assert their
  `decisionFingerprint` values DIFFER. Same technique for `statusFingerprint`.
- **AC13-cross-link**: a `cleared` status fixture's `decisionFingerprint` equals
  the `decisionFingerprint` a matching `cleared` response fixture derives.
- **AC13-authority-rejected** (closes C-4, throws not output-absence): invalid
  fixtures carrying top-level, nested, and case-variant authority fields each
  throw via `eachInvalid`.
- **AC10-residual**: 4 valid outcome fixtures (one per code) decode; 4 invalid
  outcome fixtures (one per code) throw via existing `eachInvalid`.
- Full suite gate: see §7-adjacent implement Step 5 (npm test, check, coverage,
  validate:metadata, validate:ci-parity).

## 7. Wrong vs Correct

### Wrong
```js
// Reuse decodeCandidateQuarantine for AC13; let the request self-assert actor +
// authorized:true; reject authority with a shallow top-level key loop; assert
// "no authority" by checking the decoded OUTPUT has no authority keys.
```
Neither existing decoder binds actor/audit-identity/policy+config digests; a
self-asserted authority defeats the ingestion-boundary trust model; a top-level
loop misses nested/case-variant authority; and output-absence proves nothing
because the decoder only ever copies known fields.

### Correct
```js
// Request mirrors REQUEST_DERIVED_FORBIDDEN (no self-minted authority/identity);
// status/response carry ingestion-derived auditIdentity via
// decodeLocalPublicationContext and fold it into deriveV2Fingerprint; all three
// reject AUTHORITY_FORBIDDEN_FIELD_NAMES through the shared RECURSIVE walker;
// "no authority" is proven by invalid fixtures that THROW.
```

## Design decisions

- **R1 (state vocabulary)**: `QUARANTINE_STATUS_STATES = ["quarantined",
  "cleared"]` — the adjudicated-clearance lifecycle, distinct from the catalog
  overlay's version-swap (`replaced`) and the ledger record's capacity-denial
  release (`released`); pairs 1:1 with `CLEARANCE_DECISIONS`. Documented
  divergence.
- **Reasons reuse the frozen `OUTCOME_REASON_CODE_SET`** — no new reason vocab.
- **C-2 disposition (partial address + partial rebuttal)**: AC13's "request/
  response bind actor/audit identity/policy+config" is satisfied by the request+
  response PAIR. The **request stays authority- and identity-free** (rebuttal:
  forcing it to self-assert actor/authority is the exact anti-pattern
  `REQUEST_DERIVED_FORBIDDEN` prevents, and mirrors
  `decodeLocalAttestationRequest`). The **response binds the requester's
  ingestion-derived `auditIdentity` + policy/configuration digests +
  `requestFingerprint`**, so the requester IS audited and the adjudication is
  bound to the specific request.
- **C-4 token rebuttal**: `requestFingerprint`/`decisionFingerprint` are
  correlation digests, not authority grants; they are legitimate contract fields
  and are NOT added to `AUTHORITY_FORBIDDEN_FIELD_NAMES`. The genuine grant
  vocabulary (`authorization`, `authorizedAttempt`, `revision`, `lease`, …) IS.
- **deriveV2Fingerprint takes an object** (protocol-v2.js:1031) — all three
  fingerprints use the object form. The **status and response** fingerprints
  include `auditIdentity` (C-3); the **request** fingerprint deliberately does
  NOT, because the request is identity-free (C-9).
