# Design: v2 receipt and cross-contract identity contracts

> **B2 RESOLVED (owner decision, iteration 8).** Adversarial review had parked this
> plan on one blocker: `decodeAttemptReceipt` and `decodeDurableAuthorization`
> carried a `promptProfile` but no candidate identity, so their profile reference
> could not participate in the catalog full-record membership check that `prd.md`
> (unknown/incompatible "across ...authorization/receipt") requires. **Adopted
> fix:** both decoders now carry `alias` + `candidateDigest`, so a receipt's or
> authorization's profile reference locates a catalog candidate record. Rationale
> and rejected alternative are recorded in §3 "Candidate identity (B2)".

Code-spec for the residual v2 receipt + identity work. Builds on the v2 core in
`src/protocol-v2.js`. Context order for implementation: this file, `prd.md`,
`research/v2-receipt-identity-surface.md`.

## 1. Scope / Trigger

Cross-layer contract change (new fail-closed decoders + fixture matrix). Triggers
code-spec depth: new decode* signatures, a shared identity tuple consumed across
contracts, and cross-module retention-vocabulary reuse.

Deliverables:

- Consume the currently-unconsumed `decodeMutableBinding` (internal `mutableBinding`
  `src/protocol-v2.js:469`, `export { mutableBinding as decodeMutableBinding }`
  `:1801`) from a receipt/authorization decoder.
- `decodeAttemptReceipt` — immutable per-attempt receipt = identity tuple +
  prompt-profile binding + bounded retention projection.
- `decodeDurableAuthorization` — identity tuple + prompt-profile, mints no
  budget/dispatch.
- `decodeAdapterAcknowledgment` — identity tuple + adapter ack, linked to an
  authorization fingerprint.
- `decodeSafeCatalogProjection` + `decodeCompiledManifestProjection` — carry only
  the prompt-profile `{mode, alias?, version?, digest?}` union per candidate/entry.
- Full valid/invalid fixture matrix: AC1 cross-contract identity, AC5
  receipt/safe-projection privacy, AC2 residual prompt-profile references.

## 2. Signatures

All new decoders live in `src/protocol-v2.js` and follow the module fail-closed
prologue (`rejectForbiddenFields` → `assertEncodedSize` → `objectValue` +
`schemaVersion===2` → allow-listed `normalized` → `deriveV2Fingerprint` over the
full normalized body → `Object.freeze`). Template: `decodeLocalReviewReceipt`
(`:1258`), which spreads a binding then appends fields.

```
export function decodeAttemptReceipt(value): frozen {
  schemaVersion, ...identityTuple, alias, candidateDigest,
  promptProfile:{mode,alias?,version?,digest?},
  retentionPolicyId, retentionPolicyVersion, retentionPolicyDigest,
  dataClass, lifecycleState, deletionStatus, legalHold:{held, expiresAt?},
  coverageStart, coverageEnd?, retainedUntil|null, recordedAt, receiptFingerprint }

export function decodeDurableAuthorization(value): frozen {   // AUTHORITY-forbidden
  schemaVersion, ...identityTuple, alias, candidateDigest, promptProfile:{...},
  authorizedAt, authorizationFingerprint }

export function decodeAdapterAcknowledgment(value): frozen {
  schemaVersion, ...identityTuple, adapter, authorizationFingerprint,
  acknowledgedAt, acknowledgmentFingerprint }

export function decodeSafeCatalogProjection(value): frozen {
  schemaVersion, catalogDigest,
  candidates:[{alias, candidateDigest, promptProfile:{...}}] }

export function decodeCompiledManifestProjection(value): frozen {
  schemaVersion, compiledDigest, sourceDigest, catalogDigest,
  entries:[{alias, candidateDigest, promptProfile:{...}}] }
```

`identityTuple` = `mutableBinding(value, field)` output: `{repository{owner,name},
pullRequestNumber, headSha, attempt, sourceDigest, catalogDigest, compiledDigest,
candidatePlanFingerprint}`. It is spread with `...` into the three identity-bearing
decoders (receipt, authorization, adapter-ack); the decoder never re-validates
those fields itself. The two projections do NOT spread the tuple — they carry only
their own catalog/compiled/source digests plus per-candidate prompt profiles.

**decodeMutableBinding consumption (AC target).** `mutableBinding` IS the export
(`:1801`), so calling the internal `mutableBinding` inside `decodeAttemptReceipt`
consumes the exact function the `decodeMutableBinding` export names.

## 3. Contracts

### Identity tuple (shared)

Passing the whole decoded object as the binding `value` places identity fields at
the object's top level (mirroring `decodeLocalReviewReceipt`'s
`decodeLocalEvidenceBinding(receipt, ...)` at `:1266`; confirmed `mutableBinding`
reads `binding.repository` etc. off that object, `:469`).

