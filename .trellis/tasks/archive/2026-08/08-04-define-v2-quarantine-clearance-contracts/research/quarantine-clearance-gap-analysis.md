# Research: v2 quarantine status & clearance contracts — genuine net-new gap

- **Query**: Determine the GENUINE net-new work for task `08-04-define-v2-quarantine-clearance-contracts` vs. what is already implemented (mirrors a prior sibling that found its envelope already built).
- **Scope**: internal
- **Date**: 2026-08-05

---

## TL;DR

- **The frozen reason-code enum is DONE.** All 4 residual codes (`input_ineligible`,
  `incomplete_token_limit`, `budget_overrun`, `candidate_quarantined`) are already
  members of `OUTCOME_REASON_CODES` (`src/protocol-v2.js:135-139`). No enum edit needed.
- **Two quarantine decoders already exist** but NEITHER satisfies parent AC13: they
  bind at most `{candidate/alias, state, reason, effectiveAt}` and do **not** bind
  actor, remediation evidence, policy/configuration digest, or audit identity.
- **No "clearance" decoder exists anywhere** (`grep -rni clearance src/ test/ fixtures/`
  → 0 hits). Clearance request/response is **entirely net-new**.
- **None of the 4 residual reason codes appear in ANY fixture** (`grep -rln` across
  `fixtures/` → 0 hits for all four). All four still lack distinct valid/invalid
  fixtures. This is the whole of parent AC10-residual.

So, unlike the sibling task that found its envelope pre-built, **this task has real
net-new surface**: a quarantine-status + clearance decoder trio, plus 4 residual
reason-code fixtures.

---

## Findings

### (a) What already exists and which AC it (partially) touches

#### Frozen reason-code enum — COMPLETE (no work)

`src/protocol-v2.js:131-150`:
```js
export const OUTCOME_REASON_CODES = Object.freeze([
  "completed", "not_managed", "review_none",
  "input_ineligible",            // :135
  "incomplete_token_limit",      // :136
  "budget_overrun",              // :137
  "policy_violation",
  "candidate_quarantined",       // :139
  "pool_overdrawn", "budget_exhausted_deferred",
  "local_clean", ...
]);
const OUTCOME_REASON_CODE_SET = new Set(OUTCOME_REASON_CODES); // :150
```
All 4 residual codes are already frozen members. The design's "frozen reason enum"
dependency (`prd.md` Dependencies) is satisfied by the archived core task.

#### Existing quarantine surface — PARTIAL, does NOT satisfy AC13

| Decoder | Location | Fields bound | Missing vs AC13 |
|---|---|---|---|
| `decodeCandidateQuarantine` | `src/review-candidate-catalog.js:965-993` | `schemaMajor, catalogDigest, alias, state, reason, effectiveAt, replacementModel` (`replaced` only), `mutatesPinnedVersion:false` | actor, remediation evidence, policy digest, configuration digest, audit identity |
| `decodeQuarantineRecord` | `src/review-budget-ledger.js:687-695` | `candidate, state, reason, effectiveAt` | actor, remediation evidence, policy/config digest, audit identity |

- `decodeCandidateQuarantine` is a **catalog control-plane overlay** tied to an
  immutable alias; it forbids catalog content via `rejectCatalogContent` /
  `CATALOG_CONTENT_FIELDS = {candidate, candidates, promptprofile, promptprofiles, policy}`
  (`review-candidate-catalog.js:181-187`) so it "never mutates a pinned version".
  States: `QUARANTINE_STATES = ["quarantined","released","replaced"]` (`:78`).
- `decodeQuarantineRecord` is embedded inside budget-ledger state
  (`review-budget-ledger.js:646-657`, called from ledger decode). States:
  `["quarantined","released"]` (`:97`). `candidate_quarantined` is also an
  `INELIGIBILITY_REASON` used by `reserve()` to deny capacity
  (`:91`, returned at `:804`) — i.e. quarantine already denies budget, consistent
  with "grant no implicit budget authority".

Neither is a **quarantine STATUS contract** binding the full AC13 tuple, and there
is no clearance contract at all.

#### Reusable primitives already present (for the net-new decoder)

- `deriveV2Fingerprint(fields)` — `src/protocol-v2.js:446` (digest fingerprint).
- `decodeLocalPublicationContext` — `src/protocol-v2.js:942-954`: the existing
  GitHub audit-identity pattern (`publisher/aliasValue`, `association`, `isPrAuthor`,
  `workflowRef`, `runId`, `runAttempt`). Reusable shape for "audit identity".
