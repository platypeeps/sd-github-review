# Research: Review Candidate Catalog — reuse / overlap map

- **Query**: Scope a new pure contract module for "Define review candidate catalog"; map reuse vs. distinct surfaces against `src/protocol-v2.js` and `src/retention-policy.js`; recommend module + import boundary; extract retention-policy.js conventions to mirror; propose exports and fixtures.
- **Scope**: internal
- **Date**: 2026-08-05

## Summary decision

Create a NEW leaf contract module `src/review-candidate-catalog.js`, mirroring the
`src/retention-policy.js` precedent: its own frozen vocabularies, its own private
primitive validators (copied, not imported), `decodeX(value, field)` decoders that
return `Object.freeze`d bounded records, and a `deriveCatalogDigest`/`stableCatalogJson`
digest pair. Register it in `test/dependency-boundaries.test.js` `ALLOWED` and in the
`check` script `node --check` list. Recommended import set: `[]` (no local imports),
matching `retention-policy.js`. See §3 for the boundary justification and the one
tension (retention lifecycle reuse) that the implementing agent must decide.

---

## 1. What each protocol-v2.js catalog/candidate/profile export does today

Exact signatures and frozen vocabularies quoted from `src/protocol-v2.js`.

### Frozen vocabularies (catalog-adjacent)

```js
export const PROMPT_PROFILE_MODES = Object.freeze(["referenced", "handler-managed"]); // L47
export const CANDIDATE_SLOTS = Object.freeze(["managed", "parallel"]);                // L64
export const REVIEW_LANES = Object.freeze(["review", "assurance", "gate"]);           // L61
export const COST_TIERS = Object.freeze(["free", "low", "medium", "high", "unknown"]);// L77
export const AVAILABILITY_STATES = Object.freeze(["available", "degraded", "unavailable"]); // L80
export const SLOT_SELECTOR_KINDS = Object.freeze(["candidate", "chain"]);             // L69
```

Note `preflight.units` is validated inline as `new Set(["tokens"])` (L671) — there is
no exported units vocabulary today.

### Exports (what each decodes/validates)

| Export | Signature | Decodes / validates today |
|---|---|---|
| `decodePromptProfileBinding` | `(value, field = "promptProfile")` (L491) | A per-candidate/route **binding** (discriminated union). `mode` ∈ `PROMPT_PROFILE_MODES`. `handler-managed` → `{ mode }` only (alias/version/digest forbidden). `referenced` → `{ mode, alias, version, digest }` where `alias` = `aliasValue` (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤64, lower), `version` = `semverLikeValue` (`^\d+\.\d+\.\d+$`), `digest` = `digestValue` (`^[a-fA-F0-9]{64}$`). Rejects `default`/`inheritance`/`fallback`/`commandOverride`/`runtimeOverride`. **No registry, no capabilities, no profile body.** |
| `decodeCandidatePreflight` | `(value)` (L666) | A per-request side-effect-free preflight. Binds `headSha`, `candidateDigest`, `promptProfileDigest`, `policyDigest`, `configurationDigest`, `units` (inline `"tokens"`), `countedInputTokens`, `inputCounted`, `outputCap`, `maxExpectedCharge`, `hardRequestLimit`, `safetyMargin`, and `capabilityEvidence {available, reason?}`. Enforces `maxExpectedCharge ≤ hardRequestLimit`. This is the closest existing carrier of hard limits/units/counting evidence, but it is a **per-attempt request record keyed by digests**, not a catalog candidate record. |
| `decodeCandidateOptionsResponse` | `(value)` (L760) | A bounded, **unauthenticated** catalog *view*. Each option (`decodeCandidateOption`, L727): `alias`, `displayName`, `handler`, `costTier`, `eligibleLanes` (⊂ `REVIEW_LANES`), `eligibleSlots` (⊂ `CANDIDATE_SLOTS`), `availability {state, reason?}`. Response carries `catalogDigest` + `configurationDigest`. Explicitly rejects attempt-identifying fields (`headSha`/`logicalDispatchId`/`attempt`). **No model target, no policy/credential/budget refs, no cost limits, no tokenizer/finish-reason facts, no profile registry.** |
| `decodeCheckProjection` | `(value)` (L1110) | Exact-head Check projection: `checkName` ∈ {assurance,gate}, `headSha`, `conclusion`, `revision`, `attempt`, `latestAuthorizedAttemptToken`. Not catalog content — included in prompt only as a projection/authorization reference. |
| `authorizeProjectionWrite` | `(previous, next, { authorizedAttemptToken })` (L1137) | Pure compare-and-swap on a Check projection. Not catalog content. |
| `decodeReviewerPlanSource` | `(value)` (L1256) | Source-side reviewer plan: one `lane` + 1..`MAX_REVIEWER_SLOTS`(8) slots, each `{slotId, lane, selector, required, overridable, timeoutSeconds, minSuccesses}`. |
| `decodeReviewerCatalog` | `(value)` (L1290) | **The lighter reviewer-plan-source catalog — NOT this task's catalog.** See below. |
| `compileReviewerPlan` | `({ source, catalog, headSha, compiledDigest, overrides })` (L1437) | Compiles a plan against a pinned `decodeReviewerCatalog`, proving lane eligibility, disjoint candidate sets, thresholds; emits frozen parent/child identities. Consumer of the light catalog. |
| `decodeReviewerPlanOptions` | `(value)` (L1499) | `/review options` view: `lane`, `catalogDigest`, `overridableSlots[]{slotId, safeCandidates[]}`. |
| `assertReviewerSelectionLabel` | `(value, field = "selectionLabel")` (L1543) | Comment-command label guard: must be a broad `REVIEW_LANES` label; rejects `candidate:`/`slot:`/`chain:` prefixes. |