### Candidate identity (B2)

`decodeAttemptReceipt` and `decodeDurableAuthorization` each carry `alias`
(`aliasValue`) + `candidateDigest` (`digestValue`) alongside the identity tuple.
These name WHICH reviewer candidate the attempt ran / the authorization
authorizes, and they are the join key that lets the contract's `promptProfile`
be checked against the safe catalog's full candidate record (§6 AC2).

**Why the identity tuple alone is insufficient.** The tuple's
`candidatePlanFingerprint` is an opaque `digestValue` (`:481`) — not
decomposable — and plan identity binds SLOTS whose `candidateDigests` is an
ARRAY (`compileReviewerPlan` `:1658-1675`). A slot may hold several candidates,
so neither the fingerprint nor the plan structure pins a single candidate.
Without `alias` + `candidateDigest` a receipt's profile reference cannot be
located in the catalog, and prd's "unknown/incompatible across
...authorization/receipt" is unprovable.

**Why this is privacy-safe (AC5).** Neither `alias` nor `candidateDigest` is in
`FORBIDDEN_FIELD_NAMES` (`:168`, 42 entries — verified); `alias` already
surfaces in the projections and in every referenced prompt profile, and
`candidateDigest` is a 64-hex digest, not content.

**Adapter-acknowledgment is deliberately excluded.** It carries no `alias` /
`candidateDigest`; it reaches candidate identity transitively through the
`authorizationFingerprint` it references. Adding them there would duplicate
state already bound by that fingerprint and create a divergence surface.

**Rejected alternative.** Narrowing AC2 so unknown/incompatible are proven only
on catalog↔compiled would have required editing prd requirement line 27, which
names authorization and receipt explicitly. Rejected: weakens a stated
requirement to avoid two additive fields.

### Projection authority — scope bound (C-1)

§6 calls the safe-catalog projection "the authority" for profile membership. That
authority is **contract-local**: `decodeSafeCatalogProjection` is a NEW decoder
whose `candidates[]` carry `promptProfile`, whereas the shipped
`decodeReviewerCatalog` builds records of `{alias, candidateDigest,
eligibleLanes}` (`:1532`) and carries NO per-candidate prompt profile anywhere
(`promptProfile` occurs only at `:494`, `:557`, `:562`, `:587-589`, `:714`).

So nothing here asserts the projection was faithfully derived from a real
reviewer catalog — the AC2 tests compare a projection against compiled/receipt/
authorization records, all fixture-authored. Deriving the projection from
`decodeReviewerCatalog` output is compiler work and is out of scope per prd
("Compiler, network transport, storage, or workflow implementation"). Recorded so
no reader mistakes contract-local membership for end-to-end catalog validation.
The projection deliberately drops `eligibleLanes`: prd scopes projections to
carry only the profile mode/alias/version/digest.

### Prompt-profile binding (receipt / authorization / projections)

Every prompt profile is `decodePromptProfileBinding(value, field)` (`:494`),
returning `{mode:"handler-managed"}` OR `{mode:"referenced", alias, version,
digest}`. No profile body, no default/inheritance/fallback/override (the binding
rejects those). The receipt and authorization each carry one; the projections
carry one per candidate/entry. This is what makes AC5 receipt privacy testable
(only mode/alias/version/digest surface) and AC2 residual-profile fixtures
expressible on the receipt contract.

### Retention projection (attempt receipt)

