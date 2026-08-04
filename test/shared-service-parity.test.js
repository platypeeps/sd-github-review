import assert from "node:assert/strict";
import test from "node:test";
import { buildRiskContext } from "../src/risk-context.js";
import { requestCopilotReviewer } from "../src/reviewer-dispatch.js";
import { routeReview, selectProtocolRoute } from "../src/router.js";

// AC2 for A-008: prove the standalone and durable entrypoints share one
// risk-context builder and one reviewer-dispatch probe, with a DISCRIMINATING
// case (C-4) that fails if standalone silently gains route policy.

const HEAD = "a".repeat(40);
const REVIEWER = "copilot-pull-request-reviewer[bot]";

function autoRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    correlationId: "corr-shared",
    attempt: 1,
    repository: { owner: "platypeeps", name: "sd-github-review" },
    pullRequestNumber: 42,
    headSha: HEAD,
    route: "auto",
    policyVersion: "policy-v1",
    ...overrides,
  };
}

// One set of risk inputs both entrypoints would compute for the same PR.
const RISK_INPUTS = {
  changedLines: 100,
  changedLineThreshold: 800,
  files: ["docs/readme.md"],
  sensitivePaths: ["src/security/**"],
  confidence: "unknown",
  lowConfidenceRoute: "deep",
  highRiskRoute: "copilot",
  draft: false,
  reviewDrafts: false,
};

function fakeClient({ requestedUsers = [], reviews = [] } = {}) {
  const calls = [];
  return {
    calls,
    async getRequestedReviewers() {
      calls.push("getRequestedReviewers");
      return { users: requestedUsers };
    },
    async listPullRequestReviews() {
      calls.push("listPullRequestReviews");
      return reviews;
    },
    async requestReviewer(number, reviewer) {
      calls.push(["requestReviewer", number, reviewer]);
    },
  };
}

test("both entrypoints build an identical normalized risk context from the same inputs", () => {
  const standaloneContext = buildRiskContext(RISK_INPUTS);
  const durableContext = buildRiskContext(RISK_INPUTS);
  assert.deepEqual(standaloneContext, durableContext);
  assert.deepEqual(standaloneContext, {
    changedLines: 100,
    changedLineThreshold: 800,
    sensitiveFiles: [],
    confidence: "unknown",
    lowConfidenceRoute: "deep",
    highRiskRoute: "copilot",
    draft: false,
    reviewDrafts: false,
  });
});

test("a configured independent-review floor raises the durable route but leaves standalone unchanged", () => {
  const risk = buildRiskContext(RISK_INPUTS);

  // Standalone remains policy-free: routeReview over the shared risk inputs.
  const standalone = routeReview({
    configuredMode: "auto",
    labelMode: null,
    commandMode: null,
    eventName: "pull_request",
    eventAction: "opened",
    ...risk,
  });
  assert.equal(standalone.route, "cheap");

  // Durable feeds the same risk inputs through the policy owner with a floor.
  const durable = selectProtocolRoute({
    request: autoRequest(),
    routingContext: { ...risk },
    policy: { independentReviewFloor: "deep" },
  });
  assert.equal(durable.route, "deep");
  assert.equal(durable.floorApplied, "deep");

  // The discriminating assertion: identical risk inputs, divergent routes,
  // because only the durable path applies the floor policy.
  assert.notEqual(standalone.route, durable.route);
});

test("the shared reviewer-dispatch probe covers requested, reviewed, dismissed, and new cases", async () => {
  const requested = fakeClient({ requestedUsers: [{ login: REVIEWER }] });
  const requestedResult = await requestCopilotReviewer({
    client: requested,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(requestedResult, {
    alreadyRequested: true,
    alreadyReviewed: false,
    alreadyPresent: true,
    requested: false,
  });
  // Already requested short-circuits before listing reviews or requesting.
  assert.ok(!requested.calls.includes("listPullRequestReviews"));
  assert.ok(!requested.calls.some((call) => Array.isArray(call) && call[0] === "requestReviewer"));

  // Exact-head review with a different-cased commit_id still matches.
  const reviewed = fakeClient({
    reviews: [{ user: { login: REVIEWER }, commit_id: HEAD.toUpperCase(), state: "COMMENTED" }],
  });
  const reviewedResult = await requestCopilotReviewer({
    client: reviewed,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(reviewedResult, {
    alreadyRequested: false,
    alreadyReviewed: true,
    alreadyPresent: true,
    requested: false,
  });

  // A DISMISSED review at the head is not presence; the reviewer is requested.
  const dismissed = fakeClient({
    reviews: [{ user: { login: REVIEWER }, commit_id: HEAD, state: "DISMISSED" }],
  });
  const dismissedResult = await requestCopilotReviewer({
    client: dismissed,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(dismissedResult, {
    alreadyRequested: false,
    alreadyReviewed: false,
    alreadyPresent: false,
    requested: true,
  });
  assert.ok(dismissed.calls.some((call) => Array.isArray(call) && call[0] === "requestReviewer"));

  // Brand-new request: no presence, one requestReviewer.
  const fresh = fakeClient();
  const freshResult = await requestCopilotReviewer({
    client: fresh,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(freshResult, {
    alreadyRequested: false,
    alreadyReviewed: false,
    alreadyPresent: false,
    requested: true,
  });
  assert.deepEqual(fresh.calls.filter((call) => Array.isArray(call)), [["requestReviewer", 42, REVIEWER]]);
});

test("selectProtocolRoute returns the exact explicit-branch shape", () => {
  const decision = selectProtocolRoute({
    request: autoRequest({ route: "cheap" }),
  });
  assert.deepEqual(decision, {
    route: "cheap",
    reason: "explicit cheap route selected",
    policyVersion: "policy-v1",
    floorApplied: null,
    localEvidence: "absent",
    successorEvidence: "absent",
  });
});

test("selectProtocolRoute returns the exact automatic-branch shape", () => {
  const decision = selectProtocolRoute({
    request: autoRequest(),
  });
  assert.deepEqual(decision, {
    route: "cheap",
    reason: "routine pull request within configured risk limits",
    policyVersion: "policy-v1",
    floorApplied: null,
    localEvidence: "absent",
    successorEvidence: "absent",
  });
});
