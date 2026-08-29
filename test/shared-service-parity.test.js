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

// `landsRequest: false` models the defect this service exists to catch: GitHub
// returns a non-error response to requestReviewer and adds nobody.
// `probeThrows: true` models a post-probe that cannot be read at all.
function fakeClient({
  requestedUsers = [],
  reviews = [],
  landsRequest = true,
  probeThrows = false,
  probeBody = undefined,
  preProbeBody = undefined,
  canonicalLogin = null,
  timeline = [],
  commitDate = null,
  timelineThrows = false,
  requestError = null,
} = {}) {
  const calls = [];
  let users = [...requestedUsers];
  let posted = false;
  return {
    calls,
    async listIssueTimeline() {
      calls.push("listIssueTimeline");
      if (timelineThrows) throw new Error("timeline unavailable");
      return timeline;
    },
    async getCommit(sha) {
      calls.push("getCommit");
      return { sha, commit: { committer: { date: commitDate } } };
    },
    async getRequestedReviewers() {
      calls.push("getRequestedReviewers");
      if (probeThrows && posted) throw new Error("probe unavailable");
      // A 2xx whose body the client could not turn into a reviewer set: the
      // client returns null for an empty body on an ok response.
      if (probeBody !== undefined && posted) return probeBody.value;
      if (preProbeBody !== undefined && !posted) return preProbeBody.value;
      return { users: [...users] };
    },
    async listPullRequestReviews() {
      calls.push("listPullRequestReviews");
      return reviews;
    },
    async requestReviewer(number, reviewer) {
      calls.push(["requestReviewer", number, reviewer]);
      if (requestError) throw requestError;
      posted = true;
      // GitHub stores its own canonical casing, not the string it was sent.
      // Echoing the argument back would make a casing test compare a value to
      // itself and pass against an exact-match implementation.
      if (landsRequest) users.push({ login: canonicalLogin ?? reviewer });
    },
    async removeRequestedReviewer(number, reviewer) {
      calls.push(["removeRequestedReviewer", number, reviewer]);
      users = users.filter((user) => user.login !== reviewer);
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
    rerequested: false,
    presence: "unverified",
    landing: "not-attempted",
  });
  // Already requested short-circuits before listing reviews or requesting.
  // With no timeline event to anchor it, the presence is reported unverified
  // rather than assumed to be for this head.
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
    rerequested: false,
    presence: "reviewed-head",
    landing: "not-attempted",
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
    rerequested: false,
    presence: "absent",
    landing: "confirmed",
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
    rerequested: false,
    presence: "absent",
    landing: "confirmed",
  });
  assert.deepEqual(fresh.calls.filter((call) => Array.isArray(call)), [["requestReviewer", 42, REVIEWER]]);

  // A-001: an authorized rerequest forces a fresh review. A still-requested
  // reviewer is removed then re-requested; an already-reviewed head is
  // re-requested directly.
  const forcedPending = fakeClient({ requestedUsers: [{ login: REVIEWER }] });
  const forcedPendingResult = await requestCopilotReviewer({
    client: forcedPending,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
    forceRerequest: true,
  });
  assert.deepEqual(forcedPendingResult, {
    alreadyRequested: true,
    alreadyReviewed: false,
    alreadyPresent: true,
    requested: true,
    rerequested: true,
    presence: "unverified",
    landing: "confirmed",
  });
  assert.deepEqual(
    forcedPending.calls.filter((call) => Array.isArray(call)),
    [["removeRequestedReviewer", 42, REVIEWER], ["requestReviewer", 42, REVIEWER]],
  );

  const forcedReviewed = fakeClient({
    reviews: [{ user: { login: REVIEWER }, commit_id: HEAD, state: "APPROVED" }],
  });
  const forcedReviewedResult = await requestCopilotReviewer({
    client: forcedReviewed,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
    forceRerequest: true,
  });
  assert.deepEqual(forcedReviewedResult, {
    alreadyRequested: false,
    alreadyReviewed: true,
    alreadyPresent: true,
    requested: true,
    rerequested: true,
    presence: "reviewed-head",
    landing: "confirmed",
  });
  assert.deepEqual(
    forcedReviewed.calls.filter((call) => Array.isArray(call)),
    [["requestReviewer", 42, REVIEWER]],
  );
});