Retention IDENTITY + coarse state only, never private content. Top-level fields:
`retentionPolicyId` (`aliasValue`), `retentionPolicyVersion` (`semverLikeValue`),
`retentionPolicyDigest` (`digestValue`); `dataClass`/`lifecycleState`/
`deletionStatus` via the shared vocabulary; `legalHold:{held, expiresAt?}`
(expiresAt valid only when held); `coverageStart` (required), `coverageEnd`
(optional, and — new receipt invariant — must not precede `coverageStart`);
`retainedUntil` (nullable); `recordedAt`. This mirrors the field set of
`decodeRetentionStatus` (`retention-policy.js:1032`) but is validated inline (the
receipt is a projection; it does not re-run `decodePolicyBinding`'s digest-match).

**Design decision — retention vocabulary source (C-6).** The enum SETs in
`retention-policy.js` are mutable `new Set(...)` objects; exporting a `Set` is
unsafe (a consumer could `.add()`/`.delete()` and corrupt retention validation
globally — `Object.freeze` does not seal a `Set`). The source ARRAYS, however,
are already exported and frozen: `RETENTION_DATA_CLASSES` (`:36`),
`RETENTION_LIFECYCLE_STATES` (`:51`), `DELETION_STATUSES` (`:90`) — runtime probe
confirms `frozen:[true,true,true]`, lengths `[10,7,5]`. **Chosen:** import those
three frozen arrays into `protocol-v2.js` and build protocol-local `new Set(...)`
for `enumValue`. No edit to `retention-policy.js`; single source of truth for the
vocabulary; no drift; no mutable-state exposure. No import cycle —
`retention-policy.js` imports only `node:crypto` (`:16`).

**Field naming (intentional).** The receipt uses receipt-specific names
`retentionPolicyId` / `retentionPolicyVersion` / `retentionPolicyDigest`, NOT the
`{retentionPolicyId, version, digest}` field names `decodePolicyBinding` returns
(`retention-policy.js:614`). The receipt reuses the retention *vocabulary* (enum
values), not the policy-binding field shape; the rename disambiguates the policy
triad from any other version/digest in the receipt body. This is a deliberate
divergence, not a mirror of the policy-binding field set.

### Fingerprints (C-5)

Each fingerprinted decoder emits `<name>Fingerprint =
deriveV2Fingerprint(normalizedWithoutFingerprint)` — the digest covers EVERY
emitted normalized field (identity tuple, prompt profile, and, for the receipt,
the full retention projection), so any change to emitted state changes the
fingerprint (`deriveV2Fingerprint` = `sha256(canonicalize(fields))`, `:449`).
- receipt: `receiptFingerprint` over the whole receipt body sans the fingerprint.
- authorization: `authorizationFingerprint` over the whole authorization body.
- adapter-ack: `acknowledgmentFingerprint` over its body (which INCLUDES the
  `authorizationFingerprint` it references — see identity matrix).

### Environment keys

None. Pure in-process contract module.

## 4. Validation & Error Matrix

| Condition | Error / behavior |
|---|---|
| forbidden content/config field (any nesting) | `rejectForbiddenFields` message (never echoes value) |
| budget/dispatch authority field on authorization | `rejectForbiddenFields(..., AUTHORITY_FORBIDDEN_FIELD_NAMES)` recursive rejection (pattern `:948`) |
| bad identity field (repo/PR/head/attempt/digest) | the tuple validator message via `mutableBinding` |
| missing/malformed `alias` on receipt or authorization | `aliasValue` message (B2 join key is required, not optional) |
| missing/malformed `candidateDigest` on receipt or authorization | `digestValue` message (64-hex) |
| schemaVersion !== 2 | existing `schemaVersion` message |
| oversize (>16 KiB) | existing `assertEncodedSize` message |
| unknown dataClass/lifecycleState/deletionStatus | `enumValue` against the protocol-local set built from the shared frozen array |
| `legalHold.expiresAt` present while `held:false` | `attemptReceipt.legalHold.expiresAt is valid only when a hold is held` |
| `coverageEnd` precedes `coverageStart` | `attemptReceipt.coverageEnd must not precede coverageStart` (new invariant, C-8) |
| `retainedUntil` neither ISO nor null | `timestampValue` message (null branch explicit) |
| prompt-profile handler-managed with alias/version/digest | existing `decodePromptProfileBinding` message |
| prompt-profile referenced missing alias/version/digest | existing `decodePromptProfileBinding` message (covers "missing" AC2 case) |
| candidates/entries array empty or over cap | array-helper message (`MAX_COLLECTION_ITEMS`) |

Registry resolution (a genuinely "unknown" or "incompatible" profile against a
live registry) is compiler/runtime territory and OUT OF SCOPE (prd). At the
contract layer these AC2 cases are proven as cross-artifact relationships (§6),
not single-decoder registry lookups.

## 5. Good / Base / Bad Cases

- **Good:** referenced-profile receipt, held legal hold, bound `retainedUntil`,
  `coverageEnd` after `coverageStart`; digest-consistent across catalog/compiled/
  receipt/authorization.
- **Base:** handler-managed native receipt, no hold, `retainedUntil: null`, no
  `coverageEnd`.
- **Bad:** authority field on authorization; digest-mismatched profile reference;
  `legalHold.expiresAt` with `held:false`; `coverageEnd` before `coverageStart`;
  forbidden prompt body; schema major 1.

## 6. Tests Required

`test/protocol-v2.test.js`. One `fixture(...)` loader per new file; valid loops
assert `Object.isFrozen` + domain checks; invalid loops via `eachInvalid`.

- **AC1 cross-contract identity matrix.** Build a receipt, a durable
  authorization, and an adapter acknowledgment from ONE shared identity tuple:
  1. assert all three expose identical tuple fields (repository, PR, headSha,
     attempt, sourceDigest, catalogDigest, compiledDigest, candidatePlanFingerprint);
  2. assert a receipt built with a mismatched `headSha` (or `attempt`) yields a
     tuple distinct from the authorization's — proving identity is bound, not
     coincidental;
  3. define + assert the ack↔authorization linkage: a valid
     `decodeAdapterAcknowledgment.authorizationFingerprint` equals the
     `decodeDurableAuthorization.authorizationFingerprint` of the authorization it
     acknowledges; a mismatched pair is proven distinct.
- **decodeMutableBinding consumed.** Import the `decodeMutableBinding` export;
  assert `decodeAttemptReceipt(v)` identity fields deep-equal
  `decodeMutableBinding(v, "attemptReceipt")`; assert a bad `headSha`/`attempt`
  throws via the shared binding.
- **AC5 privacy** (`v2-attempt-receipt`, `v2-safe-catalog`): a forbidden
  prompt/configuration field is rejected without echo; the receipt's and
  projection's prompt profile exposes only `{mode, alias, version, digest}` and
  never a profile body.
- **AC2 residual profiles** (`v2-prompt-profile-residual` pair + reuse of the
  receipt/catalog/compiled fixtures). Contract-layer taxonomy — the safe-catalog
  projection is the authority; each compiled entry / receipt / authorization
  profile reference is checked against the catalog's **complete candidate record**
  `(alias, candidateDigest, promptProfile)` (the whole binding, not the digest
  alone — digest-only membership misses an unknown alias reusing a known digest).
  Receipt and authorization participate on equal footing with compiled entries
  because B2 gives them the `(alias, candidateDigest)` join key; every case below
  is asserted for a compiled entry AND for a receipt AND for an authorization, so
  prd line 27's "across the catalog/compiled/authorization/receipt contracts" is
  covered by construction:
  - **missing / malformed** → a referenced-mode profile lacking `alias`/`version`/
    `digest` (or handler-managed carrying them) → the decoder rejects on shape.
  - **shared vs candidate-specific** → two candidates citing the same profile
    record vs distinct records → both decode; the test asserts the sharing/
    distinctness by comparing full records.
  - **digest-mismatched** → a compiled entry / receipt / authorization whose
    `(alias, candidateDigest)` matches a catalog record but whose
    `promptProfile.digest` differs → full-record set-membership fails.
  - **unknown** → a compiled entry / receipt / authorization whose
    `(alias, candidateDigest)` pair is absent from the catalog (including an
    unknown alias reusing a known digest) → full-record membership fails.
  - **incompatible** → a compiled entry / receipt / authorization that pairs a
    candidate with a profile record the safe catalog does NOT authorize for that
    candidate (the catalog's record for that `alias`/`candidateDigest` carries a
    different profile) → per-candidate full-record membership fails.

  All five are proven by cross-artifact full-record set-membership assertions in
  the test, never a decoder registry/handler-resolution call. **Out of scope
  (prd):** live registry resolution and handler `compatibleHandlers` matching are
  compiler/runtime concerns; the projections deliberately carry no handler set, so
  "incompatible" is defined here strictly as catalog-vs-compiled projection-record
  divergence, not handler-registry compatibility. (This narrows the research note
  at `research/v2-receipt-identity-surface.md:118`, which described incompatibility
  via `compatibleHandlers`; that resolution layer is out of scope for these
  contracts.)
- **Cross-contract digest consistency.** A receipt, its catalog projection, and
  its compiled projection built from the same digests share `catalogDigest` /
  `compiledDigest`; a mismatched pair is proven distinct.

## 7. Wrong vs Correct

### Wrong

```js
// Re-validates identity inline — leaves decodeMutableBinding unconsumed (AC miss);
// fingerprint over a partial field set — changed retention state preserves digest.
const repository = repositoryValue(receipt.repository, "attemptReceipt.repository");
const receiptFingerprint = deriveV2Fingerprint({ repository, deletionStatus });
```

### Correct

```js
const binding = mutableBinding(receipt, "attemptReceipt"); // == decodeMutableBinding export
const alias = aliasValue(receipt.alias, "attemptReceipt.alias");                     // B2 join key
const candidateDigest = digestValue(receipt.candidateDigest, "attemptReceipt.candidateDigest");
const promptProfile = decodePromptProfileBinding(receipt.promptProfile, "attemptReceipt.promptProfile");
const body = { schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR, ...binding, alias, candidateDigest,
  promptProfile,
  retentionPolicyId, retentionPolicyVersion, retentionPolicyDigest, dataClass,
  lifecycleState, deletionStatus, legalHold, coverageStart, retainedUntil, recordedAt };
if (coverageEnd !== undefined) body.coverageEnd = coverageEnd;
return Object.freeze({ ...body, receiptFingerprint: deriveV2Fingerprint(body) });
```

## Compatibility / Rollback

Purely additive: new decoders + new fixture files + new test blocks + one import
line in `protocol-v2.js` (of already-exported frozen arrays). No existing decoder,
fixture, signature, or `retention-policy.js` line changes. New `src/` symbols stay
in `protocol-v2.js`, so the `node --check` chain needs no new file entry. Rollback
= drop the new decoders, import, fixtures, and test blocks.
