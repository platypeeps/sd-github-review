import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ASSURANCE_CHECK_NAME,
  ATTESTED_TRUST_LEVEL,
  CLEARANCE_DECISIONS,
  GATE_CHECK_NAME,
  NOT_MANAGED_BUDGET_OUTCOME,
  PROTOCOL_V2_SCHEMA_MAJOR,
  QUARANTINE_STATUS_STATES,
  SELF_REPORTED_LOCAL_SOURCE,
  assertReviewerSelectionLabel,
  assertV2DispatchSelector,
  authorizeProjectionWrite,
  boundedOutput,
  compileReviewerPlan,
  decodeCandidateOptionsResponse,
  decodeCandidatePreflight,
  decodeCheckProjection,
  decodeClearanceRequest,
  decodeClearanceResponse,
  decodeHistoricalV1Receipt,
  decodeLocalAttestationRequest,
  decodeLocalAttestationStatus,
  decodeLocalReviewAuthorization,
  decodeLocalReviewReceipt,
  decodePromptProfileBinding,
  decodeQuarantineStatus,
  decodeReviewerCatalog,
  decodeReviewerPlanOptions,
  decodeReviewerPlanSource,
  decodeReviewOutcomes,
  decodeSelfReportedUsage,
  decodeSetupDiscoveryV2,
  decodeSourceContract,
  deriveV2Fingerprint,
  stableV2Json,
} from "../src/protocol-v2.js";

async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const validSourceContracts = await fixture("protocol/v2/source-contracts.valid.json");
const invalidSourceContracts = await fixture("protocol/v2/source-contracts.invalid.json");
const validPreflight = await fixture("protocol/v2/candidate-preflight.valid.json");
const invalidPreflight = await fixture("protocol/v2/candidate-preflight.invalid.json");
const validOptions = await fixture("protocol/v2/candidate-options.valid.json");
const invalidOptions = await fixture("protocol/v2/candidate-options.invalid.json");
const validOutcomes = await fixture("protocol/v2/outcomes.valid.json");
const invalidOutcomes = await fixture("protocol/v2/outcomes.invalid.json");
const validProjections = await fixture("protocol/v2/check-projections.valid.json");
const invalidProjections = await fixture("protocol/v2/check-projections.invalid.json");
const validDiscovery = await fixture("setup/v2/discovery.valid.json");
const invalidDiscovery = await fixture("setup/v2/discovery.invalid.json");
const forbiddenPrivacyFields = await fixture("protocol/v2/privacy-fields.invalid.json");
const validV1Receipts = await fixture("protocol/v1/receipts.valid.json");
const validReviewerSources = await fixture("protocol/v2/reviewer-plan-source.valid.json");
const invalidReviewerSources = await fixture("protocol/v2/reviewer-plan-source.invalid.json");
const reviewerCatalog = (await fixture("protocol/v2/reviewer-catalog.valid.json"))[0].value;
const validReviewerOptions = await fixture("protocol/v2/reviewer-plan-options.valid.json");
const invalidReviewerOptions = await fixture("protocol/v2/reviewer-plan-options.invalid.json");
const validLocalRequests = await fixture("protocol/v2/local-attestation-request.valid.json");
const invalidLocalRequests = await fixture("protocol/v2/local-attestation-request.invalid.json");
const validLocalAuthorizations = await fixture("protocol/v2/local-authorization.valid.json");
const invalidLocalAuthorizations = await fixture("protocol/v2/local-authorization.invalid.json");
const validLocalReceipts = await fixture("protocol/v2/local-receipt.valid.json");
const invalidLocalReceipts = await fixture("protocol/v2/local-receipt.invalid.json");
const validLocalStatuses = await fixture("protocol/v2/local-status.valid.json");
const invalidLocalStatuses = await fixture("protocol/v2/local-status.invalid.json");
const validLocalUsage = await fixture("protocol/v2/self-reported-usage.valid.json");
const invalidLocalUsage = await fixture("protocol/v2/self-reported-usage.invalid.json");
const validQuarantineStatuses = await fixture("protocol/v2/quarantine-status.valid.json");
const invalidQuarantineStatuses = await fixture("protocol/v2/quarantine-status.invalid.json");
const validClearanceRequests = await fixture("protocol/v2/clearance-request.valid.json");
const invalidClearanceRequests = await fixture("protocol/v2/clearance-request.invalid.json");
const validClearanceResponses = await fixture("protocol/v2/clearance-response.valid.json");
const invalidClearanceResponses = await fixture("protocol/v2/clearance-response.invalid.json");

function clone(value) {
  return structuredClone(value);
}

function eachInvalid(entries, decode) {
  for (const entry of entries) {
    assert.throws(() => decode(entry.value), new RegExp(entry.error, "u"), entry.name);
  }
}

// --- source contract -------------------------------------------------------

test("decodes every canonical source contract fixture", () => {
  for (const entry of validSourceContracts) {
    const decoded = decodeSourceContract(entry.value);
    assert.equal(decoded.schemaVersion, PROTOCOL_V2_SCHEMA_MAJOR, entry.name);
    assert.ok(["standalone", "managed"].includes(decoded.mode), entry.name);
    if (decoded.mode === "standalone") {
      assert.equal(decoded.budgetOutcome, NOT_MANAGED_BUDGET_OUTCOME, entry.name);
      assert.equal(decoded.lanes, undefined, entry.name);
    } else {
      assert.equal(decoded.routes, undefined, entry.name);
      for (const lane of Object.values(decoded.lanes)) {
        assert.ok(["block", "allow"].includes(lane.budgetExhaustion.merge), entry.name);
      }
    }
  }
});

