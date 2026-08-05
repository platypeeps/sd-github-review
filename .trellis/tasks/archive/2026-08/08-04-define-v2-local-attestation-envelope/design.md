# Design — v2 local-attestation evidence envelope

## Scope / Trigger

Cross-layer contract change in `src/protocol-v2.js` (the v2 review protocol
decoders) plus fixtures and tests. Triggers code-spec depth: it changes a
contract's validation behavior (a new fail-closed rule in
`decodeReviewOutcomes`) and adds decoder-level proofs.

## Key finding that shapes this design

The local-attestation **evidence envelope is already implemented** (committed by
`5f80759`, task `07-25-define-local-review-attestation-contracts`). The binding
of (a) exact-head evidence, (b) authenticated GitHub publication context, and
(c) `repository_attested` trust is realized by the existing pair:

- `decodeLocalReviewAuthorization` (`src/protocol-v2.js:997`) — the ingestion
  boundary that **mints** `repository_attested` trust from `decodeLocalEvidenceBinding`
  (exact-head) + `decodeLocalPublicationContext` (authenticated actor/association/
  workflow) + `decodeAttestedTrustLevel`; only `authorized && reviewResult==="clean"`.
- `decodeLocalReviewReceipt` (`src/protocol-v2.js:1044`) — the immutable durable
  receipt carrying the same three axes; `gateSatisfied` only for `completed_local`.

`decodeAttestedTrustLevel` (`:889`) already makes `independent` unmintable, and
`decodeLocalAttestationRequest`'s `REQUEST_DERIVED_FORBIDDEN` (`:949`) already
proves a caller assertion cannot inject its own actor/trust/authorization.

### Design decision: no redundant named `…Envelope` decoder (R1, not R2)

A new `decodeLocalAttestationEnvelope` would duplicate `decodeLocalReviewReceipt`
field-for-field — dead code that adds a coverage burden and a second source of
truth for the same invariant. The repo convention for these sibling contract
tasks is proof-focused, no-duplication, single-source decoders. So this task
**documents** the envelope as the existing composition and delivers the genuine
net-new work: the AC2 enforcement + proofs. AC1 is proven by assertion tests on
the existing valid fixtures.

Scope note (authentication vs. structural validation): the existing pair
*structurally* validates the publication context and binds `repository_attested`
trust; it does not itself *authenticate* the GitHub actor or apply evidence-age
policy. Those are ingestion-boundary responsibilities — age policy already lives
in `decodeAttestationPolicy` (`src/protocol-v2.js:520`). This task's AC1 proof
therefore asserts the envelope *binds* exact-head evidence + the full
authenticated publication context + `repository_attested`; it does not re-prove
authentication/age, which the inherited design assigns to ingestion.

Also note (corrected from an earlier draft): `repository_attested` trust is
validated *before* authorization (`decodeLocalReviewAuthorization:1005-1006`), so
an unauthorized-findings authorization still carries `repository_attested`
(`fixtures/protocol/v2/local-authorization.valid.json`); only an *authorized
pass* additionally requires `reviewResult === "clean"` (`:1018`).

## The genuine gap (AC2) and the one behavior change

`review_none` is under-enforced. It is a **reason code** (`OUTCOME_REASON_CODES`,
`src/protocol-v2.js:134`), and the three outcome axes validate state and reason
**independently** with no pairing rule (`decodeOutcomeAxis`). Today:

- Its assurance axis is unguarded: a `review_none` review can pair with
  `assuranceOutcome.state:"pass"`.
- Its gate axis is only forced to block when the review *state* is `skipped`
  (via `reviewSkippedNonBudget`, `:835-836` → `:850`). A `{state:"completed",
  reasonCode:"review_none"}` review — confirmed by an executable probe — leaves
  the gate free too, so `{completed/review_none, assurance:pass, gate:pass}`
  currently decodes: a review that never happened claims a full pass.

The correct invariant is keyed on the **reason**, not the review state: a
`review_none` reason means no managed review was performed, so it can neither
satisfy assurance nor free the gate, regardless of the review axis state.

### Contract rule (fail-closed)

In `decodeReviewOutcomes`, immediately after the existing local-blocking
pass-guard (`:842-844`), add two guards keyed strictly on the `review_none`
reason:

```js
// review:none means no managed review was performed. Keyed on the reason
// (not the review state), it can neither satisfy assurance nor free the gate,
// regardless of which review-axis state carries it.
const reviewNone = reviewOutcome.reasonCode === "review_none";
if (reviewNone && assuranceOutcome.state === "pass") {
  throw new Error("outcomes.assuranceOutcome cannot pass when the review reason is review_none");
}
if (reviewNone && gateOutcome.state !== "block") {
  throw new Error("outcomes.gateOutcome must block when the review reason is review_none");
}
```