### Is `decodeReviewerCatalog` the same "catalog" this task means? — **No.**

`decodeReviewerCatalog` (L1290-1355) returns:

```js
return { catalogDigest, byAlias, byDigest, chains };
```

Each candidate record is only `{ alias, candidateDigest, eligibleLanes }` (L1318),
and `chains` maps a name → member aliases. Its sole purpose (per its own comment,
L1288-1289) is "to expand chains and prove lane eligibility" inside
`compileReviewerPlan`. It carries **no** catalog *name/version*, **no** handler/model
target, **no** credential/budget/policy refs, **no** cost limits, **no** tokenizer/
units/finish-reason/usage capabilities, **no** failover, and **no** prompt-profile
registry. It is a lightweight *reviewer-plan-source* catalog. This task's catalog is
the immutable, content-addressed **candidate + prompt-profile registry** with
dispatch-safe policy — a distinct, richer contract.

---

## 2. Distinct contract surfaces this task requires that protocol-v2.js does NOT provide

Sources: `prd.md`, `design.md`, `implement.md`. Distinct surface count: **9**.

1. **Immutable catalog identity (name + version + digest).** protocol-v2 only carries a
   bare `catalogDigest` string on other records; there is no decoder for the catalog
   *document* with a `name`/`version`/`digest` tuple and digest self-verification
   (mirroring how `decodeRetentionProfile` verifies `profile.digest` against canonical
   content). **New.**
2. **Stable candidate alias records** binding: lane eligibility + handler/model target +
   opaque credential/budget/policy refs + hard input/output/per-request cost limits +
   tokenizer/counting evidence + explicit units + finish-reason/usage capabilities +
   same-model endpoint failover. Existing records each hold a *slice* only
   (`decodeReviewerCatalog`: alias/digest/lanes; `decodeCandidateOption`: alias/handler/
   costTier/lanes/slots/availability; `decodeCandidatePreflight`: units/limits/evidence
   per attempt). No single immutable catalog candidate record exists. **New.**
3. **Immutable prompt-profile REGISTRY** (alias/version/digest + compatible handler +
   capabilities, no bodies). protocol-v2 has only a per-candidate *binding*
   (`decodePromptProfileBinding`), not a registry of profile metadata a binding is
   validated against. **New.**
4. **Exactly-one-profile binding rule for external candidates + `handler-managed` for
   native**, resolved *against the registry* (reuse across compatible candidates,
   candidate-specific allowed; reject missing/unknown/duplicate/mismatched/substituted).
   The binding *shape* exists; the catalog-level rule + registry cross-check does not.
   **New (composes the existing binding shape).**