- `REQUEST_DERIVED_FORBIDDEN` — `src/protocol-v2.js:959-971`: rejects caller-asserted
  `actor/association/publisher/authorized/trustLevel`. The template for "grant no
  implicit dispatch authority" — a clearance request must not pre-assert authority.
- `digestValue`, `enumValue`, `timestampValue`, `aliasValue`, `stringValue`,
  `rejectForbiddenFields`, `FORBIDDEN_FIELD_NAMES` (`:168-211`), `Object.freeze`.

### (b) The GENUINE net-new work

1. **Quarantine STATUS schema (AC13)** — a decoder binding `candidate, actor,
   reason, remediation evidence, policy digest, configuration digest, audit
   identity`, with **no** field granting budget reservation or dispatch
   authorization. Neither existing decoder does this; both must be treated as
   distinct siblings, not extended in place (see risk R1).

2. **Clearance request + response schemas (AC13)** — entirely net-new. Request must
   not pre-assert authority (mirror `REQUEST_DERIVED_FORBIDDEN`); response records
   the adjudicated clearance bound to the same identity tuple + digests, again
   granting no implicit budget/dispatch authority.

3. **4 residual reason-code fixtures (AC10-residual)** — distinct valid/invalid
   fixtures exercising `input_ineligible`, `incomplete_token_limit`,
   `budget_overrun`, `candidate_quarantined`. None appear in any current fixture.
   The ONLY decoder that validates a member of `OUTCOME_REASON_CODES` is
   `decodeReviewOutcomes` via `decodeOutcomeAxis` (`src/protocol-v2.js:795-801,799`).
   NOTE: despite the enum comment "shared across preflight and the three outcome
   axes" (`:130`), `decodeCandidatePreflight` does **not** validate any `reasonCode`
   — it uses `capabilityEvidence.reason` / `CAPABILITY_UNAVAILABLE_SET`
   (`src/protocol-v2.js:696-706`). So the fixture home for all 4 residual codes is
   the **outcome axes** (`outcomes.valid.json` / `outcomes.invalid.json`), not
   preflight.

4. **Test wiring + fixtures** for the new quarantine-status / clearance decoders.

### (c) Recommended minimal design (evidence-backed options, not a mandate)

- **New clearance decoder** is unavoidable (nothing to reuse).
- **Quarantine STATUS**: a NEW decoder is the cleaner fit for AC13 because neither
  existing decoder binds actor/audit/digests, and the catalog overlay deliberately
  forbids identity fields (`IDENTIFYING_FIELDS` at
  `review-candidate-catalog.js:159-176` rejects `actor`, `candidateactor`, etc. for
  profile classification) — reusing it would fight its privacy contract.
- **Home**: `src/protocol-v2.js` is the consistent home (it already holds the reason
  enum, outcome, preflight, and all actor/publication-context wire decoders). Placing
  quarantine-status + clearance next to `decodeReviewOutcomes` (~`:910`) keeps the
  actor/audit-identity + digest-fingerprint idioms local. Reuse
  `decodeLocalPublicationContext`-style audit identity and `deriveV2Fingerprint`.
- **Residual fixtures**: append valid entries to
  `fixtures/protocol/v2/outcomes.valid.json` and invalid entries to
  `outcomes.invalid.json`. The valid loop (`test/protocol-v2.test.js:215-221`) and
  `eachInvalid(invalidOutcomes, decodeReviewOutcomes)` (`:232-233`) auto-cover new
  entries — minimal test churn.

### (d) Cross-file inconsistencies / risks

- **R1 (divergent quarantine vocabularies).** `QUARANTINE_STATES` differ:
  catalog = `["quarantined","released","replaced"]`
  (`review-candidate-catalog.js:78`) vs ledger = `["quarantined","released"]`
  (`review-budget-ledger.js:97`). A new quarantine-status contract introduces a
  THIRD state vocabulary risk. Decide explicitly which set the AC13 status uses and
  document why it diverges, or reference one of the existing frozen sets.
- **R2 (`budget_overrun` overload).** It is both an `OUTCOME_REASON_CODE`
  (`protocol-v2.js:137`) and a reconciliation `budgetClass`
  (`src/review-usage-reconciliation.js:81,723`). The residual fixture must exercise
  it as an **outcome reason code** (via `decodeReviewOutcomes`), not the
  reconciliation class, or the fixture won't prove AC10-residual for the reason enum.
- **R3 (no implicit authority).** AC13 requires "no implicit budget or dispatch
  authority". The new schemas must carry no capacity/reservation/dispatch field and
  should reject caller-asserted authority — mirror `REQUEST_DERIVED_FORBIDDEN`
  (`protocol-v2.js:959-971`) and the `FORBIDDEN_FIELD_NAMES` walk.