test("rejects every invalid source contract fixture", () => {
  eachInvalid(invalidSourceContracts, decodeSourceContract);
});

test("standalone repository/PR casing does not leak a control plane binding", () => {
  const standalone = decodeSourceContract(
    validSourceContracts.find((entry) => entry.name.startsWith("standalone direct-handler and")).value,
  );
  assert.equal(standalone.routes.assurance.execution, "local-attested");
  assert.equal(standalone.routes.assurance.attestation.allowPrAuthor, false);
  assert.equal(standalone.routes.review.execution, "direct-handler");
});

test("prompt-profile binding is a strict referenced/handler-managed union", () => {
  assert.deepEqual(
    decodePromptProfileBinding({ mode: "handler-managed" }),
    { mode: "handler-managed" },
  );
  const referenced = decodePromptProfileBinding({
    mode: "referenced",
    alias: "Balanced-Review",
    version: "1.2.3",
    digest: "a".repeat(64),
  });
  assert.equal(referenced.alias, "balanced-review");
  assert.throws(
    () => decodePromptProfileBinding({ mode: "handler-managed", digest: "a".repeat(64) }),
    /digest is forbidden for a handler-managed profile/u,
  );
  assert.throws(
    () => decodePromptProfileBinding({ mode: "referenced", alias: "x", version: "1.0.0" }),
    /digest/u,
  );
});

test("prompt-profile binding rejects default/inheritance/fallback/override fields", () => {
  const referencedBase = {
    mode: "referenced",
    alias: "balanced-review",
    version: "1.0.0",
    digest: "a".repeat(64),
  };
  for (const forbidden of ["default", "inheritance", "fallback", "commandOverride", "runtimeOverride"]) {
    assert.throws(
      () => decodePromptProfileBinding({ mode: "handler-managed", [forbidden]: "x" }),
      new RegExp(`${forbidden} is forbidden`, "u"),
      `handler-managed must reject ${forbidden}`,
    );
    assert.throws(
      () => decodePromptProfileBinding({ ...referencedBase, [forbidden]: "x" }),
      new RegExp(`${forbidden} is forbidden`, "u"),
      `referenced must reject ${forbidden}`,
    );
  }
});

// --- candidate preflight ---------------------------------------------------

test("decodes every candidate preflight fixture and binds exact digests", () => {
  for (const entry of validPreflight) {
    const decoded = decodeCandidatePreflight(entry.value);
    assert.equal(decoded.units, "tokens", entry.name);
    assert.match(decoded.candidateDigest, /^[a-f0-9]{64}$/u, entry.name);
    assert.match(decoded.headSha, /^[a-f0-9]{40,64}$/u, entry.name);
  }
});

test("rejects every invalid candidate preflight fixture", () => {
  eachInvalid(invalidPreflight, decodeCandidatePreflight);
});

// --- candidate options -----------------------------------------------------

test("candidate options decode with deterministic alias ordering", () => {
  for (const entry of validOptions) {
    const decoded = decodeCandidateOptionsResponse(entry.value);
    const aliases = decoded.options.map((option) => option.alias);
    assert.deepEqual(aliases, [...aliases].sort(), entry.name);
    for (const option of decoded.options) {
      assert.equal(option.headSha, undefined, entry.name);
      assert.equal(option.logicalDispatchId, undefined, entry.name);
    }
  }
});

test("rejects every invalid candidate options fixture", () => {
  eachInvalid(invalidOptions, decodeCandidateOptionsResponse);
});

test("oversized candidate options response is rejected on its own byte bound", () => {
  const padding = "z".repeat(40 * 1024);
  const oversized = {
    schemaVersion: 2,
    catalogDigest: "1".repeat(64),
    configurationDigest: "2".repeat(64),
    options: [],
    note: padding,
  };
  let captured;
  assert.throws(
    () => decodeCandidateOptionsResponse(oversized),
    (error) => {
      captured = error;
      return /candidateOptions exceeds the \d+-byte limit/u.test(error.message);
    },
    "an oversized candidate-options response must be rejected on the response byte bound",
  );
  assert.ok(
    !captured.message.includes(padding),
    "the size-bound error must not echo the oversized value",
  );
});

// --- three-axis outcomes ---------------------------------------------------

test("decodes every outcome fixture with independent axes", () => {
  for (const entry of validOutcomes) {
    const decoded = decodeReviewOutcomes(entry.value);
    assert.ok(decoded.reviewOutcome.state, entry.name);
    assert.ok(decoded.assuranceOutcome.state, entry.name);
    assert.ok(decoded.gateOutcome.state, entry.name);
  }
});

test("budget exhaustion defers assurance while permitting the gate", () => {
  const deferred = decodeReviewOutcomes(
    validOutcomes.find((entry) => entry.name.startsWith("budget exhaustion")).value,
  );
  assert.equal(deferred.assuranceOutcome.state, "deferred");
  assert.equal(deferred.gateOutcome.state, "pass");
});

test("rejects every invalid outcome fixture", () => {
  eachInvalid(invalidOutcomes, decodeReviewOutcomes);
});

