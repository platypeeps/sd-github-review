import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decodeAdapterAcknowledgment,
  decodeAdapterRequest,
  decodeBackend,
  decodeLocalReviewSummary,
  decodeReceipt,
  decodeReviewRequest,
  decodeSuccessorEvidence,
  deriveLogicalDispatchId,
  deriveRequestFingerprint,
  stableProtocolJson,
} from "../src/protocol.js";
import { selectProtocolRoute } from "../src/router.js";

async function fixture(name) {
  const url = new URL(`../fixtures/protocol/v1/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const requests = await fixture("requests.valid.json");
const invalidRequests = await fixture("requests.invalid.json");
const receipts = await fixture("receipts.valid.json");
const invalidReceipts = await fixture("receipts.invalid.json");
const localSummaries = await fixture("local-summaries.valid.json");
const invalidLocalSummaries = await fixture("local-summaries.invalid.json");
const forbiddenPrivacyFields = await fixture("privacy-fields.invalid.json");
const supporting = await fixture("supporting.valid.json");

const requestByName = new Map(requests.map((entry) => [entry.name, entry.value]));
const successorByName = new Map(
  supporting.successorEvidence.map((entry) => [entry.name, entry.value]),
);

function clone(value) {
  return structuredClone(value);
}

test("decodes every canonical request fixture and normalizes exact identity", () => {
  for (const entry of requests) {
    const decoded = decodeReviewRequest(entry.value);
    assert.equal(decoded.schemaVersion, 1, entry.name);
    assert.equal(decoded.repository.owner, "platypeeps", entry.name);
    assert.equal(decoded.repository.name, "sd-github-review", entry.name);
    assert.match(decoded.logicalDispatchId, /^[a-f0-9]{64}$/u, entry.name);
    assert.match(decoded.requestFingerprint, /^[a-f0-9]{64}$/u, entry.name);
  }
  assert.deepEqual(
    requests.map((entry) => decodeReviewRequest(entry.value).route),
    ["auto", "cheap", "deep", "copilot", "none", "auto"],
  );
});

test("canonical JSON recursively sorts object keys", () => {
  assert.equal(
    stableProtocolJson({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] }),
    '{"a":{"b":3,"y":2},"list":[{"c":5,"d":4}],"z":1}',
  );
  assert.equal(stableProtocolJson({ "ä": 1, z: 2, A: 3 }), '{"A":3,"z":2,"ä":1}');
});

test("equivalent raw casing and provider ordering produce one canonical fingerprint", () => {
  const automatic = clone(requestByName.get("automatic with exact-head local evidence"));
  const secondProvider = {
    id: "second-reviewer",
    capabilityTier: "standard",
    costTier: "medium",
    qualityTier: "standard",
  };
  automatic.localReview.providers.push(secondProvider);
  const equivalent = clone(automatic);
  equivalent.repository = { owner: "platypeeps", name: "sd-github-review" };
  equivalent.localReview.repository = { owner: "PLATYPEEPS", name: "SD-GITHUB-REVIEW" };
  equivalent.localReview.providers.reverse();
  assert.equal(deriveLogicalDispatchId(equivalent), deriveLogicalDispatchId(automatic));
  assert.equal(deriveRequestFingerprint(equivalent), deriveRequestFingerprint(automatic));
});

test("correlation aliases do not change identity or fingerprint", () => {
  const base = requestByName.get("explicit cheap");
  const aliased = {
    ...clone(base),
    correlationId: "different-primary",
    correlationAliases: ["trace-z", "trace-a"],
  };
  assert.equal(deriveLogicalDispatchId(aliased), deriveLogicalDispatchId(base));
  assert.equal(deriveRequestFingerprint(aliased), deriveRequestFingerprint(base));

  const successor = requestByName.get("automatic successor");
  const successorAlias = clone(successor);
  successorAlias.supersedes.correlationId = "different-prior-correlation";
  assert.equal(deriveRequestFingerprint(successorAlias), deriveRequestFingerprint(successor));
});

test("canonical identity and request intent change only their owned digests", () => {
  const base = requestByName.get("explicit cheap");
  const differentRoute = { ...clone(base), route: "deep" };
  const differentHead = { ...clone(base), headSha: "9999999999999999999999999999999999999999" };
  // A valid attempt-2 request must declare what it retries, so this carries a
  // rerequestOf. rerequestOf is excluded from neither digest, but the property
  // under test is that `attempt` alone moves both, and the prior-attempt fields
  // here are constant against `base` by construction.
  const differentAttempt = {
    ...clone(base),
    attempt: 2,
    rerequestOf: {
      priorReceiptId: "a".repeat(64),
      priorLogicalDispatchId: deriveLogicalDispatchId(base),
      priorAttempt: 1,
    },
  };
  const differentPolicy = { ...clone(base), policyReference: "stricter-policy" };

  assert.equal(deriveLogicalDispatchId(differentRoute), deriveLogicalDispatchId(base));
  assert.notEqual(deriveRequestFingerprint(differentRoute), deriveRequestFingerprint(base));
  assert.notEqual(deriveLogicalDispatchId(differentHead), deriveLogicalDispatchId(base));
  assert.notEqual(deriveRequestFingerprint(differentHead), deriveRequestFingerprint(base));
  assert.notEqual(deriveLogicalDispatchId(differentAttempt), deriveLogicalDispatchId(base));
  assert.notEqual(deriveRequestFingerprint(differentAttempt), deriveRequestFingerprint(base));
  assert.equal(deriveLogicalDispatchId(differentPolicy), deriveLogicalDispatchId(base));
  assert.notEqual(deriveRequestFingerprint(differentPolicy), deriveRequestFingerprint(base));
});

test("additive unknown v1 fields are tolerated but do not enter canonical policy", () => {
  const base = requestByName.get("explicit cheap");
  const extended = { ...clone(base), futureMetadata: { harmlessMarker: "v1-extension" } };
  const decoded = decodeReviewRequest(extended);
  assert.equal(decoded.futureMetadata, undefined);
  assert.equal(deriveRequestFingerprint(extended), deriveRequestFingerprint(base));
});

test("accepts matching compatibility identity and fingerprint values", () => {
  const base = requestByName.get("explicit cheap");
  const compatibility = {
    ...clone(base),
    logicalDispatchId: deriveLogicalDispatchId(base),
    requestFingerprint: deriveRequestFingerprint(base),
  };
  const decoded = decodeReviewRequest(compatibility);
  assert.equal(decoded.logicalDispatchId, compatibility.logicalDispatchId);
  assert.equal(decoded.requestFingerprint, compatibility.requestFingerprint);
});

test("rejects every canonical invalid request fixture", () => {
  for (const entry of invalidRequests) {
    assert.throws(
      () => decodeReviewRequest(entry.value),
      new RegExp(entry.error, "u"),
      entry.name,
    );
  }
});

test("requires exact scalar and container types before normalization", () => {
  const base = requestByName.get("explicit cheap");
  assert.throws(() => decodeReviewRequest({ ...clone(base), route: 1 }), /route must be a string/u);
  assert.throws(() => decodeReviewRequest({ ...clone(base), route: "turbo" }), /route must be one of/u);
  assert.throws(() => decodeReviewRequest({ ...clone(base), attempt: "1" }), /attempt must be an integer/u);
  assert.throws(() => decodeReviewRequest({ ...clone(base), attempt: 0 }), /attempt must be an integer/u);
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), repository: ["platypeeps", "sd-github-review"] }),
    /repository must be an object/u,
  );
  assert.throws(() => decodeReviewRequest(undefined), /JSON values only/u);
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), extension: { future: undefined } }),
    /JSON values only/u,
  );
  for (const nonPlainObject of [new Date(), new Map([["prompt", "fixture"]]), new (class {
    toJSON() {
      return { prompt: "fixture" };
    }
  })()]) {
    assert.throws(
      () => decodeReviewRequest({ ...clone(base), extension: nonPlainObject }),
      /plain JSON objects only/u,
    );
  }
});

test("rejects repeated object references with an accurate JSON-tree error", () => {
  const base = requestByName.get("explicit cheap");
  const shared = { harmlessMarker: "shared" };
  assert.throws(
    () => decodeReviewRequest({
      ...clone(base),
      extension: { first: shared, second: shared },
    }),
    /repeated object references or circular data/u,
  );
});

test("enforces whole-request and bounded-string limits without echoing values", () => {
  const base = requestByName.get("explicit cheap");
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), correlationId: "x".repeat(17 * 1024) }),
    /request exceeds the 16384-byte limit/u,
  );
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), correlationId: "x".repeat(129) }),
    /correlationId exceeds the 128-byte limit/u,
  );
});

test("bounds nested JSON iteratively before canonicalization", () => {
  const base = requestByName.get("explicit cheap");
  const nested = {};
  let current = nested;
  for (let depth = 0; depth < 40; depth += 1) {
    current.next = {};
    current = current.next;
  }
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), extension: nested }),
    /exceeds the 32-level nesting limit/u,
  );

  const bounded = {};
  current = bounded;
  for (let depth = 0; depth < 20; depth += 1) {
    current.next = {};
    current = current.next;
  }
  assert.doesNotThrow(() => decodeReviewRequest({ ...clone(base), extension: bounded }));
});

test("rejects every canonical forbidden privacy field even when nested", () => {
  const base = requestByName.get("explicit cheap");
  for (const field of forbiddenPrivacyFields) {
    assert.throws(
      () => decodeReviewRequest({ ...clone(base), extension: { nested: { [field]: "fixture" } } }),
      /privacy boundary/u,
      field,
    );
  }
});

test("local summary validation binds repository, pull request, and full head", () => {
  const base = requestByName.get("automatic with exact-head local evidence");
  const local = clone(base.localReview);
  const expectedIdentity = {
    repository: { owner: "platypeeps", name: "sd-github-review" },
    pullRequestNumber: base.pullRequestNumber,
    headSha: base.headSha,
  };
  assert.equal(decodeLocalReviewSummary(local, expectedIdentity).outcome, "clean");
  local.headSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.throws(() => decodeReviewRequest({ ...clone(base), localReview: local }), /must match.*headSha/u);
});

test("decodes canonical local outcomes and gives non-positive outcomes zero confidence", () => {
  for (const entry of localSummaries) {
    const decoded = decodeLocalReviewSummary(entry.value);
    assert.equal(decoded.outcome, entry.value.outcome, entry.name);
    if (["unavailable", "failed", "cancelled", "skipped"].includes(decoded.outcome)) {
      assert.equal(decoded.confidence, 0, entry.name);
    }
  }
});

test("rejects canonical dirty, stale, malformed, and forbidden local summaries", () => {
  for (const entry of invalidLocalSummaries) {
    assert.throws(
      () => decodeLocalReviewSummary(entry.value, entry.expectedIdentity),
      new RegExp(entry.error, "u"),
      entry.name,
    );
  }
});

test("local summaries reject unresolved positive outcomes and sensitive nested fields", () => {
  const base = requestByName.get("automatic with exact-head local evidence");
  const unresolved = clone(base.localReview);
  unresolved.outcome = "fully-dispositioned";
  unresolved.dispositionCounts = { total: 1, unresolved: 1, fixed: 0, rebutted: 0 };
  assert.throws(() => decodeReviewRequest({ ...clone(base), localReview: unresolved }), /unresolved must be 0/u);

  const forbidden = clone(base.localReview);
  forbidden.extension = { findings: ["forbidden-fixture-value"] };
  assert.throws(() => decodeReviewRequest({ ...clone(base), localReview: forbidden }), /privacy boundary/u);
});

test("rerequests require the next attempt and cannot combine with successor intent", () => {
  const base = requestByName.get("explicit cheap");
  const rerequestOf = {
    priorReceiptId: "receipt-prior",
    priorLogicalDispatchId: "1111111111111111111111111111111111111111111111111111111111111111",
    priorAttempt: 1,
  };
  assert.doesNotThrow(() => decodeReviewRequest({ ...clone(base), attempt: 2, rerequestOf }));
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), attempt: 3, rerequestOf }),
    /must be the next attempt/u,
  );
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), attempt: 2, rerequestOf, supersedes: {
      priorReceiptId: "receipt-prior",
      priorLogicalDispatchId: "1111111111111111111111111111111111111111111111111111111111111111",
      priorHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } }),
    /cannot be combined/u,
  );
});

test("decodes canonical backend, adapter request, acknowledgment, and successor fixtures", () => {
  for (const entry of supporting.backends) {
    assert.equal(decodeBackend(entry.value).id, entry.value.id, entry.name);
  }
  for (const entry of supporting.adapterRequests) {
    assert.equal(
      decodeAdapterRequest(entry.value).logicalDispatchId,
      entry.value.logicalDispatchId,
      entry.name,
    );
  }
  for (const entry of supporting.acknowledgments) {
    assert.equal(
      decodeAdapterAcknowledgment(entry.value).status,
      entry.value.status,
      entry.name,
    );
  }
  for (const entry of supporting.successorEvidence) {
    assert.equal(
      decodeSuccessorEvidence(entry.value).comparison,
      entry.value.comparison,
      entry.name,
    );
  }
});

test("adapter requests require a valid external exact-head identity", () => {
  const request = clone(supporting.adapterRequests[0].value);
  request.logicalDispatchId = "f".repeat(64);
  assert.throws(() => decodeAdapterRequest(request), /does not match the adapter request identity/u);

  const native = clone(supporting.adapterRequests[0].value);
  native.backend.kind = "copilot";
  assert.throws(() => decodeAdapterRequest(native), /backend.kind must be external/u);

  const invalidRoute = clone(supporting.adapterRequests[0].value);
  invalidRoute.selectedRoute = "copilot";
  assert.throws(() => decodeAdapterRequest(invalidRoute), /selectedRoute must be one of/u);
});

test("adapter failure acknowledgments require a bounded code only on failure", () => {
  const failed = clone(
    supporting.acknowledgments.find((entry) => entry.name === "external adapter failed").value,
  );
  delete failed.errorCode;
  assert.throws(() => decodeAdapterAcknowledgment(failed), /errorCode is required/u);

  const acknowledged = clone(supporting.acknowledgments[0].value);
  acknowledged.errorCode = "not-valid-on-success";
  assert.throws(() => decodeAdapterAcknowledgment(acknowledged), /valid only for a failed/u);
});

test("backend descriptors require observable identity for every finding channel", () => {
  const backend = clone(supporting.backends.find((entry) => entry.name === "external check backend").value);
  backend.checkNames = [];
  assert.throws(() => decodeBackend(backend), /checkNames must identify/u);

  const oversized = clone(
    supporting.backends.find((entry) => entry.name === "external check backend").value,
  );
  oversized.futureMetadata = "x".repeat(9 * 1024);
  assert.throws(() => decodeBackend(oversized), /backend exceeds the 8192-byte limit/u);
});

test("decodes canonical receipts for Copilot, external comments, external checks, and none", () => {
  for (const entry of receipts) {
    const decoded = decodeReceipt(entry.value);
    assert.equal(decoded.receiptId, entry.value.receiptId, entry.name);
    assert.equal(decoded.selectedRoute, entry.value.selectedRoute, entry.name);
  }
  assert.deepEqual(
    receipts.map((entry) => decodeReceipt(entry.value).selectedRoute),
    ["copilot", "cheap", "deep", "none", "copilot", "cheap", "copilot", "copilot"],
  );
});

test("rejects every canonical invalid receipt fixture", () => {
  for (const entry of invalidReceipts) {
    assert.throws(() => decodeReceipt(entry.value), new RegExp(entry.error, "u"), entry.name);
  }
});

test("receipt route, backend kind, and dispatch state must agree", () => {
  const none = clone(receipts.find((entry) => entry.name === "none receipt").value);
  none.dispatch.status = "requested";
  none.dispatch.phase = "started";
  assert.throws(() => decodeReceipt(none), /must be skipped/u);

  const copilot = clone(receipts.find((entry) => entry.name === "Copilot receipt").value);
  copilot.backend.kind = "external";
  assert.throws(() => decodeReceipt(copilot), /kind must be copilot/u);

  const skippedRemote = clone(receipts.find((entry) => entry.name === "external comment receipt").value);
  skippedRemote.dispatch.status = "skipped";
  skippedRemote.dispatch.phase = "not-started";
  assert.throws(() => decodeReceipt(skippedRemote), /skipped is valid only for the none route/u);

  const reversedTime = clone(receipts.find((entry) => entry.name === "failed external receipt").value);
  reversedTime.dispatch.completedAt = "2026-07-23T10:04:59Z";
  assert.throws(() => decodeReceipt(reversedTime), /must not precede/u);

  const credentialUrl = clone(receipts.find((entry) => entry.name === "Copilot receipt").value);
  credentialUrl.dispatch.workflowUrl = "https://user:pass@github.com/actions/runs/1";
  assert.throws(() => decodeReceipt(credentialUrl), /workflowUrl must not include credentials/u);

  const oversized = clone(receipts.find((entry) => entry.name === "none receipt").value);
  oversized.extension = { futureMetadata: "x".repeat(33 * 1024) };
  assert.throws(() => decodeReceipt(oversized), /receipt exceeds the 32768-byte limit/u);
});

test("explicit protocol routes retain precedence over local evidence and risk floors", () => {
  const explicit = requestByName.get("explicit none");
  const decision = selectProtocolRoute({
    request: explicit,
    routingContext: {
      changedLines: 5_000,
      changedLineThreshold: 800,
      sensitiveFiles: ["src/security.js"],
      highRiskRoute: "deep",
    },
    policy: { independentReviewFloor: "copilot" },
  });
  assert.equal(decision.route, "none");
  assert.equal(decision.floorApplied, null);
});

test("explicit routes still validate ignored successor evidence", () => {
  const explicit = requestByName.get("explicit cheap");
  const validEvidence = successorByName.get("trusted bookkeeping-only successor");
  const decision = selectProtocolRoute({
    request: explicit,
    routingContext: { successorEvidence: validEvidence },
  });
  assert.equal(decision.route, "cheap");
  assert.equal(decision.successorEvidence, "ignored-explicit");

  const forbiddenEvidence = { ...clone(validEvidence), extension: { prompt: "fixture" } };
  assert.throws(
    () => selectProtocolRoute({
      request: explicit,
      routingContext: { successorEvidence: forbiddenEvidence },
    }),
    /successorEvidence\.extension\.prompt is forbidden by the protocol privacy boundary/u,
  );
});

test("confidence validation identifies the exact protocol field", () => {
  const request = requestByName.get("explicit cheap");
  assert.throws(
    () => decodeReviewRequest({ ...clone(request), trustedConfidence: "impossible" }),
    /request\.trustedConfidence must be one of/u,
  );
  assert.throws(
    () => selectProtocolRoute({ request, routingContext: { confidence: "impossible" } }),
    /routingContext\.confidence must be one of/u,
  );
  assert.throws(
    () => selectProtocolRoute({ request, routingContext: { highRiskRoute: "cheap" } }),
    /routingContext\.highRiskRoute must be deep or copilot/u,
  );
});

test("eligible local evidence can lower automatic cost without selecting a stronger route", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  for (const localReview of [
    automatic.localReview,
    localSummaries.find((entry) => entry.name === "fully dispositioned").value,
  ]) {
    const decision = selectProtocolRoute({
      request: { ...clone(automatic), localReview: clone(localReview) },
      routingContext: { confidence: "low", lowConfidenceRoute: "deep" },
      policy: { localEvidenceRoute: "cheap", localConfidenceThreshold: 90 },
    });
    assert.equal(decision.route, "cheap", localReview.outcome);
    assert.equal(decision.localEvidence, "lowered", localReview.outcome);
    assert.match(decision.reason, /local evidence lowered auto to cheap/u, localReview.outcome);
  }
});

test("failed, cancelled, skipped, and low-confidence local evidence supply no positive confidence", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  for (const outcome of ["failed", "cancelled", "skipped"]) {
    const request = clone(automatic);
    request.localReview.outcome = outcome;
    request.localReview.confidence = 0;
    request.localReview.dispositionCounts = { total: 0, unresolved: 0, fixed: 0, rebutted: 0 };
    if (outcome === "skipped") request.localReview.skipReason = "bookkeeping-successor";
    const decision = selectProtocolRoute({
      request,
      routingContext: { confidence: "low", lowConfidenceRoute: "deep" },
      policy: { localEvidenceRoute: "none" },
    });
    assert.equal(decision.route, "deep", outcome);
    assert.equal(decision.localEvidence, "ineligible", outcome);
  }

  const lowConfidence = clone(automatic);
  lowConfidence.localReview.confidence = 20;
  const decision = selectProtocolRoute({
    request: lowConfidence,
    routingContext: { confidence: "low", lowConfidenceRoute: "deep" },
    policy: { localEvidenceRoute: "none", localConfidenceThreshold: 80 },
  });
  assert.equal(decision.route, "deep");
});

// Pins the src/protocol.js:970 decode fallback (`context.highRiskRoute ?? …`),
// which is reached when the routing context omits the field entirely — a third
// distinct site from the two input fallbacks.
test("a routing context omitting highRiskRoute resolves the deep default", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  for (const routingContext of [
    { sensitiveFiles: ["src/security.js"] },
    { changedLines: 800, changedLineThreshold: 800 },
  ]) {
    const decision = selectProtocolRoute({
      request: automatic,
      routingContext,
      policy: { localEvidenceRoute: "none" },
    });
    assert.equal(decision.route, "deep");
  }
});

test("sensitive and large-change floors cannot be bypassed by local evidence", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  for (const routingContext of [
    { sensitiveFiles: ["src/security.js"], highRiskRoute: "copilot" },
    { changedLines: 800, changedLineThreshold: 800, highRiskRoute: "copilot" },
  ]) {
    const decision = selectProtocolRoute({
      request: automatic,
      routingContext,
      policy: { localEvidenceRoute: "none" },
    });
    assert.equal(decision.route, "copilot");
    assert.equal(decision.floorApplied, "copilot");
  }
});

test("configured deep high-risk floors cannot be bypassed and may be strengthened", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  for (const routingContext of [
    { sensitiveFiles: ["src/security.js"] },
    { changedLines: 800, changedLineThreshold: 800 },
  ]) {
    const decision = selectProtocolRoute({
      request: automatic,
      routingContext: { ...routingContext, highRiskRoute: "deep" },
      policy: { localEvidenceRoute: "none" },
    });
    assert.equal(decision.route, "deep");
    assert.equal(decision.floorApplied, "deep");
  }

  const strengthened = selectProtocolRoute({
    request: automatic,
    routingContext: {
      sensitiveFiles: ["src/security.js"],
      highRiskRoute: "deep",
    },
    policy: { localEvidenceRoute: "none", independentReviewFloor: "copilot" },
  });
  assert.equal(strengthened.route, "copilot");
  assert.equal(strengthened.floorApplied, "copilot");

  const successor = requestByName.get("automatic successor");
  const bookkeeping = successorByName.get("trusted bookkeeping-only successor");
  const bookkeepingDecision = selectProtocolRoute({
    request: successor,
    routingContext: {
      sensitiveFiles: ["src/security.js"],
      highRiskRoute: "deep",
      successorEvidence: bookkeeping,
    },
    policy: { allowBookkeepingNone: true },
  });
  assert.equal(bookkeepingDecision.route, "deep");
  assert.equal(bookkeepingDecision.floorApplied, "deep");
});

test("configured independent-review floors apply after eligible local evidence", () => {
  const automatic = requestByName.get("automatic with exact-head local evidence");
  const decision = selectProtocolRoute({
    request: automatic,
    policy: { localEvidenceRoute: "none", independentReviewFloor: "deep" },
  });
  assert.equal(decision.route, "deep");
  assert.equal(decision.floorApplied, "deep");
});

test("trusted bookkeeping-only successor evidence may select none only when policy permits", () => {
  const successor = requestByName.get("automatic successor");
  const bookkeeping = successorByName.get("trusted bookkeeping-only successor");
  const allowed = selectProtocolRoute({
    request: successor,
    routingContext: { successorEvidence: bookkeeping },
    policy: { allowBookkeepingNone: true },
  });
  assert.equal(allowed.route, "none");
  assert.equal(allowed.successorEvidence, "lowered");

  const floored = selectProtocolRoute({
    request: successor,
    routingContext: { successorEvidence: bookkeeping },
    policy: { allowBookkeepingNone: true, independentReviewFloor: "cheap" },
  });
  assert.equal(floored.route, "cheap");
  assert.equal(floored.floorApplied, "cheap");

  assert.throws(
    () => selectProtocolRoute({
      request: successor,
      routingContext: { successorEvidence: bookkeeping },
      policy: { allowBookkeepingNone: "true" },
    }),
    /allowBookkeepingNone must be a boolean/u,
  );
});

test("mixed, non-comparable, and changed-head successor evidence cannot skip independent review", () => {
  const successor = requestByName.get("automatic successor");
  for (const name of [
    "trusted mixed successor",
    "content-changing successor",
    "non-comparable successor",
    "changed-head successor",
  ]) {
    const decision = selectProtocolRoute({
      request: successor,
      routingContext: { successorEvidence: successorByName.get(name) },
      policy: { allowBookkeepingNone: true },
    });
    assert.equal(decision.route, "cheap", name);
    assert.equal(decision.successorEvidence, "unchanged", name);
  }
});

test("successor evidence must match a declared prior receipt and exact current head", () => {
  const successor = requestByName.get("automatic successor");
  const bookkeeping = successorByName.get("trusted bookkeeping-only successor");
  const noDeclaration = clone(successor);
  delete noDeclaration.supersedes;
  assert.throws(
    () => selectProtocolRoute({
      request: noDeclaration,
      routingContext: { successorEvidence: bookkeeping },
      policy: { allowBookkeepingNone: true },
    }),
    /requires request.supersedes/u,
  );

  const changedHead = clone(bookkeeping);
  changedHead.currentHeadSha = "9999999999999999999999999999999999999999";
  assert.throws(
    () => selectProtocolRoute({
      request: successor,
      routingContext: { successorEvidence: changedHead },
      policy: { allowBookkeepingNone: true },
    }),
    /currentHeadSha must match/u,
  );
});

// Route policy: the repository's recorded REVIEW_ROUTE_MODE as a *maximum* on
// what a caller may explicitly request. The floor is the minimum; these are
// opposite bounds and are deliberately evaluated against different things --
// the floor against the resolved route, the policy against the requested one.
function requestRouted(route) {
  const base = clone(requestByName.get("explicit cheap"));
  base.route = route;
  return base;
}

test("route policy permits an explicit route that equals the recorded mode", () => {
  for (const mode of ["cheap", "deep", "copilot", "none"]) {
    const decision = selectProtocolRoute({
      request: requestRouted(mode),
      policy: { routePolicy: mode },
    });
    assert.equal(decision.route, mode, `policy ${mode} must permit an explicit ${mode}`);
  }
});

test("route policy refuses an explicit route the repository did not declare", () => {
  assert.throws(
    () => selectProtocolRoute({
      request: requestRouted("cheap"),
      policy: { routePolicy: "copilot" },
    }),
    /route "cheap" is not permitted by this repository's review policy/u,
  );
});

test("the refusal names the variable, its value, and the permitted route", () => {
  try {
    selectProtocolRoute({
      request: requestRouted("deep"),
      policy: { routePolicy: "copilot" },
    });
    assert.fail("expected the policy refusal to throw");
  } catch (error) {
    assert.match(error.message, /REVIEW_ROUTE_MODE = copilot/u);
    // `auto` must be named. It is always permitted, so a message listing only
    // the policy value tells the operator that fewer routes are open than
    // really are.
    assert.match(error.message, /permitted: auto, copilot/u);
    assert.match(error.message, /--remote auto/u);
    assert.match(error.message, /--remote copilot/u);
  }
});

test("a none policy advises the automatic route rather than requesting no review", () => {
  // Under `none` the old text's only suggestion was `--remote none` -- asking
  // for no review, which is never what an operator who just requested one
  // wants. `auto` is the actionable answer and was not mentioned at all.
  try {
    selectProtocolRoute({
      request: requestRouted("copilot"),
      policy: { routePolicy: "none" },
    });
    assert.fail("expected the policy refusal to throw");
  } catch (error) {
    assert.match(error.message, /permitted: auto, none/u);
    assert.match(error.message, /--remote auto/u);
    assert.doesNotMatch(error.message, /--remote none/u);
  }
});

// `none` looks like it can never be worse than what the policy allows -- asking
// for no review spends nothing. It is worse: under a copilot policy it evades
// the independent review the consumer declared it wanted.
test("route policy refuses an explicit none under a stricter policy", () => {
  assert.throws(
    () => selectProtocolRoute({
      request: requestRouted("none"),
      policy: { routePolicy: "copilot" },
    }),
    /route "none" is not permitted/u,
  );
});

// The falsification for the load-bearing decision. Enforcing the policy against
// the *resolved* route instead of the requested one passes every other test in
// this file and breaks exactly this case: the consumer's own copilot floor
// raises an automatic request above its own cheap policy, and the repository
// refuses its own default review. This is the shape every fleet consumer has.
test("an automatic request survives a policy its own floor outranks", () => {
  const decision = selectProtocolRoute({
    request: requestByName.get("automatic with exact-head local evidence"),
    routingContext: { sensitiveFiles: ["src/security.js"], highRiskRoute: "deep" },
    policy: { routePolicy: "cheap", independentReviewFloor: "copilot" },
  });
  assert.equal(decision.route, "copilot");
  assert.equal(decision.floorApplied, "copilot");
});

test("auto is permitted under every recorded policy", () => {
  for (const mode of ["auto", "cheap", "deep", "copilot", "none"]) {
    const decision = selectProtocolRoute({
      request: requestByName.get("automatic with exact-head local evidence"),
      policy: { routePolicy: mode },
    });
    assert.ok(decision.route, `policy ${mode} must still route an automatic request`);
  }
});

test("policy auto permits every explicit route", () => {
  for (const mode of ["cheap", "deep", "copilot", "none"]) {
    const decision = selectProtocolRoute({
      request: requestRouted(mode),
      policy: { routePolicy: "auto" },
    });
    assert.equal(decision.route, mode);
  }
});

// A consumer below manifest schema 4 records no route mode, and an unset
// GitHub variable expands to "". Both mean "no policy", not "deny everything".
test("an absent or empty route policy permits every explicit route", () => {
  for (const policy of [{}, { routePolicy: "" }, { routePolicy: undefined }]) {
    for (const mode of ["cheap", "deep", "copilot", "none"]) {
      const decision = selectProtocolRoute({ request: requestRouted(mode), policy });
      assert.equal(decision.route, mode);
    }
  }
});

// An invalid value is not an absent one. A typo must fail the dispatch rather
// than silently disabling enforcement on that consumer.
test("an unrecognized route policy fails the dispatch", () => {
  assert.throws(
    () => selectProtocolRoute({
      request: requestRouted("cheap"),
      policy: { routePolicy: "copilto" },
    }),
    /policy\.routePolicy must be one of: auto, cheap, deep, copilot, none/u,
  );
});

// Operators set REVIEW_ROUTE_MODE by hand in the GitHub UI. A value that looks
// blank must behave like an unset one, and a value with stray padding must
// still work, rather than failing every dispatch on that consumer.
test("a whitespace-only route policy reads as no policy", () => {
  const decision = selectProtocolRoute({
    request: requestRouted("cheap"),
    policy: { routePolicy: "   " },
  });
  assert.equal(decision.route, "cheap");
});

test("a padded route policy is honored rather than rejected", () => {
  const decision = selectProtocolRoute({
    request: requestRouted("copilot"),
    policy: { routePolicy: "  copilot  " },
  });
  assert.equal(decision.route, "copilot");
  assert.throws(
    () => selectProtocolRoute({
      request: requestRouted("cheap"),
      policy: { routePolicy: "  copilot  " },
    }),
    /route "cheap" is not permitted/u,
  );
});

test("a non-string route policy is refused as a string error", () => {
  assert.throws(
    () => selectProtocolRoute({
      request: requestRouted("cheap"),
      policy: { routePolicy: 3 },
    }),
    /policy\.routePolicy must be a string/u,
  );
});

// A bare attempt bump used to be an authorization bypass: ReceiptStore's
// #validateRerequest returns immediately when rerequestOf is absent, so
// rerequest-authorized, prior-receipt identity, supportsRerequest, the policy
// version check and the route/backend match were all skipped -- and because
// attempt is part of the logical identity, the bump minted a fresh dispatch
// instead of colliding with the stored receipt. review-request is a free-text
// workflow_dispatch input, so this was reachable by anyone who could dispatch.
test("a same-head retry must declare what it retries", () => {
  const base = requestByName.get("explicit cheap");
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), attempt: 2 }),
    /request\.attempt is the remote dispatch counter for this head and must be 1 on the first dispatch; 2 without request\.rerequestOf/u,
  );
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), attempt: 7 }),
    /7 without request\.rerequestOf claims a same-head re-request of remote attempt 6 that was never made/u,
  );
  // Issue #155: the rejection must name the counter that is wrong, and must
  // not send a first-dispatch operator to re-request handling. The old text
  // ended "...identifying the prior attempt", which is exactly where it sent
  // them.
  assert.throws(
    () => decodeReviewRequest({ ...clone(base), attempt: 6 }),
    (error) => {
      assert.match(error.message, /remote dispatch counter/u);
      assert.match(error.message, /Local review rounds must not be forwarded as request\.attempt/u);
      assert.doesNotMatch(error.message, /identifying the prior attempt/u);
      return true;
    },
  );
  // attempt 1 is the ordinary first dispatch and must stay unencumbered.
  assert.doesNotThrow(() => decodeReviewRequest({ ...clone(base), attempt: 1 }));
});