5. **Bounded safe projection** exposing only compile/dispatch-safe facts + profile
   alias/version/digest/compatibility, excluding secrets, management endpoints, raw
   provider metadata, and prompt/config bodies. `boundedOutput` (L452) is a generic
   allow-list helper and `decodeCandidateOptionsResponse` is a lighter view, but the
   catalog's dispatch-safe projection (with policy/limits/units/finish-reason facts) is
   **New.**
6. **Disablement / replacement (portable model replacement)** — quarantine as a mutable
   control-plane overlay keyed to an immutable alias, never mutating a pinned version.
   **New.**
7. **Version transition / rollback semantics** — new version+digest on change; digest
   change invalidates dependent candidate/profile tuples; rollback restores, never
   mutates history. **New.**
8. **Audit semantics** around the above (no mutation of a pinned version). **New.**
9. **`standard-v1` 13-month reference-aware retention** for catalog/safe-policy versions.
   This **REUSES `retention-policy.js`** — the data classes already exist there
   (`catalog_policy_version` and `static_prompt_profile`, both `referenceGraceMonths: 13`;
   `static_prompt_profile` also `prohibitsPrContent: true`). The catalog module must
   emit records classifiable under those classes / bind to `STANDARD_V1`, not
   re-derive the lifecycle math. **Reuse, not new.**

### Reuse table (export → reuse | distinct)

| protocol-v2 export | Verdict for this task |
|---|---|
| `PROMPT_PROFILE_MODES` | **Reuse concept** (mirror value `["referenced","handler-managed"]`; native = handler-managed). |
| `CANDIDATE_SLOTS`, `REVIEW_LANES`, `COST_TIERS`, `AVAILABILITY_STATES` | **Reuse concept** for lane/slot eligibility + cost tier + availability (mirror vocabularies). |
| `decodePromptProfileBinding` | **Partial reuse** — binding shape is right; the registry cross-check + exactly-one rule are new. |
| `decodeReviewerCatalog` | **Distinct** — lighter plan-source catalog, not this catalog. |
| `decodeCandidateOptionsResponse` / `decodeCandidateOption` | **Distinct** — lighter view; new safe projection needed. |
| `decodeCandidatePreflight` | **Distinct** — per-attempt request; catalog holds the *static* limits/units/capabilities it references. |
| `boundedOutput`, `deriveV2Fingerprint`, `stableV2Json` | **Reuse concept** (mirror equivalent helpers locally). |
| `decodeCheckProjection`, `authorizeProjectionWrite`, `compileReviewerPlan`, `decodeReviewerPlanSource`, `decodeReviewerPlanOptions`, `assertReviewerSelectionLabel` | **Distinct / out of scope** — plan compilation & projection, not catalog definition. |
| `retention-policy.js`: `catalog_policy_version` / `static_prompt_profile` classes, `STANDARD_V1`, `computeRecordLifecycle` | **Reuse** — lifecycle owner for the 13-month tail. |

---

## 3. Module recommendation + import boundary

### Recommendation: NEW leaf module `src/review-candidate-catalog.js` (do not extend protocol-v2.js)

Justification:
- **Convention** (`directory-structure.md` L88-98): "Put pure versioned contract
  definitions ... in their **own leaf modules**. ... they must not access the network,
  filesystem, environment, GitHub output surfaces, or route policy, and they take no
  ambient time: every lifecycle/expiry computation receives an injected `nowIso`."
  It explicitly names both `protocol-v2.js` and `retention-policy.js` as *separate* leaf
  contracts. A third pure contract follows the same "own leaf module" rule.
- **Precedent**: `retention-policy.js` was added as a separate leaf rather than folded
  into `protocol-v2.js`, even though it shares identical primitive validators — it
  **re-implements** them (`src/retention-policy.js` L190: "primitive validators (matching
  protocol-v2 semantics)") instead of importing. The catalog should follow this exact
  pattern.