test("every non-budget failure blocks the gate regardless of the other axes", () => {
  const base = {
    schemaVersion: 2,
    headSha: "f".repeat(40),
    attempt: 1,
    logicalDispatchId: "6".repeat(64),
    reviewOutcome: { state: "failed", reasonCode: "policy_violation" },
    assuranceOutcome: { state: "pass", reasonCode: "completed" },
    gateOutcome: { state: "pass", reasonCode: "completed" },
  };
  // A failed review with a passing assurance must still block the gate.
  assert.throws(
    () => decodeReviewOutcomes(clone(base)),
    /gateOutcome must block when a non-budget failure occurs/u,
    "a failed review must block the gate even when assurance passes",
  );
  const blocking = { ...clone(base), gateOutcome: { state: "block", reasonCode: "policy_violation" } };
  const decoded = decodeReviewOutcomes(blocking);
  assert.equal(decoded.reviewOutcome.state, "failed");
  assert.equal(decoded.assuranceOutcome.state, "pass");
  assert.equal(decoded.gateOutcome.state, "block");
});

test("a review skipped for a non-budget reason cannot leave the gate free", () => {
  // Only the sanctioned budget defer may skip review while the gate passes.
  const skipped = {
    schemaVersion: 2,
    headSha: "a".repeat(40),
    attempt: 1,
    logicalDispatchId: "1".repeat(64),
    reviewOutcome: { state: "skipped", reasonCode: "policy_violation" },
    assuranceOutcome: { state: "pass", reasonCode: "completed" },
    gateOutcome: { state: "pass", reasonCode: "completed" },
  };
  assert.throws(
    () => decodeReviewOutcomes(clone(skipped)),
    /gateOutcome must block when a non-budget failure occurs/u,
    "a non-budget skipped review must block the gate",
  );
  // Blocking the gate makes the same non-budget skip acceptable.
  const blocked = { ...clone(skipped), gateOutcome: { state: "block", reasonCode: "policy_violation" } };
  assert.equal(decodeReviewOutcomes(blocked).reviewOutcome.state, "skipped");
  // The sanctioned budget defer still skips review while the gate passes.
  const budgetDefer = {
    ...clone(skipped),
    reviewOutcome: { state: "skipped", reasonCode: "budget_exhausted_deferred" },
    assuranceOutcome: { state: "deferred", reasonCode: "budget_exhausted_deferred" },
    gateOutcome: { state: "pass", reasonCode: "budget_exhausted_deferred" },
  };
  assert.equal(decodeReviewOutcomes(budgetDefer).gateOutcome.state, "pass");
});

// --- Check projection + compare-and-swap -----------------------------------

test("decodes every check projection fixture", () => {
  for (const entry of validProjections) {
    const decoded = decodeCheckProjection(entry.value);
    assert.ok([ASSURANCE_CHECK_NAME, GATE_CHECK_NAME].includes(decoded.checkName), entry.name);
  }
});

test("rejects every invalid check projection fixture", () => {
  eachInvalid(invalidProjections, decodeCheckProjection);
});

test("projection compare-and-swap enforces monotonic revision and token", () => {
  const token = "1".repeat(64);
  const initial = {
    schemaVersion: 2,
    checkName: GATE_CHECK_NAME,
    headSha: "a".repeat(40),
    conclusion: "success",
    revision: 1,
    attempt: 1,
    latestAuthorizedAttemptToken: token,
  };
  const first = authorizeProjectionWrite(null, initial, { authorizedAttemptToken: token });
  assert.equal(first.reason, "initial");

  const sameHeadRecovery = { ...clone(initial), revision: 2 };
  assert.equal(
    authorizeProjectionWrite(initial, sameHeadRecovery, { authorizedAttemptToken: token }).reason,
    "same-head-recovery",
  );

  const changedHead = { ...clone(initial), revision: 2, headSha: "b".repeat(40) };
  assert.equal(
    authorizeProjectionWrite(initial, changedHead, { authorizedAttemptToken: token }).reason,
    "changed-head-supersession",
  );

  const staleWrite = { ...clone(initial), revision: 1 };
  assert.throws(
    () => authorizeProjectionWrite(initial, staleWrite, { authorizedAttemptToken: token }),
    /revision must strictly increase/u,
  );

  const wrongToken = { ...clone(initial), revision: 2, latestAuthorizedAttemptToken: "2".repeat(64) };
  assert.throws(
    () => authorizeProjectionWrite(initial, wrongToken, { authorizedAttemptToken: token }),
    /latest authorized attempt token/u,
  );

  // Same-head recovery is a compare-and-swap on the CURRENT token: a caller
  // holding a stale token cannot recover the head merely by copying that stale
  // token into the candidate. Current head is authorized by a fresh token; the
  // stale write self-certifies with the old token and must be rejected.
  const rotated = { ...clone(initial), revision: 5, latestAuthorizedAttemptToken: "9".repeat(64) };
  const staleToken = "1".repeat(64);
  const staleRecovery = { ...clone(initial), revision: 6, latestAuthorizedAttemptToken: staleToken };
  assert.throws(
    () => authorizeProjectionWrite(rotated, staleRecovery, { authorizedAttemptToken: staleToken }),
    /same-head checkProjection recovery must reuse the current authorized attempt token/u,
  );
  // The genuine current token still recovers the same head.
  const freshRecovery = { ...clone(rotated), revision: 6 };
  assert.equal(
    authorizeProjectionWrite(rotated, freshRecovery, { authorizedAttemptToken: "9".repeat(64) }).reason,
    "same-head-recovery",
  );

  assert.throws(
    () => authorizeProjectionWrite(null, { ...clone(initial), revision: 2 }, { authorizedAttemptToken: token }),
    /initial checkProjection revision must be 1/u,
  );
});

// --- setup discovery -------------------------------------------------------