Scoped to `reasonCode === "review_none"` only — it does **not** touch the
independent-axes semantics for other non-budget skips (a legitimate non-budget
skipped review with a passing assurance axis and a blocking gate remains valid;
the existing `reviewSkippedNonBudget` gate-block rule is unchanged). No existing
valid fixture uses `review_none`, so nothing regresses.

## Contracts (unchanged signatures; one stricter rule)

- `decodeReviewOutcomes(value)` — same signature and return shape; adds the
  fail-closed rule above. All three axes and reason codes are unchanged
  vocabularies.
- No new exported symbol. No change to `decodeLocalReviewAuthorization`,
  `decodeLocalReviewReceipt`, `decodeAttestedTrustLevel`, or the evidence binding.

## Validation & Error Matrix (net-new)

| Condition | Result |
|---|---|
| review reason `review_none` (any state) + assurance `pass` | throw `assuranceOutcome cannot pass when the review reason is review_none` |
| review reason `review_none` (any state) + gate not `block` | throw `gateOutcome must block when the review reason is review_none` |
| `{completed, review_none}` + assurance `pass` + gate `pass` | throw (previously accepted — the core hole this closes) |
| review `skipped`/`review_none` + assurance `not_applicable` + gate `block` | valid (sanctioned review:none shape) |
| non-budget skip with reason ≠ `review_none` + assurance `pass` + gate `block` | still valid (independent axes preserved) |
| real historical v1 receipt → `decodeLocalReviewAuthorization` | throw `must use supported schema major 2` |
| real historical v1 receipt → `decodeLocalReviewReceipt` | throw `must use supported schema major 2` |
| authorization carrying self-reported `usage` | throw (existing `:1002-1003`) |
| caller-asserted `trustLevel:"independent"` in authorization/receipt | throw (existing `decodeAttestedTrustLevel :891`) |

## Good/Base/Bad cases

- Good (AC1): existing `local-authorization.valid.json` / `local-receipt.valid.json`
  bind exact-head + full publicationContext + `repository_attested`.
- Base (AC2): review:none forces gate block and cannot satisfy assurance.
- Bad (AC2): a v1 (`schemaVersion:1`) local summary, or a review:none claiming an
  assurance pass, is rejected.

## Fixtures

- `fixtures/protocol/v2/outcomes.valid.json` — add: review:none skip that blocks
  the gate and leaves assurance `not_applicable` (sanctioned shape).
- `fixtures/protocol/v2/outcomes.invalid.json` — add three review_none cases:
  `{skipped, review_none}` + assurance `pass`; `{completed, review_none}` +
  assurance `pass` + gate `pass` (the core hole); `{skipped, review_none}` +
  gate `pass`.
- **No new v1 fixture.** The v1-summary proof reuses the **real** historical v1
  receipts already loaded in the test (`fixtures/protocol/v1/receipts.valid.json`,
  via the existing `validV1Receipts` helper) — proving the actual historical
  artifact fails the v2 decoders, rather than a synthetic `schemaVersion:1`
  object that could drift from a real v1 receipt.

## Tests (test/protocol-v2.test.js — reuse `fixture()` + `eachInvalid`)

- AC1: assert the valid authorization + receipt fixtures each carry exact-head
  evidence (`headSha`+`evidenceDigest`), the full authenticated publication
  context (`publicationContext.publisher`/`association`/`isPrAuthor`/
  `workflowRef`/`runId`), and `trustLevel === ATTESTED_TRUST_LEVEL`. (Authentication
  and evidence-age enforcement are ingestion concerns, not re-proven here.)
- AC2a: review:none can neither satisfy assurance nor free the gate — the valid
  sanctioned shape decodes; each invalid review_none outcome (including
  `{completed, review_none}`) throws via `eachInvalid(..., decodeReviewOutcomes)`.
- AC2b: real historical v1 receipts cannot be decoded as a v2
  `decodeLocalReviewAuthorization` or `decodeLocalReviewReceipt` (assert each
  `validV1Receipts` entry throws `must use supported schema major 2`),
  complementing the existing request-level proof at `test/protocol-v2.test.js:571`.

## Compatibility / rollout

Pure additive strictness on a contract that has no external callers depending on
the previously-permitted (incoherent) review:none+pass shape — no fixture uses
it, so there is nothing to migrate. No schema-major bump. Rollback = revert the
single guard + fixtures/tests.

## Coverage

`scripts/check-coverage.mjs` has no per-file floor for `protocol-v2.js`; only the
global floor (lines 88 / branches 77 / functions 88) applies. The one new branch
is exercised by both a valid and an invalid fixture, so global branch coverage
does not regress.