- **Scope**: extending `protocol-v2.js` (already 1588 lines) with catalog identity,
  registry, projection, quarantine, and retention binding would overload the v2 wire/
  storage contract module.

### Allowed import direction — from `test/dependency-boundaries.test.js`

The `ALLOWED` matrix (L18-49) freezes a one-way downhill direction. Relevant entries:

```js
"protocol-v2.js": ["protocol.js"],
"retention-policy.js": [],
```

- `retention-policy.js` imports **nothing local** (`[]`) — it is a pure leaf even though
  it is not in the hardcoded `LEAVES` list (L51, which is only the four util leaves).
- There is **no existing contract→contract edge** (e.g. protocol-v2 → retention-policy).
- The test enforces: (a) completeness — every `src/*.js` must appear in `ALLOWED`
  (L79-90), so the new module MUST be added; (b) each module imports only modules listed
  for it (L92-102).

**Recommended matrix entry:** `"review-candidate-catalog.js": []` — import no local
module. Mirror the vocabularies/validators it needs (the retention-policy.js pattern),
and for retention, emit records **classified** under `catalog_policy_version` /
`static_prompt_profile` that a higher layer feeds to `retention-policy.js`
`computeRecordLifecycle`. This keeps the module a self-contained leaf and adds no new
contract→contract edge.

**Tension to decide (flagged, not resolved):** if the catalog module is intended to
*directly run* the 13-month lifecycle computation itself (rather than just emitting a
classified record), it would need to import `retention-policy.js`
(`computeRecordLifecycle`, `STANDARD_V1`), i.e. matrix entry
`"review-candidate-catalog.js": ["retention-policy.js"]`. That is **permitted** by the
test once the matrix lists it (retention-policy is downhill of any consumer and imports
nothing, so no cycle), but it would be the **first pure-contract→pure-contract import
edge** in the repo and departs from the retention-policy.js "duplicate, don't cross-
import" precedent. Importing `protocol-v2.js` vocabularies is the same story: allowed if
listed, but no precedent exists and it inverts nothing only because protocol-v2 sits
"left". Given precedent, the mirror-and-classify approach (`[]`) is the lower-risk
recommendation; the implementing agent should confirm which side owns the lifecycle call.

---

## 4. retention-policy.js conventions to mirror

The catalog should copy these structural patterns verbatim in spirit.

**Frozen vocabularies + Sets** (L36-48 example):
```js
export const RETENTION_DATA_CLASSES = Object.freeze([ ... ]);
const RETENTION_DATA_CLASS_SET = new Set(RETENTION_DATA_CLASSES);
```