test("setup discovery advertises exactly one active major and stable checks", () => {
  for (const entry of validDiscovery) {
    const decoded = decodeSetupDiscoveryV2(entry.value);
    assert.equal(decoded.activeMajor, PROTOCOL_V2_SCHEMA_MAJOR, entry.name);
    assert.equal(decoded.checks.assurance.name, ASSURANCE_CHECK_NAME, entry.name);
    assert.equal(decoded.checks.gate.name, GATE_CHECK_NAME, entry.name);
  }
  const gateOnly = decodeSetupDiscoveryV2(
    validDiscovery.find((entry) => entry.name.startsWith("gate-only")).value,
  );
  assert.equal(gateOnly.gateOnlyBranchProtection, true);
});

test("rejects every invalid setup discovery fixture", () => {
  eachInvalid(invalidDiscovery, decodeSetupDiscoveryV2);
});

// --- privacy boundary ------------------------------------------------------

test("every forbidden privacy field is rejected without echoing values", () => {
  const base = validSourceContracts[0].value;
  for (const field of forbiddenPrivacyFields) {
    const poisoned = { ...clone(base), [field]: "leak-me" };
    assert.throws(
      () => decodeSourceContract(poisoned),
      (error) => error.message.includes("privacy boundary") && !error.message.includes("leak-me"),
      field,
    );
  }
});

test("nested forbidden fields inside otherwise-unknown containers are rejected", () => {
  const poisoned = { ...clone(validSourceContracts[0].value), future: { nested: { prompt: "x" } } };
  assert.throws(() => decodeSourceContract(poisoned), /privacy boundary/u);
});

// --- canonicalization, fingerprint, bounded output -------------------------

test("canonical JSON recursively sorts keys and reordered input is stable", () => {
  assert.equal(
    stableV2Json({ z: 1, a: { y: 2, b: 3 } }),
    '{"a":{"b":3,"y":2},"z":1}',
  );
  const first = deriveV2Fingerprint({ a: 1, b: [{ d: 4, c: 3 }] });
  const reordered = deriveV2Fingerprint({ b: [{ c: 3, d: 4 }], a: 1 });
  assert.equal(first, reordered);
  assert.notEqual(first, deriveV2Fingerprint({ a: 2, b: [{ c: 3, d: 4 }] }));
});

test("bounded output projects only allow-listed keys", () => {
  const projected = boundedOutput(
    { alias: "x", secretish: "y", cost: 3 },
    ["alias", "cost"],
  );
  assert.deepEqual(projected, { alias: "x", cost: 3 });
});

// --- size bounds -----------------------------------------------------------

test("oversized string fields are rejected without echoing the value", () => {
  const oversized = `z${"z".repeat(200)}`;
  const contract = clone(validSourceContracts[0].value);
  contract.routes.review.handler = oversized;
  let captured;
  assert.throws(
    () => decodeSourceContract(contract),
    (error) => {
      captured = error;
      return /exceeds the \d+-byte limit/u.test(error.message);
    },
    "oversized handler must be rejected on a byte bound",
  );
  assert.ok(
    !captured.message.includes(oversized),
    "size-bound error must not echo the oversized value",
  );
});

test("over-limit collections are rejected on the item bound", () => {
  const contract = clone(validSourceContracts[0].value);
  contract.routes.assurance.attestation.allowedAssociations = Array.from(
    { length: 40 },
    () => "MEMBER",
  );
  assert.throws(
    () => decodeSourceContract(contract),
    /exceeds the \d+-item limit/u,
    "an over-limit association collection must be rejected",
  );
});

// --- historical v1 read-only + v2 dispatch selector ------------------------

test("historical v1 receipts decode read-only and cannot authorize v2", () => {
  for (const entry of validV1Receipts) {
    const record = decodeHistoricalV1Receipt(entry.value);
    assert.equal(record.readOnly, true, entry.name);
    assert.equal(record.schemaMajor, 1, entry.name);
    assert.ok(Object.isFrozen(record), entry.name);
  }
});

test("v2 dispatch selector rejects v1, default, and absent selectors", () => {
  assert.deepEqual(assertV2DispatchSelector({ contractMajor: 2 }), { contractMajor: 2 });
  assert.throws(() => assertV2DispatchSelector(undefined), /explicit v2 contract major/u);
  assert.throws(() => assertV2DispatchSelector({}), /contractMajor must select/u);
  assert.throws(() => assertV2DispatchSelector({ contractMajor: 1 }), /cannot authorize v2 dispatch/u);
  assert.throws(
    () => assertV2DispatchSelector({ contractMajor: 2, default: true }),
    /must not rely on a default selector/u,
  );
});

// --- local-attested review contracts ---------------------------------------

test("decodes every local attestation request and binds exact evidence identity", () => {
  for (const entry of validLocalRequests) {
    const decoded = decodeLocalAttestationRequest(entry.value);
    assert.match(decoded.headSha, /^[a-f0-9]{40,64}$/u, entry.name);
    assert.match(decoded.evidenceDigest, /^[a-f0-9]{64}$/u, entry.name);
    assert.ok(["review", "assurance", "gate"].includes(decoded.lane), entry.name);
    assert.ok(["clean", "findings", "error"].includes(decoded.reviewResult), entry.name);
    // A caller can never assert its own trust, actor, or authorization.
    assert.equal(decoded.trustLevel, undefined, entry.name);
    assert.equal(decoded.publicationContext, undefined, entry.name);
  }
});

test("rejects every invalid local attestation request without echoing values", () => {
  eachInvalid(invalidLocalRequests, decodeLocalAttestationRequest);
  const poisoned = { ...clone(validLocalRequests[0].value), extra: { findings: "secret leak line 12" } };
  assert.throws(
    () => decodeLocalAttestationRequest(poisoned),
    (error) => /privacy boundary/u.test(error.message) && !error.message.includes("secret leak"),
    "a nested forbidden field must be rejected without echoing its value",
  );
});