- **R4 (privacy walk).** Any remediation-evidence field must not carry prompts /
  findings / output / content — the existing `FORBIDDEN_FIELD_NAMES`
  (`protocol-v2.js:168-211`) already covers `finding(s)`, `output(s)`,
  `content(s)`, `transcript(s)`; a "remediation evidence" reference should be a
  digest/alias, not a body.

### (e) Precise insertion points

| Work | File:line |
|---|---|
| New `decodeQuarantineStatus` + `decodeClearanceRequest` + `decodeClearanceResponse` (+ exports) | `src/protocol-v2.js` after `decodeReviewOutcomes` (ends ~`:910`), before `decodeSelfReportedUsage` (`:914`) |
| Reuse audit-identity shape | `src/protocol-v2.js:942-954` (`decodeLocalPublicationContext`) |
| Reuse fingerprint / forbidden-assert idioms | `src/protocol-v2.js:446` (`deriveV2Fingerprint`), `:959-971` (`REQUEST_DERIVED_FORBIDDEN`) |
| Residual reason-code valid fixtures | append to `fixtures/protocol/v2/outcomes.valid.json` (array; current last entry "review:none...") |
| Residual reason-code invalid fixtures | append to `fixtures/protocol/v2/outcomes.invalid.json` |
| New quarantine-status / clearance fixtures | new files under `fixtures/protocol/v2/` (e.g. `quarantine-status.{valid,invalid}.json`, `clearance-request.{valid,invalid}.json`, `clearance-response.{valid,invalid}.json`) |
| Test fixture loaders | `test/protocol-v2.test.js:41-69` (add `fixture(...)` loads) |
| Test blocks + invalid loops | `test/protocol-v2.test.js` new `test(...)` + `eachInvalid(new, decodeX)`; outcomes valid loop `:215-221` + `eachInvalid` `:232-233` auto-cover appended outcome entries |

### Test harness conventions (`test/protocol-v2.test.js`)

- `fixture(rel)` — `:36-39`: `JSON.parse(readFile(new URL('../fixtures/'+rel)))`.
  Fixtures are arrays of `{name, value, error?}`.
- `eachInvalid(entries, decode)` — `:75-79`: `assert.throws(() => decode(entry.value),
  new RegExp(entry.error,'u'), entry.name)`. Invalid fixtures MUST carry an `error`
  regex string; error messages must not echo the offending value (see size-bound
  assertion `:207-210`).
- Valid pattern: loop the valid array and assert decoded shape (e.g. `:215-221`).

### Coding-spec idioms (`.trellis/spec/backend/index.md` + source)

`index.md` points to error-handling / quality / logging guides; it does not itself
restate the decoder contract. The enforced idioms live in source and are:
fail-closed decoders (`enumValue` on frozen `Set`s, unknown → throw),
`Object.freeze` / `freezeDeep` returns, digest-fingerprint identity
(`deriveV2Fingerprint`), forbidden-field walk before canonicalization
(`FORBIDDEN_FIELD_NAMES`), no private content (prompts/config/findings/output),
size bounds (`assertEncodedSize` with `CONTRACT_MAX_BYTES` / `RESPONSE_MAX_BYTES`),
and caller-asserted-authority rejection (`REQUEST_DERIVED_FORBIDDEN`).

## Related specs

- `.trellis/tasks/archive/2026-08/07-25-define-budget-review-v2-contracts/design.md`
  — shared/inherited design. It scopes this child to "versioned wire and storage
  shapes, canonical identity rules, privacy bounds". It states outcome contracts
  keep review/assurance/gate decisions independent and receipts grant no authority,
  but it contains **no explicit line assigning quarantine/clearance work to a named
  child task** and does not mention "clearance" — the split is implied by
  `prd.md` (parent AC13). Flag: scope-split for quarantine/clearance is inferred
  from the PRD, not spelled out in the shared design.
- `.trellis/spec/backend/index.md` — backend contract index.

## Caveats / Not found

- The active task per `task.py current` is `08-05-guard-v2-fingerprint-identity-completeness`
  (state: stale), NOT this task. Findings were written to the task dir named in the
  assignment as instructed.
- No `clearance` token anywhere in `src/`, `test/`, or `fixtures/` — clearance is
  net-new; there is nothing to reuse or extend.
- The exact field names/shape for "remediation evidence" and "audit identity" are
  a design decision (see R1/R3/R4); this research flags the constraints and reusable
  patterns rather than prescribing the schema.