// Regression: PR #156. GitHub returned a non-error response to requestReviewer
// and added nobody; deriving `requested` from the pre-call probe reported that
// as a landed request, which minted a durable receipt claiming a review that
// never happened and then blocked every retry.
// Issue #158: a pending request is anchored to a head only by the timeline's
// review_requested event against the head commit's committer date. A request
// that predates the commit cannot have been for it and is re-requested; one at
// or after it is current and needs no POST.
test("a pending request is anchored to the head it was made for", async () => {
  const stale = fakeClient({
    requestedUsers: [{ login: REVIEWER }],
    timeline: [
      { event: "review_requested", requested_reviewer: { login: REVIEWER }, created_at: "2026-08-27T00:41:21Z" },
    ],
    commitDate: "2026-08-27T00:43:06Z",
  });
  const staleResult = await requestCopilotReviewer({
    client: stale,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(staleResult, {
    alreadyRequested: true,
    alreadyReviewed: false,
    alreadyPresent: true,
    requested: true,
    rerequested: true,
    presence: "stale-request",
    landing: "confirmed",
  });
  assert.deepEqual(
    stale.calls.filter((call) => Array.isArray(call)),
    [["removeRequestedReviewer", 42, REVIEWER], ["requestReviewer", 42, REVIEWER]],
  );

  const current = fakeClient({
    requestedUsers: [{ login: REVIEWER }],
    timeline: [
      { event: "review_requested", requested_reviewer: { login: REVIEWER.toUpperCase() }, created_at: "2026-08-27T00:43:06Z" },
    ],
    commitDate: "2026-08-27T00:43:06Z",
  });
  const currentResult = await requestCopilotReviewer({
    client: current,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.equal(currentResult.presence, "current-head");
  assert.equal(currentResult.landing, "not-attempted");
  assert.deepEqual(current.calls.filter((call) => Array.isArray(call)), []);

  // Unreadable evidence is unverified, never a guess in either direction, and
  // never a re-request on its own.
  const unreadable = fakeClient({ requestedUsers: [{ login: REVIEWER }], timelineThrows: true });
  const unreadableResult = await requestCopilotReviewer({
    client: unreadable,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.equal(unreadableResult.presence, "unverified");
  assert.equal(unreadableResult.landing, "not-attempted");
  assert.deepEqual(unreadable.calls.filter((call) => Array.isArray(call)), []);

  // No head to anchor to (standalone without a head SHA): unverified, no reads.
  const headless = fakeClient({ requestedUsers: [{ login: REVIEWER }] });
  const headlessResult = await requestCopilotReviewer({
    client: headless,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
  });
  assert.equal(headlessResult.presence, "unverified");
  assert.ok(!headless.calls.includes("listIssueTimeline"));
});

// Issue #154: a 422 is GitHub refusing this pull request, terminal and named.
// Any other throw is not classified and propagates as before.
test("a 422 on the reviewer request is a decline, anything else propagates", async () => {
  const declining = fakeClient({
    requestError: Object.assign(new Error("GitHub API POST failed: Copilot cannot review this pull request"), {
      status: 422,
      apiMessage: "Copilot cannot review this pull request",
    }),
  });
  const declinedResult = await requestCopilotReviewer({
    client: declining,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(declinedResult, {
    alreadyRequested: false,
    alreadyReviewed: false,
    alreadyPresent: false,
    requested: false,
    rerequested: false,
    presence: "absent",
    landing: "declined",
    declined: { status: 422, message: "Copilot cannot review this pull request" },
  });

  const forced = fakeClient({
    requestedUsers: [{ login: REVIEWER }],
    requestError: Object.assign(new Error("refused"), { status: 422, apiMessage: "" }),
  });
  const forcedResult = await requestCopilotReviewer({
    client: forced,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
    forceRerequest: true,
  });
  assert.equal(forcedResult.landing, "declined");
  assert.equal(forcedResult.rerequested, false);
  assert.deepEqual(forcedResult.declined, { status: 422, message: "Unprocessable Entity" });

  const transport = fakeClient({ requestError: new Error("socket hang up") });
  await assert.rejects(
    requestCopilotReviewer({ client: transport, pullRequestNumber: 42, reviewer: REVIEWER, headSha: HEAD }),
    /socket hang up/u,
  );
  const forbidden = fakeClient({
    requestError: Object.assign(new Error("forbidden"), { status: 403, apiMessage: "forbidden" }),
  });
  await assert.rejects(
    requestCopilotReviewer({ client: forbidden, pullRequestNumber: 42, reviewer: REVIEWER, headSha: HEAD }),
    /forbidden/u,
  );
});

test("a requestReviewer that adds nobody is reported as absent, not requested", async () => {
  const silent = fakeClient({ landsRequest: false });
  const result = await requestCopilotReviewer({
    client: silent,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.deepEqual(result, {
    alreadyRequested: false,
    alreadyReviewed: false,
    alreadyPresent: false,
    requested: false,
    rerequested: false,
    presence: "absent",
    landing: "absent",
  });
  // The POST was attempted, and the post-probe is what caught it.
  assert.ok(silent.calls.some((call) => Array.isArray(call) && call[0] === "requestReviewer"));
  assert.equal(silent.calls.filter((call) => call === "getRequestedReviewers").length, 2);
});

test("an unreadable post-probe is unverified, never a landed request", async () => {
  const blind = fakeClient({ landsRequest: true, probeThrows: true });
  const result = await requestCopilotReviewer({
    client: blind,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
  });
  assert.equal(result.landing, "unverified");
  assert.equal(result.requested, false);
});

// `absent` is a positive claim -- GitHub accepted the request and added nobody
// -- and the caller fails closed on it. A 2xx the client could not read into a
// reviewer set is not that claim; reporting it as one manufactures the very
// evidence the contract distinguishes.
test("a post-probe with no readable reviewer set is unverified, not absent", async () => {
  for (const value of [undefined, null, {}, { users: null }, { users: "nope" }]) {
    const blind = fakeClient({ landsRequest: true, probeBody: { value } });
    const result = await requestCopilotReviewer({
      client: blind,
      pullRequestNumber: 42,
      reviewer: REVIEWER,
      headSha: HEAD,
    });
    assert.equal(result.landing, "unverified", `payload ${JSON.stringify(value)}`);
    assert.equal(result.requested, false);
  }
});

// `GitHubClient.request()` answers null for a 2xx with an empty body, so the
// pre-request probe can return no object at all. Dereferencing it would throw
// before the POST, replacing the fail-closed path with an unhandled exception.
test("an unreadable pre-request probe still posts and defers to the post-probe", async () => {
  for (const value of [null, undefined, {}, { users: null }]) {
    const blind = fakeClient({ preProbeBody: { value }, landsRequest: true });
    const result = await requestCopilotReviewer({
      client: blind,
      pullRequestNumber: 42,
      reviewer: REVIEWER,
      headSha: HEAD,
    });
    const label = `payload ${JSON.stringify(value ?? null)}`;
    // Unreadable is "not known to be present", never "already there".
    assert.equal(result.alreadyRequested, false, label);
    assert.deepEqual(
      blind.calls.filter((call) => Array.isArray(call)),
      [["requestReviewer", 42, REVIEWER]],
      label,
    );
    // The post-probe, not the unreadable pre-probe, renders the verdict.
    assert.equal(result.landing, "confirmed", label);
    assert.equal(result.requested, true, label);
  }
});

// GitHub echoes its own canonical casing for a login, which need not match the
// configured reviewer string. An exact comparison would read this landed
// request as absent and fail a healthy dispatch closed.
test("a login differing only in case is the same reviewer, not an absent one", async () => {
  const cased = fakeClient({ canonicalLogin: REVIEWER });
  const result = await requestCopilotReviewer({
    client: cased,
    pullRequestNumber: 42,
    reviewer: REVIEWER.toUpperCase(),
    headSha: HEAD,
  });
  // The POST was sent the uppercase string and the probe read back the
  // canonical one, so the comparison genuinely spans two casings.
  assert.deepEqual(
    cased.calls.filter((call) => Array.isArray(call)),
    [["requestReviewer", 42, REVIEWER.toUpperCase()]],
  );
  assert.equal(result.landing, "confirmed");
  assert.equal(result.requested, true);

  // The pre-call presence probe reads the same rule, so an already-requested
  // reviewer is not re-POSTed merely because the casing differs.
  const present = fakeClient({ requestedUsers: [{ login: REVIEWER }] });
  const presentResult = await requestCopilotReviewer({
    client: present,
    pullRequestNumber: 42,
    reviewer: REVIEWER.toUpperCase(),
    headSha: HEAD,
  });
  assert.equal(presentResult.alreadyRequested, true);
  assert.equal(presentResult.landing, "not-attempted");
  assert.ok(!present.calls.some((call) => Array.isArray(call) && call[0] === "requestReviewer"));
});

test("an authorized rerequest that does not land is not reported as rerequested", async () => {
  const silentForce = fakeClient({ requestedUsers: [{ login: REVIEWER }], landsRequest: false });
  const result = await requestCopilotReviewer({
    client: silentForce,
    pullRequestNumber: 42,
    reviewer: REVIEWER,
    headSha: HEAD,
    forceRerequest: true,
  });
  assert.equal(result.landing, "absent");
  assert.equal(result.requested, false);
  assert.equal(result.rerequested, false);
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