test("only authorized clean exact-head evidence mints repository-attested trust", () => {
  for (const entry of validLocalAuthorizations) {
    const decoded = decodeLocalReviewAuthorization(entry.value);
    assert.equal(decoded.trustLevel, ATTESTED_TRUST_LEVEL, entry.name);
    assert.notEqual(decoded.trustLevel, "independent", entry.name);
    if (decoded.authorized) {
      assert.equal(decoded.reviewResult, "clean", entry.name);
    }
    assert.match(decoded.attemptToken, /^[a-f0-9]{64}$/u, entry.name);
  }
  eachInvalid(invalidLocalAuthorizations, decodeLocalReviewAuthorization);
});

test("the authorization attempt token binds every identity input", () => {
  const base = clone(validLocalAuthorizations[0].value);
  const token = decodeLocalReviewAuthorization(base).attemptToken;
  // Reordering keys does not change the token.
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(decodeLocalReviewAuthorization(reordered).attemptToken, token);
  // Changing the head changes the token.
  const movedHead = { ...clone(base), headSha: "c".repeat(40) };
  assert.notEqual(decodeLocalReviewAuthorization(movedHead).attemptToken, token);
  // Changing the evidence digest changes the token.
  const movedEvidence = { ...clone(base), evidenceDigest: "9".repeat(64) };
  assert.notEqual(decodeLocalReviewAuthorization(movedEvidence).attemptToken, token);
  // Changing the governing policy digest changes the token.
  const movedPolicy = { ...clone(base), policyDigest: "8".repeat(64) };
  assert.notEqual(decodeLocalReviewAuthorization(movedPolicy).attemptToken, token);
  // Changing the authenticated publication context changes the token.
  const movedPublication = clone(base);
  movedPublication.publicationContext = {
    ...movedPublication.publicationContext,
    runId: movedPublication.publicationContext.runId + 1,
  };
  assert.notEqual(decodeLocalReviewAuthorization(movedPublication).attemptToken, token);
});

test("local review receipts are immutable and only clean satisfies the gate", () => {
  for (const entry of validLocalReceipts) {
    const decoded = decodeLocalReviewReceipt(entry.value);
    assert.equal(decoded.trustLevel, ATTESTED_TRUST_LEVEL, entry.name);
    assert.ok(Object.isFrozen(decoded), entry.name);
    assert.equal(decoded.gateSatisfied, decoded.outcomeClass === "completed_local", entry.name);
  }
  eachInvalid(invalidLocalReceipts, decodeLocalReviewReceipt);
});

test("local attestation status binds evidence only once settled", () => {
  for (const entry of validLocalStatuses) {
    const decoded = decodeLocalAttestationStatus(entry.value);
    if (decoded.state === "awaiting_local_attestation") {
      assert.equal(decoded.evidenceDigest, undefined, entry.name);
    } else {
      assert.match(decoded.evidenceDigest, /^[a-f0-9]{64}$/u, entry.name);
    }
  }
  eachInvalid(invalidLocalStatuses, decodeLocalAttestationStatus);
});

test("self-reported usage is advisory and never authoritative budget evidence", () => {
  for (const entry of validLocalUsage) {
    const decoded = decodeSelfReportedUsage(entry.value);
    assert.equal(decoded.kind, SELF_REPORTED_LOCAL_SOURCE, entry.name);
    assert.equal(decoded.authoritative, false, entry.name);
  }
  eachInvalid(invalidLocalUsage, decodeSelfReportedUsage);
});

test("historical v1 receipts cannot be decoded as v2 local attestations", () => {
  for (const entry of validV1Receipts) {
    // A v1 summary decodes read-only as a routing hint.
    const record = decodeHistoricalV1Receipt(entry.value);
    assert.equal(record.readOnly, true, entry.name);
    // It can never be re-read as a v2 local attestation request.
    assert.throws(() => decodeLocalAttestationRequest(entry.value), undefined, entry.name);
  }
});

// --- task 08-04: v2 local-attestation envelope (AC1) + review:none / v1 (AC2)

test("AC1: local attestation envelope binds exact-head evidence, authenticated publication context, and repository_attested trust", () => {
  const cases = [
    ["authorization", validLocalAuthorizations, decodeLocalReviewAuthorization],
    ["receipt", validLocalReceipts, decodeLocalReviewReceipt],
  ];
  for (const [label, entries, decode] of cases) {
    for (const entry of entries) {
      const decoded = decode(entry.value);
      const where = `${label}:${entry.name}`;
      assert.match(decoded.headSha, /^[a-f0-9]{40,64}$/u, where);
      assert.match(decoded.evidenceDigest, /^[a-f0-9]{64}$/u, where);
      assert.equal(decoded.trustLevel, ATTESTED_TRUST_LEVEL, where);
      const pc = decoded.publicationContext;
      for (const key of ["publisher", "association", "isPrAuthor", "workflowRef", "runId"]) {
        assert.notEqual(pc[key], undefined, `${where}: publicationContext.${key}`);
      }
    }
  }
});