**Private validators** (L283-399): `stringValue(value, field, {maximum, pattern, lower})`,
`enumValue(value, field, allowed)`, `integerValue(value, field, {minimum, maximum})`,
`booleanValue`, `timestampValue` (ISO-8601 UTC), `digestValue`
(`/^[a-fA-F0-9]{64}$/`), `semverLikeValue` (`/^\d+\.\d+\.\d+$/`), `aliasValue`
(`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, lower), `repositoryValue`, `objectValue`. Plus the
parameterized privacy walker `rejectFieldNames(value, field, forbidden, boundaryLabel)`
(L207) with the two wrappers `rejectForbiddenContent` (L259) and
`rejectIdentifyingFields` (L264), and `assertEncodedSize` (L268) with
`CONTRACT_MAX_BYTES`/`RESPONSE_MAX_BYTES` bounds.

**`decodeX(value, field)` returning frozen bounded objects**: e.g.
`decodeRetentionProfile` (L541) and `decodeRecordClassification` (L621) both run
`rejectForbiddenContent` → `assertEncodedSize` → `objectValue` → `schemaVersion` →
field decode → `Object.freeze(normalized)`. `static_prompt_profile` records additionally
run `rejectIdentifyingFields` (L661) — the catalog's profile-metadata decoder should do
the same (no PR-specific content in profile config).

**Digest derivation helper to mirror exactly** (L403-426 + build at L512-527):
```js
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [key, canonicalize(value[key])]),
  );
}
export function stableRetentionJson(value) {
  return JSON.stringify(canonicalize(value));
}
function sha256(value) {
  return createHash("sha256").update(stableRetentionJson(value), "utf8").digest("hex");
}
export function deriveRetentionDigest(fields) {
  return sha256(canonicalize(fields));
}
```

And the immutable content-addressed build (mirror for the catalog's canonical version):
```js
function buildStandardV1() {
  const body = { retentionPolicyId: "standard-v1", version: "1.0.0", schemaMajor: RETENTION_SCHEMA_MAJOR, ... };
  const digest = deriveRetentionDigest(body);
  ...
  return Object.freeze({ ...body, classes: Object.freeze(classes), digest });
}
export const STANDARD_V1 = buildStandardV1();
```
Digest self-verification to mirror (L594-596):
```js
if (profile.digest !== undefined && digestValue(profile.digest, "...") !== digest) {
  throw new Error("retentionProfile.digest does not match its canonical content");
}
```

**Injected `nowIso`** (L912): `computeRecordLifecycle(record, { nowIso, hold, profile = STANDARD_V1 })`
— `const now = timestampValue(nowIso, "nowIso")`. The catalog module takes **no ambient
time**; any lifecycle-adjacent helper receives `nowIso`.

The catalog's own forbidden-field set must protect prompt/profile bodies, credentials,
secrets, management endpoints, and configuration values — mirror
`FORBIDDEN_CONTENT_FIELDS` (retention L112-156) and protocol-v2 `FORBIDDEN_FIELD_NAMES`
(L168-211), which already include `promptbody`/`profilebody`/`configuration`/`config`/
`credential`/`secret`/`token`/`apikey`/`content`; add a `managementendpoint` /
`endpoint` term (retention already lists `managementendpoint`, L152).

---

## 5. Fixtures

### Existing under `fixtures/protocol/v2/` (relevant)

| File | Relevance |
|---|---|
| `reviewer-catalog.valid.json` | The **light** plan-source catalog (valid only; no `.invalid`). Not this task's catalog. |
| `candidate-options.valid.json` / `.invalid.json` | Lighter candidate view. |
| `candidate-preflight.valid.json` / `.invalid.json` | Per-attempt limits/units/evidence. |
| `check-projections.valid.json` / `.invalid.json` | Check projection CAS. |
| `source-contracts.valid.json` / `.invalid.json` | Carries `promptProfile` bindings + managed lanes/candidates. |
| `privacy-fields.invalid.json` | protocol-v2 forbidden-field rejection. |
| `retention-standard-v1.json`, `retention-status.*`, `retention-legal-hold.*`, `retention-purge.*`, `retention-privacy-fields.invalid.json` | retention-policy.js contract fixtures to reuse for lifecycle tail. |
| `self-reported-usage.valid.json` / `.invalid.json` | Advisory usage. |
| `reviewer-plan-source.*`, `reviewer-plan-options.*`, `outcomes.*`, `local-*` | Plan compile / outcomes / local-attested (out of scope). |

Naming convention observed: `fixtures/protocol/v2/<topic>.<valid|invalid>.json` (a few
single-file `.json` or `.invalid.json`-only where only one polarity is meaningful).

### Proposed NEW fixture files (map to prd Acceptance Criteria)

| Proposed file | Proves |
|---|---|
| `review-candidate-catalog.valid.json` | Immutable catalog name/version/digest, alias stability, lane/capability, digest verification, portable model replacement (AC L37-38). |
| `review-candidate-catalog.invalid.json` | Unknown/duplicate/disabled/malformed/policy-incomplete candidates fail closed; unverifiable token/price/unit/finish-reason/usage rejected (AC L44-48). |
| `prompt-profile-registry.valid.json` | Reuse across compatible candidates, candidate-specific profile, handler compatibility, native `handler-managed` (AC L39-41). |
| `prompt-profile-registry.invalid.json` | Rejection of missing/unknown/duplicate/mismatched/substituted profiles; forbidden lane default/inheritance/override (AC L41). |
| `candidate-safe-projection.valid.json` | Projection exposes profile alias/version/digest + compatibility + dispatch-safe policy, only preflight/hard-limit facts (AC L47, L49). |
| `candidate-safe-projection.invalid.json` | Projection with credential/billing payload/private endpoint/prompt body/config value is rejected (AC L42-43, L50). |
| `catalog-privacy-fields.invalid.json` | Forbidden-field walker (prompt/profile bodies, secrets, endpoints, config values). |
| `catalog-fail-closed.invalid.json` | Policy-incomplete / conflicting-classification fail-closed (AC L44). |
| `catalog-retention.fake-clock.json` | Fake-clock: active references, final-reference removal, 13-month tail, hold/purge interaction, no dangling retained receipt (AC L53-54). |

(If the team prefers folding some invalid cases into a single `.invalid.json` per topic
to match `reviewer-catalog`'s single-file style, the retention fake-clock and privacy
fixtures should still be their own files, mirroring the existing retention fixtures.)

---

## 6. Proposed export list for `src/review-candidate-catalog.js`

Recommendation only (mirrors retention-policy.js export shape: vocabularies + digest
helpers + `decodeX` decoders):

- Schema/version: `CATALOG_SCHEMA_MAJOR`.
- Frozen vocabularies (mirror, don't import): `CANDIDATE_KINDS` (`["external","native"]`),
  `PROMPT_PROFILE_MODES` (mirror `["referenced","handler-managed"]`), `COUNTING_UNITS`
  (`["tokens"]`), lane/slot/cost-tier vocabularies (mirror `REVIEW_LANES`,
  `CANDIDATE_SLOTS`, `COST_TIERS`), a finish-reason/usage-capability vocabulary.
- Digest helpers: `stableCatalogJson(value)`, `deriveCatalogDigest(fields)`.
- Decoders (each `rejectForbidden…` → `assertEncodedSize` → `objectValue` →
  `schemaVersion` → decode → `Object.freeze`):
  - `decodeCandidateCatalog(value)` — immutable catalog identity (name/version/digest,
    self-verifying) + candidate records + embedded/keyed profile registry.
  - `decodePromptProfileRegistry(value)` — profile metadata (alias/version/digest +
    compatible handler/capabilities), no bodies (also runs identifying-field rejection).
  - `decodeCandidateRecord(value, field)` — one candidate (lane eligibility, handler/model
    target, opaque credential/budget/policy refs, hard input/output/per-request limits,
    tokenizer/counting evidence, units, finish-reason/usage capabilities, same-model
    failover, exactly-one profile binding or `handler-managed`).
  - `decodeCandidateSafeProjection(value)` — bounded dispatch-safe projection.
  - `decodeCandidateQuarantine(value)` — mutable disablement overlay keyed to an
    immutable alias (never mutates a pinned version).
  - retention binding: either `classifyCatalogRetention(record)` producing a
    `catalog_policy_version` / `static_prompt_profile` classification for
    `retention-policy.js`, or (if the tension in §3 is resolved toward importing)
    a thin `computeCatalogRetention({ …, nowIso })` wrapper over `computeRecordLifecycle`.

---

## Caveats / Not found

- The exact field names for handler/model target, credential/budget/policy refs,
  tokenizer evidence, finish-reason capabilities, and failover are **not** yet specified
  anywhere in the repo (prd/design describe them narratively); the implementing agent
  defines them. This research maps reuse and structure, not the final field schema.
- `reviewer-catalog.valid.json` ships **without** an `.invalid.json` counterpart — an
  intentional-looking gap; noted so the new catalog fixtures deliberately add invalid
  cases (AC requires fail-closed proofs).
- `check` script `node --check` list and `test/dependency-boundaries.test.js` `ALLOWED`
  both require the new module to be registered (directory-structure.md L96-98); not doing
  so fails the completeness test at L79-90.
- Database guidelines: the Action is **stateless, no DB** — the catalog is a pure
  in-memory contract; the durable/immutable-versioned semantics are enforced by the
  consumer control plane, not local persistence (do not introduce persistence).
- Logging guidelines: protocol validation errors must **name only the field and violated
  bound**, never echo the rejected value; projections/logs must never carry prompts,
  configuration values, credentials, tokens, endpoints, or provider transcripts — the
  forbidden-field walker + bounded projection enforce this at the contract boundary.