test("AC2a: review:none can neither satisfy assurance nor free the gate", () => {
  const sanctioned = validOutcomes.find((entry) => entry.name.startsWith("review:none"));
  assert.ok(sanctioned, "a sanctioned review:none valid outcome fixture must exist");
  const decoded = decodeReviewOutcomes(sanctioned.value);
  assert.equal(decoded.reviewOutcome.reasonCode, "review_none");
  assert.notEqual(decoded.assuranceOutcome.state, "pass");
  assert.equal(decoded.gateOutcome.state, "block");
  // Every invalid review_none outcome — including {completed, review_none} — throws.
  const reviewNoneInvalid = invalidOutcomes.filter(
    (entry) => entry.value.reviewOutcome.reasonCode === "review_none",
  );
  assert.equal(reviewNoneInvalid.length, 3, "the three review_none invalid cases must be present");
  eachInvalid(reviewNoneInvalid, decodeReviewOutcomes);
});

test("AC2b: real historical v1 receipts cannot decode as a v2 local authorization or receipt", () => {
  for (const { name, value } of validV1Receipts) {
    // The decoders take the object directly; a v1 (schemaVersion:1) receipt
    // fails the v2 schema-major gate on both.
    assert.throws(() => decodeLocalReviewAuthorization(value), /must use supported schema major 2/u, name);
    assert.throws(() => decodeLocalReviewReceipt(value), /must use supported schema major 2/u, name);
  }
});

// --- parallel reviewer plan compiler ---------------------------------------

const HEAD_A = "a".repeat(40);
const COMPILED_DIGEST = "9".repeat(64);
const CHEAP_A = "a".repeat(64);
const CHEAP_B = "b".repeat(64);
const CHEAP_C = "f".repeat(64);

function reviewSource(slots) {
  return { schemaVersion: 2, lane: "review", slots };
}
function candidateSlot(slotId, candidateDigest, extra = {}) {
  return {
    slotId,
    lane: "review",
    selector: { kind: "candidate", candidateDigest },
    required: false,
    overridable: false,
    timeoutSeconds: 300,
    minSuccesses: 1,
    ...extra,
  };
}

test("decodes every reviewer plan source fixture and rejects the invalid ones", () => {
  for (const entry of validReviewerSources) {
    const decoded = decodeReviewerPlanSource(entry.value);
    assert.equal(decoded.lane, "review", entry.name);
    assert.ok(decoded.slots.length >= 1, entry.name);
  }
  eachInvalid(invalidReviewerSources, decodeReviewerPlanSource);
});

test("decodes the reviewer catalog and rejects chains naming unknown candidates", () => {
  const decoded = decodeReviewerCatalog(reviewerCatalog);
  assert.equal(decoded.byAlias.size, 5);
  assert.deepEqual(decoded.chains.get("cheap-chain"), ["cheap-a", "cheap-b"]);
  const broken = clone(reviewerCatalog);
  broken.chains["cheap-chain"] = ["cheap-a", "ghost"];
  assert.throws(() => decodeReviewerCatalog(broken), /references unknown candidate ghost/u);
  // Chain names collapse under case normalization; a case-only duplicate must
  // be rejected rather than silently overwriting the earlier entry.
  const collided = clone(reviewerCatalog);
  collided.chains = { "Cheap-Chain": ["cheap-a"], "cheap-chain": ["cheap-b"] };
  assert.throws(() => decodeReviewerCatalog(collided), /chains name cheap-chain is duplicated/u);
});

test("one, two, and three-plus-slot plans compile deterministically", () => {
  const scenarios = [
    reviewSource([candidateSlot("s1", CHEAP_A)]),
    reviewSource([candidateSlot("s1", CHEAP_A), candidateSlot("s2", CHEAP_B)]),
    reviewSource([
      candidateSlot("s1", CHEAP_A),
      candidateSlot("s2", CHEAP_B),
      candidateSlot("s3", CHEAP_C),
    ]),
  ];
  for (const source of scenarios) {
    const plan = compileReviewerPlan({
      source,
      catalog: reviewerCatalog,
      headSha: HEAD_A,
      compiledDigest: COMPILED_DIGEST,
    });
    assert.equal(plan.children.length, source.slots.length);
    // Deterministic: recompiling equivalent input yields the same identities.
    const again = compileReviewerPlan({
      source,
      catalog: reviewerCatalog,
      headSha: HEAD_A,
      compiledDigest: COMPILED_DIGEST,
    });
    assert.equal(plan.parentId, again.parentId);
    assert.deepEqual(
      plan.children.map((c) => c.childId),
      again.children.map((c) => c.childId),
    );
  }
});

test("a chain slot expands to its member candidates and honors minSuccesses", () => {
  const source = reviewSource([
    { ...candidateSlot("chained", CHEAP_A), selector: { kind: "chain", chain: "cheap-chain" }, minSuccesses: 2 },
  ]);
  const plan = compileReviewerPlan({
    source,
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  assert.deepEqual(plan.children[0].candidateDigests, [CHEAP_A, CHEAP_B]);
  assert.equal(plan.children[0].minSuccesses, 2);
});

test("compilation rejects overlap, bad threshold, wrong lane, unknown selector, and ambiguous override before reservation", () => {
  const base = { catalog: reviewerCatalog, headSha: HEAD_A, compiledDigest: COMPILED_DIGEST };
  // Overlap: a fixed candidate that is also a chain member.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source: reviewSource([
        candidateSlot("s1", CHEAP_A),
        { ...candidateSlot("s2", CHEAP_A), selector: { kind: "chain", chain: "cheap-chain" } },
      ]),
    }),
    /pairwise disjoint/u,
  );
  // Invalid threshold: minSuccesses beyond the expanded set.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source: reviewSource([candidateSlot("s1", CHEAP_A, { minSuccesses: 2 })]),
    }),
    /minSuccesses exceeds its 1 possible candidate/u,
  );
  // Wrong lane: an assurance-only candidate used in a review plan.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source: reviewSource([candidateSlot("s1", "c".repeat(64))]),
    }),
    /not eligible for lane review/u,
  );
  // Unknown selector: a candidate digest absent from the catalog.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source: reviewSource([candidateSlot("s1", "0".repeat(64))]),
    }),
    /absent from the pinned catalog/u,
  );
  // Ambiguous override: no slotId while two slots are overridable.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source: reviewSource([
        candidateSlot("s1", CHEAP_A, { overridable: true }),
        candidateSlot("s2", CHEAP_B, { overridable: true }),
      ]),
      overrides: [{ selector: { kind: "candidate", candidateDigest: CHEAP_C } }],
    }),
    /shorthand is ambiguous/u,
  );
});

test("an override applies only to the named overridable slot", () => {
  const base = { catalog: reviewerCatalog, headSha: HEAD_A, compiledDigest: COMPILED_DIGEST };
  const source = reviewSource([
    candidateSlot("fixed", CHEAP_A, { overridable: false }),
    candidateSlot("open", CHEAP_B, { overridable: true }),
  ]);
  const overridden = compileReviewerPlan({
    ...base,
    source,
    overrides: [{ slotId: "open", selector: { kind: "candidate", candidateDigest: CHEAP_C } }],
  });
  const open = overridden.children.find((c) => c.slotId === "open");
  assert.deepEqual(open.candidateDigests, [CHEAP_C]);
  // Overriding a non-overridable slot is rejected.
  assert.throws(
    () => compileReviewerPlan({
      ...base,
      source,
      overrides: [{ slotId: "fixed", selector: { kind: "candidate", candidateDigest: CHEAP_C } }],
    }),
    /not overridable/u,
  );
});

test("parent and child identities change only with their documented inputs", () => {
  const source = reviewSource([candidateSlot("s1", CHEAP_A), candidateSlot("s2", CHEAP_B)]);
  const base = compileReviewerPlan({
    source,
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  // Reordering slots (canonical input) does not change identity.
  const reordered = compileReviewerPlan({
    source: reviewSource([candidateSlot("s2", CHEAP_B), candidateSlot("s1", CHEAP_A)]),
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  assert.equal(base.parentId, reordered.parentId);
  // Changing the head changes the parent identity.
  const movedHead = compileReviewerPlan({
    source,
    catalog: reviewerCatalog,
    headSha: "b".repeat(40),
    compiledDigest: COMPILED_DIGEST,
  });
  assert.notEqual(base.parentId, movedHead.parentId);
  // Changing a candidate changes both the parent and that child identity.
  const swapped = compileReviewerPlan({
    source: reviewSource([candidateSlot("s1", CHEAP_C), candidateSlot("s2", CHEAP_B)]),
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  assert.notEqual(base.parentId, swapped.parentId);
  const baseChildS1 = base.children.find((c) => c.slotId === "s1").childId;
  assert.notEqual(baseChildS1, swapped.children.find((c) => c.slotId === "s1").childId);
  // A slot timeout resolves the plan's behavior, so it is bound into identity.
  const retimed = compileReviewerPlan({
    source: reviewSource([candidateSlot("s1", CHEAP_A, { timeoutSeconds: 600 }), candidateSlot("s2", CHEAP_B)]),
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  assert.notEqual(base.parentId, retimed.parentId);
  assert.notEqual(baseChildS1, retimed.children.find((c) => c.slotId === "s1").childId);
});

test("cheap and deep plans remain independent and synthesize no default", () => {
  const cheap = compileReviewerPlan({
    source: reviewSource([candidateSlot("s1", CHEAP_A)]),
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  const deep = compileReviewerPlan({
    source: {
      schemaVersion: 2,
      lane: "assurance",
      slots: [{
        slotId: "deep",
        lane: "assurance",
        selector: { kind: "candidate", candidateDigest: "c".repeat(64) },
        required: true,
        overridable: false,
        timeoutSeconds: 300,
        minSuccesses: 1,
      }],
    },
    catalog: reviewerCatalog,
    headSha: HEAD_A,
    compiledDigest: COMPILED_DIGEST,
  });
  assert.notEqual(cheap.parentId, deep.parentId);
  assert.equal(cheap.lane, "review");
  assert.equal(deep.lane, "assurance");
  // No contextual default: an empty slot set is rejected, never filled in.
  assert.throws(
    () => compileReviewerPlan({
      source: reviewSource([]),
      catalog: reviewerCatalog,
      headSha: HEAD_A,
      compiledDigest: COMPILED_DIGEST,
    }),
    /must declare at least one slot/u,
  );
});

test("reviewer plan options list overridable slots without any plan side effect", () => {
  for (const entry of validReviewerOptions) {
    const decoded = decodeReviewerPlanOptions(entry.value);
    assert.ok(Array.isArray(decoded.overridableSlots), entry.name);
    assert.equal(decoded.parentId, undefined, entry.name);
    assert.equal(decoded.headSha, undefined, entry.name);
  }
  eachInvalid(invalidReviewerOptions, decodeReviewerPlanOptions);
});

test("selection labels accept broad lanes and reject candidate or slot control labels", () => {
  assert.deepEqual(assertReviewerSelectionLabel("review"), { lane: "review" });
  assert.deepEqual(assertReviewerSelectionLabel("gate"), { lane: "gate" });
  for (const reserved of ["candidate:cheap-a", "slot:primary", "chain:cheap-chain"]) {
    assert.throws(() => assertReviewerSelectionLabel(reserved), /is unsupported/u, reserved);
  }
  // A non-lane, non-reserved label is not a broad lane selector.
  assert.throws(() => assertReviewerSelectionLabel("primary-review"), /must be a broad review lane label/u);
});

// --- quarantine status & clearance contracts (parent AC13) -----------------

test("AC13: quarantine status binds the full audit tuple and enforces the cleared/decisionFingerprint invariant", () => {
  for (const entry of validQuarantineStatuses) {
    const decoded = decodeQuarantineStatus(entry.value);
    assert.equal(decoded.schemaVersion, PROTOCOL_V2_SCHEMA_MAJOR, entry.name);
    assert.ok(QUARANTINE_STATUS_STATES.includes(decoded.state), entry.name);
    assert.ok(decoded.candidate, entry.name);
    assert.equal(decoded.remediationDigest.length, 64, entry.name);
    assert.equal(decoded.policyDigest.length, 64, entry.name);
    assert.equal(decoded.configurationDigest.length, 64, entry.name);
    assert.ok(decoded.auditIdentity && decoded.auditIdentity.publisher, entry.name);
    assert.ok(decoded.statusFingerprint, entry.name);
    if (decoded.state === "cleared") {
      assert.ok(decoded.decisionFingerprint, entry.name);
    } else {
      assert.equal(decoded.decisionFingerprint, undefined, entry.name);
    }
    // No decoded status ever carries a budget/dispatch authority grant.
    assert.equal(decoded.budget, undefined, entry.name);
    assert.equal(decoded.authorization, undefined, entry.name);
  }
  eachInvalid(invalidQuarantineStatuses, decodeQuarantineStatus);
});

test("AC13: clearance request is identity-free and authority-free (recursive rejection)", () => {
  for (const entry of validClearanceRequests) {
    const decoded = decodeClearanceRequest(entry.value);
    assert.equal(decoded.schemaVersion, PROTOCOL_V2_SCHEMA_MAJOR, entry.name);
    assert.equal(decoded.auditIdentity, undefined, entry.name);
    assert.ok(decoded.requestFingerprint, entry.name);
  }
  // Top-level, nested, and case/separator-variant identity/authority all throw.
  eachInvalid(invalidClearanceRequests, decodeClearanceRequest);
});

test("AC13: clearance response audits the requester and binds the request + digests", () => {
  for (const entry of validClearanceResponses) {
    const decoded = decodeClearanceResponse(entry.value);
    assert.equal(decoded.schemaVersion, PROTOCOL_V2_SCHEMA_MAJOR, entry.name);
    assert.ok(CLEARANCE_DECISIONS.includes(decoded.decision), entry.name);
    assert.ok(decoded.auditIdentity && decoded.auditIdentity.publisher, entry.name);
    assert.equal(decoded.requestFingerprint.length, 64, entry.name);
    assert.ok(decoded.decisionFingerprint, entry.name);
  }
  eachInvalid(invalidClearanceResponses, decodeClearanceResponse);
});

test("AC13: fingerprints bind audit identity (value changes with the actor) and status cites its clearing response", () => {
  const clearedResponses = validClearanceResponses
    .filter((e) => e.value.decision === "cleared")
    .map((e) => decodeClearanceResponse(e.value));
  const responseFps = new Set(clearedResponses.map((r) => r.decisionFingerprint));
  // Two cleared responses differing only in auditIdentity.publisher must differ.
  assert.equal(responseFps.size, clearedResponses.length,
    "response decisionFingerprint must be sensitive to auditIdentity");

  const clearedStatuses = validQuarantineStatuses
    .filter((e) => e.value.state === "cleared")
    .map((e) => decodeQuarantineStatus(e.value));
  const statusFps = new Set(clearedStatuses.map((s) => s.statusFingerprint));
  assert.equal(statusFps.size, clearedStatuses.length,
    "status statusFingerprint must be sensitive to auditIdentity");

  // Cross-link: a cleared status cites a real clearing-response decisionFingerprint.
  for (const status of clearedStatuses) {
    assert.ok(responseFps.has(status.decisionFingerprint),
      "cleared status must cite a clearance response decisionFingerprint");
  }
});

test("AC13: historical v1 receipts cannot decode as any quarantine/clearance contract", () => {
  // Fail-closed is the property: a v1 receipt is rejected by SOME guard (schema
  // major, privacy/authority walk, or a missing v2 field) — never decoded. The
  // specific guard that fires first depends on the receipt's fields.
  for (const { name, value } of validV1Receipts) {
    assert.throws(() => decodeQuarantineStatus(value), name);
    assert.throws(() => decodeClearanceRequest(value), name);
    assert.throws(() => decodeClearanceResponse(value), name);
  }
});

test("AC10-residual: every residual reason code decodes as a valid outcome", () => {
  const residual = ["input_ineligible", "incomplete_token_limit", "budget_overrun", "candidate_quarantined"];
  for (const code of residual) {
    const match = validOutcomes.find((e) => e.value.reviewOutcome.reasonCode === code);
    assert.ok(match, `expected a valid outcome fixture for ${code}`);
    const decoded = decodeReviewOutcomes(match.value);
    assert.equal(decoded.reviewOutcome.reasonCode, code);
    // And each residual code has an invalid fixture proving it is a real failure.
    assert.ok(
      invalidOutcomes.some((e) =>
        e.value.reviewOutcome.reasonCode === code
        || e.value.assuranceOutcome.reasonCode === code
        || e.value.gateOutcome.reasonCode === code),
      `expected an invalid outcome fixture for ${code}`,
    );
  }
});
