import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runAction } from "../src/index.js";
import { buildAdapterAcknowledgment, writeDurableSummary } from "../src/operations.js";
import { stableProtocolJson } from "../src/protocol.js";
import { RECEIPT_CHECK_NAME } from "../src/receipt.js";

async function fixture(name) {
  const url = new URL(`../fixtures/protocol/v1/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const requests = await fixture("requests.valid.json");
const supporting = await fixture("supporting.valid.json");
const requestByName = new Map(requests.map((entry) => [entry.name, entry.value]));
const backendByName = new Map(supporting.backends.map((entry) => [entry.name, entry.value]));
const adapterRequestByName = new Map(
  supporting.adapterRequests.map((entry) => [entry.name, entry.value]),
);

function clone(value) {
  return structuredClone(value);
}

function checkFromPayload(id, payload) {
  return {
    id,
    name: payload.name ?? RECEIPT_CHECK_NAME,
    head_sha: payload.head_sha,
    external_id: payload.external_id,
    status: payload.status,
    conclusion: payload.conclusion ?? null,
    output: clone(payload.output),
  };
}

class FakeGitHubClient {
  constructor(headSha) {
    this.owner = "platypeeps";
    this.repo = "sd-github-review";
    this.headSha = headSha;
    this.files = [];
    this.fileNames = [];
    this.checks = new Map();
    this.nextId = 100;
    this.requestedUsers = [];
    this.reviews = [];
    this.calls = [];
    this.createError = null;
    this.requestError = null;
    // A 2xx requestReviewer that adds nobody, and a post-request probe that
    // cannot be read. Both are what PR #156 hit; neither throws, so neither is
    // reachable through requestError.
    this.landsRequest = true;
    this.probeError = null;
    this.posted = false;
    // Breaks only the receipt read that `observe` performs, and only after the
    // reviewer request landed -- the one case where the dispatch succeeded and
    // the observation did not.
    this.observeError = null;
    // Breaks only the durable write of the dispatch failure: the transition
    // runs after the reviewer request, so gating on `posted` leaves begin()
    // intact.
    this.failPersistError = null;
    this.comparison = null;
    this.draft = false;
    // Anchor evidence for a pending reviewer request (issue #158): the issue
    // timeline's review_requested events and each head commit's committer
    // date. Absent by default, which reads as an unanchorable request.
    this.timeline = [];
    this.commitDates = new Map();
    this.timelineError = null;
    this.commitError = null;
  }

  async listIssueTimeline(number) {
    this.calls.push(["listIssueTimeline", number]);
    if (this.timelineError) throw this.timelineError;
    return clone(this.timeline);
  }

  async getCommit(sha) {
    this.calls.push(["getCommit", sha]);
    if (this.commitError) throw this.commitError;
    const date = this.commitDates.get(sha);
    if (!date) throw new Error(`fake commit ${sha} not found`);
    return { sha, commit: { committer: { date } } };
  }

  async getPullRequest(number) {
    this.calls.push(["getPullRequest", number]);
    return {
      number,
      additions: 40,
      deletions: 2,
      draft: this.draft,
      head: { sha: this.headSha },
    };
  }

  async listPullRequestFiles(number) {
    this.calls.push(["listPullRequestFiles", number]);
    return clone(this.fileNames);
  }

  async listCheckRuns(head, name) {
    this.calls.push(["listCheckRuns", head, name]);
    if (this.observeError && this.posted) throw this.observeError;
    return clone(this.checks.get(head) ?? []);
  }

  async createCheckRun(payload) {
    this.calls.push(["createCheckRun", clone(payload)]);
    if (this.createError) throw this.createError;
    const check = checkFromPayload(this.nextId, payload);
    this.nextId += 1;
    this.checks.set(payload.head_sha, [...(this.checks.get(payload.head_sha) ?? []), check]);
    return clone(check);
  }

  async updateCheckRun(id, payload) {
    this.calls.push(["updateCheckRun", id, clone(payload)]);
    if (this.failPersistError && this.posted) throw this.failPersistError;
    for (const [head, checks] of this.checks.entries()) {
      const index = checks.findIndex((check) => check.id === id);
      if (index === -1) continue;
      checks[index] = {
        ...checks[index],
        ...clone(payload),
        head_sha: head,
        name: checks[index].name,
      };
      return clone(checks[index]);
    }
    throw new Error("missing fake check");
  }

  async getRequestedReviewers(number) {
    this.calls.push(["getRequestedReviewers", number]);
    if (this.probeError && this.posted) throw this.probeError;
    return { users: clone(this.requestedUsers), teams: [] };
  }

  async listPullRequestReviews(number) {
    this.calls.push(["listPullRequestReviews", number]);
    return clone(this.reviews);
  }

  async requestReviewer(number, reviewer) {
    this.calls.push(["requestReviewer", number, reviewer]);
    if (this.requestError) throw this.requestError;
    this.posted = true;
    if (this.landsRequest) this.requestedUsers.push({ login: reviewer });
    return { users: clone(this.requestedUsers) };
  }

  async removeRequestedReviewer(number, reviewer) {
    this.calls.push(["removeRequestedReviewer", number, reviewer]);
    this.requestedUsers = this.requestedUsers.filter((user) => user.login !== reviewer);
    return { users: clone(this.requestedUsers) };
  }

  async compareCommits(base, head) {
    this.calls.push(["compareCommits", base, head]);
    return clone(this.comparison);
  }
}

function createHarness(client) {
  const outputs = new Map();
  const summaries = [];
  const logs = [];
  // Settable so a test can tell a preserved durable record apart from one that
  // was rewritten with identical content; at a fixed clock the two are
  // indistinguishable.
  const clock = { now: "2026-07-23T12:30:10Z" };
  const run = (operation, request, extraEnv = {}) => {
    outputs.clear();
    summaries.length = 0;
    logs.length = 0;
    return runAction({
      event: {},
      eventName: "workflow_dispatch",
      env: {
        GITHUB_REPOSITORY: "platypeeps/sd-github-review",
        "INPUT_GITHUB-TOKEN": "test-token",
        INPUT_OPERATION: operation,
        "INPUT_REVIEW-REQUEST": JSON.stringify(request),
        ...extraEnv,
      },
      clientFactory: () => client,
      outputWriter: (name, value) => outputs.set(name, value),
      summaryWriter: (summary) => summaries.push(summary),
      logger: (message) => logs.push(message),
      now: () => clock.now,
    });
  };
  return { outputs, summaries, logs, run, clock };
}

test("durable external route emits one canonical adapter request and replay emits none", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  };

  const routed = await harness.run("route", request, env);

  assert.equal(routed.state, "started");
  assert.equal(routed.dispatchAllowed, true);
  assert.equal(harness.outputs.get("run-external-reviewer"), "true");
  const adapterRequest = JSON.parse(harness.outputs.get("adapter-request"));
  assert.equal(adapterRequest.schemaVersion, 1);
  assert.equal(adapterRequest.requestType, "routed-review-dispatch");
  assert.equal(adapterRequest.logicalDispatchId, routed.receipt.logicalDispatchId);
  assert.equal(adapterRequest.backend.id, "pr-agent");
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);

  const replay = await harness.run(
    "route",
    { ...request, correlationId: "corr-cheap-replay" },
    env,
  );
  assert.equal(replay.dispatchAllowed, false);
  // A replay while the first dispatch is still running is healthy: it must not
  // authorize a second dispatch, and must not call for a human either.
  assert.equal(replay.reconciliationRequired, false);
  assert.equal(replay.state, "in-flight");
  assert.equal(harness.outputs.get("adapter-request"), "");
  assert.equal(harness.outputs.get("run-external-reviewer"), "false");
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);
  assert.deepEqual(replay.receipt.correlationIds, ["corr-cheap", "corr-cheap-replay"]);
});

test("builds canonical adapter acknowledgments from bounded step outcomes", async () => {
  const request = adapterRequestByName.get("PR-Agent cheap dispatch");
  const acknowledged = buildAdapterAcknowledgment(
    request,
    "success",
    "2026-07-23T12:30:10Z",
  );
  assert.deepEqual(acknowledged, {
    schemaVersion: 1,
    logicalDispatchId: request.logicalDispatchId,
    backendId: "pr-agent",
    status: "acknowledged",
    acknowledgedAt: "2026-07-23T12:30:10Z",
    findingChannels: ["conversation-comment"],
  });

  const errorCodes = new Map([
    ["failure", "adapter-failed"],
    ["cancelled", "adapter-cancelled"],
    ["skipped", "adapter-skipped"],
  ]);
  for (const [outcome, errorCode] of errorCodes) {
    const failed = buildAdapterAcknowledgment(
      request,
      outcome,
      "2026-07-23T12:30:10Z",
    );
    assert.equal(failed.status, "failed", outcome);
    assert.equal(failed.errorCode, errorCode, outcome);
  }

  assert.throws(
    () => buildAdapterAcknowledgment(request, "unknown", "2026-07-23T12:30:10Z"),
    /adapter-outcome must be one of/u,
  );
});

test("acknowledge operation does not construct a GitHub client", async () => {
  const request = adapterRequestByName.get("PR-Agent cheap dispatch");
  const outputs = new Map();
  const summaries = [];
  let factories = 0;
  const result = await runAction({
    event: {},
    eventName: "workflow_dispatch",
    env: {
      "INPUT_OPERATION": "acknowledge",
      "INPUT_ADAPTER-REQUEST": JSON.stringify(request),
      "INPUT_ADAPTER-OUTCOME": "success",
    },
    clientFactory() {
      factories += 1;
      throw new Error("acknowledge must not construct a GitHub client");
    },
    outputWriter: (name, value) => outputs.set(name, value),
    summaryWriter: (summary) => summaries.push(summary),
    logger() {},
    now: () => "2026-07-23T12:30:10Z",
  });

  assert.equal(factories, 0);
  assert.equal(result.acknowledgment.status, "acknowledged");
  assert.equal(outputs.get("operation"), "acknowledge");
  assert.deepEqual(JSON.parse(outputs.get("adapter-acknowledgment")), result.acknowledgment);
  assert.deepEqual(summaries, [
    {
      operation: "acknowledge",
      state: "acknowledged",
      receipt: null,
      dispatchAllowed: false,
      reconciliationRequired: false,
      changedLines: 0,
      sensitiveCount: 0,
    },
  ]);
});

test("acknowledge tolerates the github-token envelope (A-010, shipped finalize job shape)", async () => {
  const request = adapterRequestByName.get("PR-Agent cheap dispatch");
  const outputs = new Map();
  const result = await runAction({
    event: {},
    eventName: "workflow_dispatch",
    env: {
      "INPUT_OPERATION": "acknowledge",
      "INPUT_GITHUB-TOKEN": "ghs_shipped_example_token",
      "INPUT_ADAPTER-REQUEST": JSON.stringify(request),
      "INPUT_ADAPTER-OUTCOME": "success",
    },
    clientFactory() {
      throw new Error("acknowledge must not construct a GitHub client");
    },
    outputWriter: (name, value) => outputs.set(name, value),
    summaryWriter() {},
    logger() {},
    now: () => "2026-07-23T12:30:10Z",
  });
  assert.equal(result.acknowledgment.status, "acknowledged");
  assert.equal(outputs.get("operation"), "acknowledge");
});

test("acknowledge rejects another operation's payload input (A-010)", async () => {
  const request = adapterRequestByName.get("PR-Agent cheap dispatch");
  await assert.rejects(
    runAction({
      event: {},
      eventName: "workflow_dispatch",
      env: {
        "INPUT_OPERATION": "acknowledge",
        "INPUT_ADAPTER-REQUEST": JSON.stringify(request),
        "INPUT_ADAPTER-OUTCOME": "success",
        "INPUT_REVIEW-REQUEST": JSON.stringify(requestByName.get("explicit cheap")),
      },
      clientFactory() {
        throw new Error("acknowledge must not construct a GitHub client");
      },
      outputWriter() {},
      summaryWriter() {},
      logger() {},
      now: () => "2026-07-23T12:30:10Z",
    }),
    /acknowledge does not accept review-request/u,
  );
});

for (const operation of ["route", "finalize", "query"]) {
  test(`${operation} without github-token throws a bounded explicit error (A-010)`, async () => {
    await assert.rejects(
      runAction({
        event: {},
        eventName: "workflow_dispatch",
        env: {
          "INPUT_OPERATION": operation,
          "INPUT_REVIEW-REQUEST": JSON.stringify(requestByName.get("explicit cheap")),
          "INPUT_ADAPTER-ACKNOWLEDGMENT": operation === "finalize" ? "{}" : "",
        },
        clientFactory() {
          throw new Error("client must not be constructed without a token");
        },
        outputWriter() {},
        summaryWriter() {},
        logger() {},
        now: () => "2026-07-23T12:30:10Z",
      }),
      new RegExp(`operation "${operation}" requires github-token`, "u"),
    );
  });
}

test("conflicting retries fail while policy-authorized rerequests use a new attempt", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const backendEnv = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  };
  const first = await harness.run("route", request, backendEnv);

  await assert.rejects(
    harness.run("route", { ...request, policyReference: "changed-policy" }, backendEnv),
    /conflicts with the canonical request fingerprint/u,
  );
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);

  const rerequest = {
    ...request,
    correlationId: "corr-cheap-rerequest",
    attempt: 2,
    rerequestOf: {
      priorReceiptId: first.receipt.receiptId,
      priorLogicalDispatchId: first.receipt.logicalDispatchId,
      priorAttempt: 1,
    },
  };
  await assert.rejects(
    harness.run("route", rerequest, backendEnv),
    /not authorized by repository policy/u,
  );
  const second = await harness.run("route", rerequest, {
    ...backendEnv,
    "INPUT_REREQUEST-AUTHORIZED": "true",
  });
  assert.equal(second.dispatchAllowed, true);
  assert.equal(second.receipt.attempt, 2);
  assert.notEqual(second.receipt.logicalDispatchId, first.receipt.logicalDispatchId);
  assert.notEqual(harness.outputs.get("adapter-request"), "");
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 2);
});

test("finalize requires a matching acknowledgment and is idempotent after observation", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const routed = await harness.run("route", request, {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });
  const acknowledgment = {
    schemaVersion: 1,
    logicalDispatchId: routed.receipt.logicalDispatchId,
    backendId: "pr-agent",
    status: "acknowledged",
    acknowledgedAt: "2026-07-23T12:30:10Z",
    findingChannels: ["conversation-comment"],
  };

  await assert.rejects(
    harness.run("finalize", request, {
      "INPUT_ADAPTER-ACKNOWLEDGMENT": JSON.stringify({
        ...acknowledgment,
        acknowledgedAt: "2026-07-23T12:31:00Z",
      }),
    }),
    /acknowledgedAt must not be after finalization time/u,
  );
  assert.equal(client.calls.filter(([name]) => name === "updateCheckRun").length, 0);

  const finalized = await harness.run("finalize", request, {
    "INPUT_ADAPTER-ACKNOWLEDGMENT": JSON.stringify(acknowledgment),
  });
  assert.equal(finalized.state, "observed");
  assert.equal(finalized.receipt.dispatch.phase, "observed");
  assert.equal(finalized.receipt.dispatch.status, "requested");
  assert.equal(harness.outputs.get("dispatch-phase"), "observed");
  assert.equal(harness.outputs.get("adapter-request"), "");

  const replay = await harness.run("finalize", request, {
    "INPUT_ADAPTER-ACKNOWLEDGMENT": JSON.stringify(acknowledgment),
  });
  assert.equal(replay.state, "observed");
  assert.equal(replay.receipt.dispatch.phase, "observed");
});

test("external check failure completes the shared receipt without a fallback", async () => {
  const request = clone(requestByName.get("explicit deep"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const routed = await harness.run("route", request, {
    "INPUT_DEEP-BACKEND": JSON.stringify(backendByName.get("external check backend")),
  });
  assert.equal(routed.receipt.backend.kind, "external");
  assert.deepEqual(routed.receipt.backend.findingChannels, ["check"]);

  const failed = await harness.run("finalize", request, {
    "INPUT_ADAPTER-ACKNOWLEDGMENT": JSON.stringify({
      schemaVersion: 1,
      logicalDispatchId: routed.receipt.logicalDispatchId,
      backendId: "internal-check-reviewer",
      status: "failed",
      errorCode: "adapter-timeout",
      acknowledgedAt: "2026-07-23T12:30:10Z",
      findingChannels: ["check"],
    }),
  });

  assert.equal(failed.state, "failed");
  assert.equal(failed.receipt.dispatch.status, "failed");
  assert.equal(failed.receipt.dispatch.phase, "acknowledged");
  assert.equal(harness.outputs.get("dispatch-allowed"), "false");
  assert.equal(harness.outputs.get("adapter-request"), "");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 0);
});

test("changed-head finalization requires reconciliation without updating the receipt", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const routed = await harness.run("route", request, {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });
  client.headSha = "9".repeat(40);

  const result = await harness.run("finalize", request, {
    "INPUT_ADAPTER-ACKNOWLEDGMENT": JSON.stringify({
      schemaVersion: 1,
      logicalDispatchId: routed.receipt.logicalDispatchId,
      backendId: "pr-agent",
      status: "acknowledged",
      acknowledgedAt: "2026-07-23T12:30:10Z",
      findingChannels: ["conversation-comment"],
    }),
  });

  assert.equal(result.state, "reconciliation-required");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(client.calls.filter(([name]) => name === "updateCheckRun").length, 0);
});

test("native Copilot dispatch is deduplicated and observed in the shared receipt", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  const result = await harness.run("route", request);

  assert.equal(result.state, "observed");
  assert.equal(result.receipt.backend.kind, "copilot");
  assert.equal(result.receipt.dispatch.phase, "observed");
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 1);

  const replay = await harness.run("route", request);
  assert.equal(replay.dispatchAllowed, false);
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 1);
});

// A-001: once Copilot has reviewed the head, an unauthorized same-head request
// stays suppressed, but a policy-authorized rerequest (next attempt) must issue
// a brand-new native review instead of being deduplicated away.
test("policy-authorized Copilot rerequest issues a new native review while replay stays suppressed", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  const first = await harness.run("route", request);
  assert.equal(first.receipt.backend.kind, "copilot");
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  const reviewer = first.receipt.backend.reviewAuthors[0];
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 1);

  // Copilot submits its review for this head: it leaves the requested set and
  // appears in the reviews list. A plain replay must now stay suppressed.
  client.requestedUsers = client.requestedUsers.filter((user) => user.login !== reviewer);
  client.reviews.push({ user: { login: reviewer }, commit_id: request.headSha, state: "APPROVED" });

  const replay = await harness.run("route", request);
  assert.equal(replay.dispatchAllowed, false);
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 1);

  const rerequest = {
    ...request,
    correlationId: "corr-copilot-rerequest",
    attempt: 2,
    rerequestOf: {
      priorReceiptId: first.receipt.receiptId,
      priorLogicalDispatchId: first.receipt.logicalDispatchId,
      priorAttempt: 1,
    },
  };

  await assert.rejects(
    harness.run("route", rerequest),
    /not authorized by repository policy/u,
  );
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 1);

  const second = await harness.run("route", rerequest, {
    "INPUT_REREQUEST-AUTHORIZED": "true",
  });
  assert.equal(second.state, "observed");
  assert.equal(second.receipt.attempt, 2);
  assert.notEqual(second.receipt.logicalDispatchId, first.receipt.logicalDispatchId);
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 2);
  // The forced path decides to re-request before any presence evidence is
  // read; head anchoring (issue #158) must not touch it.
  assert.equal(client.calls.filter(([name]) => name === "listIssueTimeline").length, 0);
  assert.equal(client.calls.filter(([name]) => name === "getCommit").length, 0);
});

// Issue #158, the PR #157 timeline. Copilot was requested at 00:41:21 for
// d594433; c5e94e0 was pushed at 00:43:06 with that request still pending. The
// run at c5e94e0 saw Copilot in requested_reviewers, issued no POST, and wrote
// a satisfied receipt -- for a review that Copilot then anchored to d594433.
// A request made before the head commit existed cannot have been for it.
test("a pending request made for an earlier head is re-requested at the new head", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  const reviewer = backendByName.get("native Copilot").reviewAuthors[0];
  client.requestedUsers = [{ login: reviewer }];
  client.timeline = [
    { event: "labeled", created_at: "2026-08-27T00:40:00Z" },
    {
      event: "review_requested",
      requested_reviewer: { login: reviewer },
      created_at: "2026-08-27T00:41:21Z",
    },
  ];
  client.commitDates.set(request.headSha, "2026-08-27T00:43:06Z");
  const harness = createHarness(client);

  const result = await harness.run("route", request);

  assert.equal(result.state, "observed");
  assert.equal(result.receipt.dispatch.status, "requested");
  assert.equal(result.receipt.dispatch.presenceAnchor, undefined);
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  assert.equal(harness.outputs.get("dispatch-anomaly"), "");
  // Removed then re-added, so GitHub notifies for this head.
  assert.deepEqual(
    client.calls.filter(([name]) => name === "removeRequestedReviewer" || name === "requestReviewer")
      .map(([name]) => name),
    ["removeRequestedReviewer", "requestReviewer"],
  );
});

test("a pending request made for the current head still satisfies presence without a POST", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  const reviewer = backendByName.get("native Copilot").reviewAuthors[0];
  client.requestedUsers = [{ login: reviewer.toUpperCase() }];
  client.commitDates.set(request.headSha, "2026-08-27T00:43:06Z");
  client.timeline = [
    // An older request for a previous head, then the current one.
    { event: "review_requested", requested_reviewer: { login: reviewer }, created_at: "2026-08-27T00:41:21Z" },
    { event: "review_requested", requested_reviewer: { login: reviewer }, created_at: "2026-08-27T00:43:30Z" },
  ];
  const harness = createHarness(client);

  const result = await harness.run("route", request);

  assert.equal(result.state, "observed");
  assert.equal(result.receipt.dispatch.status, "already-present");
  assert.equal(result.receipt.dispatch.presenceAnchor, "head");
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  assert.equal(harness.outputs.get("dispatch-anomaly"), "");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 0);
  assert.equal(client.calls.filter(([name]) => name === "removeRequestedReviewer").length, 0);
});

// The reviewer is proven present; which head is not. Re-requesting on every
// timeline read failure would buy a duplicate review per API blip, so the
// presence is kept -- and written down as unverified, in the receipt and as a
// warning annotation, so it cannot pass as a proven review of this head.
test("an unanchorable pending request is observed as present but surfaced as an anomaly", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  const reviewer = backendByName.get("native Copilot").reviewAuthors[0];
  client.requestedUsers = [{ login: reviewer }];
  client.timelineError = new Error("timeline unavailable");
  const harness = createHarness(client);

  const result = await harness.run("route", request);

  assert.equal(result.state, "observed");
  assert.equal(result.receipt.dispatch.status, "already-present");
  assert.equal(result.receipt.dispatch.presenceAnchor, "unverified");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 0);
  const anomaly = harness.outputs.get("dispatch-anomaly");
  assert.match(anomaly, /could not be anchored/u);
  assert.ok(anomaly.includes(reviewer));
  assert.ok(anomaly.includes(request.headSha));
  assert.ok(harness.logs.some((line) => line.startsWith("::warning::") && line.includes("could not be anchored")));

  // Durable: a later reader sees the anchor, not only this run's log.
  const queried = await harness.run("query", request);
  assert.equal(queried.receipt.dispatch.presenceAnchor, "unverified");
});

// Issue #154. GitHub answered the reviewer request with a 422: it parsed the
// request and refused it for this pull request. That is a different fact from
// a connection that dropped, and the receipt must say which -- both block the
// gate identically.
test("a backend that declines the pull request is recorded as declined, not failed", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const declinedClient = new FakeGitHubClient(request.headSha);
  declinedClient.requestError = Object.assign(
    new Error("GitHub API POST /repos/platypeeps/sd-github-review/pulls/42/requested_reviewers failed: Copilot cannot review this pull request"),
    { status: 422, apiMessage: "Copilot cannot review this pull request" },
  );
  const declined = createHarness(declinedClient);

  await assert.rejects(
    () => declined.run("route", request),
    /durable receipt that needs reconciliation/u,
  );
  assert.equal(declined.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(declined.outputs.get("dispatch-status"), "declined");
  assert.equal(declined.outputs.get("dispatch-allowed"), "false");
  assert.equal(declined.outputs.get("copilot-requested"), "false");
  assert.match(
    declined.outputs.get("reconciliation-error"),
    /declined by GitHub \(HTTP 422\): Copilot cannot review this pull request/u,
  );

  const declinedReceipt = (await declined.run("query", request)).receipt;
  assert.equal(declinedReceipt.dispatch.status, "declined");
  assert.equal(declinedReceipt.dispatch.phase, "started");
  assert.equal(declinedReceipt.dispatch.declineReason, "Copilot cannot review this pull request");

  // The same request through a transport failure: same gate, different receipt.
  const failedClient = new FakeGitHubClient(request.headSha);
  failedClient.requestError = new Error("connection closed after review request");
  const failed = createHarness(failedClient);
  await assert.rejects(() => failed.run("route", request), /needs reconciliation/u);
  assert.equal(failed.outputs.get("dispatch-status"), "failed");
  const failedReceipt = (await failed.run("query", request)).receipt;
  assert.equal(failedReceipt.dispatch.status, "failed");
  assert.equal(failedReceipt.dispatch.declineReason, undefined);
  assert.notEqual(declinedReceipt.dispatch.status, failedReceipt.dispatch.status);

  // A decline is terminal: the replay reads the settled receipt, authorizes no
  // dispatch, and issues no second POST.
  await assert.rejects(() => declined.run("route", request), /needs reconciliation/u);
  assert.equal(declined.outputs.get("dispatch-allowed"), "false");
  assert.equal(declined.outputs.get("dispatch-status"), "declined");
  assert.equal(declinedClient.calls.filter(([name]) => name === "requestReviewer").length, 1);
});

// A 4xx that is not 422 says nothing about the pull request -- a 403 is the
// token, a 404 the endpoint -- and stays a failure.
test("a non-422 API refusal stays a failed dispatch", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.requestError = Object.assign(new Error("GitHub API POST failed: Resource not accessible by integration"), {
    status: 403,
    apiMessage: "Resource not accessible by integration",
  });
  const harness = createHarness(client);

  await assert.rejects(() => harness.run("route", request), /needs reconciliation/u);
  assert.equal(harness.outputs.get("dispatch-status"), "failed");
  assert.match(harness.outputs.get("reconciliation-error"), /Resource not accessible/u);
});

test("ambiguous Copilot dispatch returns reconciliation state and never suggests fallback", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.requestError = new Error("connection closed after review request");
  const harness = createHarness(client);

  // The step fails rather than returning quietly: nobody will finalize this
  // receipt, so a green job here is a pull request that is never reviewed.
  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  // The outputs and summary are written before the failure, so the durable
  // state stays machine-readable on a red step instead of being lost with it.
  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("reconciliation-required"), "true");
  assert.equal(harness.outputs.get("dispatch-allowed"), "false");
  assert.equal(harness.outputs.get("receipt-verified"), "true");
  assert.equal(harness.outputs.get("dispatch-phase"), "started");
  assert.match(harness.outputs.get("reconciliation-error"), /connection closed/u);
  assert.equal(harness.outputs.get("adapter-request"), "");
});

test("a Copilot request that lands nobody never mints an observed receipt", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  // The exact PR #156 shape: the POST returns 2xx and the reviewer set is
  // unchanged afterwards. Nothing throws, so the old code took the success
  // path and wrote a satisfied receipt for a review that was never requested.
  client.landsRequest = false;
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  assert.notEqual(harness.outputs.get("durable-state"), "observed");
  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("reconciliation-required"), "true");
  assert.equal(harness.outputs.get("dispatch-allowed"), "false");
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  // "started", not "observed": the receipt was never advanced, so a later
  // attempt is not short-circuited by a satisfied phase.
  assert.equal(harness.outputs.get("dispatch-phase"), "started");
  assert.match(harness.outputs.get("reconciliation-error"), /absent/u);
  assert.equal(harness.outputs.get("adapter-request"), "");
});

test("an unreadable post-request probe reconciles as unknown, not as absent", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.probeError = new Error("reviewer listing unavailable");
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  // A failed probe and an observed-absent reviewer are both non-success, but
  // they are different facts and the receipt must not conflate them.
  const error = harness.outputs.get("reconciliation-error");
  assert.match(error, /could not verify/u);
  assert.doesNotMatch(error, /was absent/u);
});

// A receipt is durable evidence only if it was actually stored. #updateRecord
// answers `receiptVerified: false` when the check-run write fails, and forcing
// `true` over it published an unpersisted receipt as durable -- the same shape
// of false claim, one layer up, that this task exists to remove.
test("a failure whose own persist fails is not published as verified evidence", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.landsRequest = false;
  client.failPersistError = new Error("check run update rejected");
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  assert.equal(harness.outputs.get("receipt-verified"), "false");
  assert.equal(harness.outputs.get("receipt"), "");
  // Both failures are true and both are reported: the dispatch did not land,
  // and the record of that did not stick.
  const error = harness.outputs.get("reconciliation-error");
  assert.match(error, /was absent/u);
  assert.match(error, /check run update rejected/u);
  // The verdict still fails closed.
  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("dispatch-allowed"), "false");
});

// The failure has to outlive the run that observed it. Without the durable
// write the receipt keeps `status: "requested"` / `phase: "started"`, which
// receiptState reads as in-flight until strandedAfterMinutes (default 360)
// elapses -- so every retry for six hours would report a dead dispatch as one
// that might still be running. The store already treats `failed` at phase
// "started" as age-irrelevant reconciliation; this proves the writer reaches it.
test("a dispatch that did not land is recorded as failed, not left reading in-flight", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.landsRequest = false;
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  // The stored receipt, not the in-memory result: this is the part a later run
  // reads.
  const queried = await harness.run("query", request);
  assert.equal(queried.receipt.dispatch.status, "failed");
  assert.equal(queried.receipt.dispatch.phase, "started");
  // Age-irrelevant. The clock has not moved, so a receipt still reading
  // "requested" would classify as in-flight here.
  assert.equal(queried.state, "reconciliation-required");
  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("dispatch-allowed"), "false");
});

// `failed` is a statement about our evidence, not about GitHub: a throw may
// have followed an accepted POST. What must not happen is the receipt reading
// as satisfied on a dispatch nobody verified, so it fails closed to a human.
test("a throwing review request is recorded as failed too", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.requestError = new Error("connection closed after review request");
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  // Before the query run overwrites the outputs.
  assert.match(harness.outputs.get("reconciliation-error"), /connection closed/u);

  const queried = await harness.run("query", request);
  assert.equal(queried.receipt.dispatch.status, "failed");
  assert.equal(queried.state, "reconciliation-required");
});

// The dispatch and its observation are separate failure domains. Sharing one
// catch meant a landed request whose receipt advance failed got written as a
// failed dispatch -- recording a review that was requested as one that never
// was. Caught by Copilot reviewing PR #157.
test("a failed observation of a landed request is not recorded as a failed dispatch", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.observeError = new Error("check run listing unavailable");
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request),
    /durable receipt that needs reconciliation/u,
  );

  // Reconciliation, yes -- but the reviewer really was requested.
  assert.equal(harness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  assert.match(harness.outputs.get("reconciliation-error"), /check run listing unavailable/u);

  client.observeError = null;
  const queried = await harness.run("query", request);
  assert.notEqual(queried.receipt.dispatch.status, "failed");
  assert.equal(queried.receipt.dispatch.status, "requested");
});

test("none and query operations mirror durable receipt state without dispatch", async () => {
  const request = clone(requestByName.get("explicit none"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  const routed = await harness.run("route", request);
  assert.equal(routed.state, "skipped");
  assert.equal(routed.receipt.backend, null);
  assert.equal(harness.outputs.get("run-external-reviewer"), "false");

  const queried = await harness.run("query", request);
  assert.equal(queried.state, "skipped");
  assert.deepEqual(queried.receipt, routed.receipt);
  assert.equal(harness.outputs.get("receipt"), stableProtocolJson(routed.receipt));

  const missingRequest = { ...request, headSha: "1".repeat(40) };
  const missing = await harness.run("query", missingRequest);
  assert.equal(missing.state, "not-found");
  assert.equal(missing.receipt, null);
  assert.equal(harness.outputs.get("receipt"), "");
});

// Pins the src/operations.js:376 durable-path fallback. This is a distinct
// fallback site from the standalone path's, so a test on either alone leaves
// the other unpinned.
test("omitting high-risk-route routes durable sensitive paths to deep", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  client.fileNames = ["src/auth/session.js"];
  const harness = createHarness(client);

  const result = await harness.run("route", request, {
    "INPUT_SENSITIVE-PATHS": "**/auth/**",
    // Required because the route now resolves to deep: selectedBackend demands a
    // {route}-backend for every non-copilot route (src/operations.js:134), while
    // the copilot route synthesizes its own. This is the migration cost of the
    // default flip on the durable path.
    "INPUT_DEEP-BACKEND": JSON.stringify(backendByName.get("external check backend")),
  });

  assert.equal(result.receipt.selectedRoute, "deep");
});

test("automatic routing never mirrors sensitive paths into durable outputs", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  client.fileNames = ["src/auth/session.js"];
  const harness = createHarness(client);

  const result = await harness.run("route", request, {
    "INPUT_SENSITIVE-PATHS": "**/auth/**",
    "INPUT_HIGH-RISK-ROUTE": "copilot",
  });

  assert.equal(result.receipt.selectedRoute, "copilot");
  assert.equal(harness.outputs.get("sensitive-files"), "[]");
  assert.equal(harness.outputs.get("sensitive-file-count"), "1");
  assert.equal(harness.outputs.get("receipt").includes("src/auth/session.js"), false);
  assert.equal(JSON.stringify(harness.summaries).includes("src/auth/session.js"), false);
});

test("durable auto routing without sensitive paths skips file enumeration (A-014)", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  client.fileNames = ["src/auth/session.js"];
  const harness = createHarness(client);

  const result = await harness.run("route", request, {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });

  assert.equal(result.state, "started");
  assert.equal(client.calls.some(([name]) => name === "listPullRequestFiles"), false);
});

test("durable high-risk routing can dispatch the configured external deep backend", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  client.fileNames = ["src/auth/session.js"];
  const harness = createHarness(client);

  const result = await harness.run("route", request, {
    "INPUT_SENSITIVE-PATHS": "**/auth/**",
    "INPUT_HIGH-RISK-ROUTE": "deep",
    "INPUT_DEEP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });

  assert.equal(result.state, "started");
  assert.equal(result.receipt.selectedRoute, "deep");
  assert.match(result.receipt.reason, /review floor required deep/u);
  assert.equal(result.receipt.backend.kind, "external");
  assert.equal(result.receipt.backend.id, "pr-agent");
  assert.equal(harness.outputs.get("run-external-reviewer"), "true");
  assert.notEqual(harness.outputs.get("adapter-request"), "");
  assert.equal(harness.outputs.get("sensitive-files"), "[]");
  assert.equal(harness.outputs.get("sensitive-file-count"), "1");
  assert.equal(client.calls.filter(([name]) => name === "requestReviewer").length, 0);
});

test("durable operations accept only credential-free HTTPS workflow URLs", async () => {
  const request = clone(requestByName.get("explicit none"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  for (const value of [
    "not-a-url",
    "http://github.example/actions/runs/1",
    "https://user:secret@github.example/actions/runs/1",
  ]) {
    await assert.rejects(
      harness.run("route", request, { "INPUT_WORKFLOW-URL": value }),
      /workflow-url must/u,
    );
  }
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 0);

  const externalRequest = clone(requestByName.get("explicit cheap"));
  client.headSha = externalRequest.headSha;
  const routed = await harness.run("route", externalRequest, {
    "INPUT_WORKFLOW-URL": "https://github.example/actions/runs/1",
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });
  assert.equal(
    routed.receipt.dispatch.workflowUrl,
    "https://github.example/actions/runs/1",
  );
});

test("trusted bookkeeping-only successor creates a distinct current-head none receipt", async () => {
  const priorRequest = clone(requestByName.get("explicit none"));
  const client = new FakeGitHubClient(priorRequest.headSha);
  const harness = createHarness(client);
  const prior = await harness.run("route", priorRequest);
  const currentHeadSha = "f".repeat(40);
  const successorRequest = {
    schemaVersion: 1,
    correlationId: "corr-successor-live",
    attempt: 1,
    repository: clone(priorRequest.repository),
    pullRequestNumber: priorRequest.pullRequestNumber,
    headSha: currentHeadSha,
    route: "auto",
    policyVersion: priorRequest.policyVersion,
    supersedes: {
      priorReceiptId: prior.receipt.receiptId,
      priorLogicalDispatchId: prior.receipt.logicalDispatchId,
      priorHeadSha: priorRequest.headSha,
      correlationId: priorRequest.correlationId,
    },
  };
  client.headSha = currentHeadSha;
  client.fileNames = [".trellis/tasks/example/task.json"];
  client.comparison = {
    status: "ahead",
    aheadBy: 1,
    behindBy: 0,
    totalCommits: 1,
    mergeBaseSha: priorRequest.headSha,
    files: [{
      filename: ".trellis/tasks/example/task.json",
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
    }],
    truncated: false,
    incomplete: false,
    inconsistent: false,
  };

  const result = await harness.run("route", successorRequest, {
    "INPUT_ALLOW-BOOKKEEPING-NONE": "true",
  });

  assert.equal(result.receipt.selectedRoute, "none");
  assert.equal(result.receipt.headSha, currentHeadSha);
  assert.equal(result.receipt.successorEvidence.comparison, "bookkeeping-only");
  assert.notEqual(result.receipt.logicalDispatchId, prior.receipt.logicalDispatchId);
  assert.equal(harness.outputs.get("receipt").includes(".trellis/"), false);
});

test("durable operations reject stale, malformed, and ambiguous inputs without dispatch", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const staleClient = new FakeGitHubClient("9".repeat(40));
  const staleHarness = createHarness(staleClient);
  await assert.rejects(
    staleHarness.run("route", request, {
      "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    }),
    /live pull request head must match/u,
  );
  assert.equal(staleClient.calls.some(([name]) => name === "createCheckRun"), false);

  const ambiguousClient = new FakeGitHubClient(request.headSha);
  ambiguousClient.createError = new Error("connection closed after request body");
  const ambiguousHarness = createHarness(ambiguousClient);
  // The create may or may not have landed, so nothing can be concluded about
  // this head without a human. Failing is the point: an unverified receipt that
  // reported success would be a pull request nobody reviews and nobody notices.
  await assert.rejects(
    () => ambiguousHarness.run("route", request, {
      "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    }),
    /durable receipt that needs reconciliation/u,
  );
  assert.equal(ambiguousHarness.outputs.get("durable-state"), "reconciliation-required");
  assert.equal(ambiguousHarness.outputs.get("dispatch-allowed"), "false");
  assert.equal(ambiguousHarness.outputs.get("adapter-request"), "");
  assert.equal(ambiguousHarness.outputs.get("receipt"), "");
  assert.equal(ambiguousHarness.outputs.get("receipt-verified"), "false");
  assert.ok(ambiguousHarness.outputs.get("logical-dispatch-id"));

  await assert.rejects(
    runAction({
      event: {},
      eventName: "workflow_dispatch",
      env: {
        GITHUB_REPOSITORY: "platypeeps/sd-github-review",
        "INPUT_GITHUB-TOKEN": "test-token",
        INPUT_OPERATION: "route",
        "INPUT_REVIEW-REQUEST": "{bad",
      },
      clientFactory: () => ambiguousClient,
      outputWriter() {},
      summaryWriter() {},
    }),
    /review-request must contain valid JSON/u,
  );
});

test("durable Markdown summaries expose bounded state but never sensitive paths", async () => {
  const writes = [];
  await writeDurableSummary(
    {
      operation: "route",
      state: "observed",
      receipt: {
        pullRequestNumber: 42,
        headSha: "a".repeat(40),
        selectedRoute: "copilot",
        reason: "sensitive policy floor",
        dispatch: { status: "requested", phase: "observed" },
        backend: {
          label: "GitHub Copilot",
          findingChannels: ["review", "inline-comment"],
          limitations: ["GitHub-managed model selection"],
        },
      },
      dispatchAllowed: false,
      reconciliationRequired: false,
      changedLines: 42,
      sensitiveCount: 1,
    },
    {
      env: { GITHUB_STEP_SUMMARY: "/tmp/summary" },
      appendFileImpl: async (filePath, value) => writes.push({ filePath, value }),
    },
  );

  assert.equal(writes.length, 1);
  assert.match(writes[0].value, /Dispatch: `requested\/observed`/u);
  assert.match(writes[0].value, /Sensitive file count: 1/u);
  assert.equal(writes[0].value.includes("src/auth/session.js"), false);
});

// The route-policy unit tests call selectProtocolRoute directly, which bypasses
// the contract -> action.yml -> operations.js input plumbing entirely. A typo in
// the input name would leave every one of them green while the installed lane
// enforced nothing. This drives the real INPUT_ env var the runner sets.
test("route policy reaches the router through the action's own input plumbing", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  await assert.rejects(
    () => harness.run("route", request, { "INPUT_ROUTE-POLICY": "copilot" }),
    /route "cheap" is not permitted by this repository's review policy/u,
  );
});

test("an unset route-policy input leaves the durable lane unconstrained", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  const routed = await harness.run("route", request, {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    "INPUT_ROUTE-POLICY": "",
  });
  assert.equal(routed.state, "started");
});

// Measured before the fix: a bare attempt bump reached dispatchAllowed=true with
// two check runs on one head, skipping the entire rerequest authorization chain.
// Driven through the action's real entry point rather than the decoder alone,
// because the bypass was only reachable end to end.
test("a bare attempt bump is refused end to end", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  };

  const first = await harness.run("route", request, env);
  assert.equal(first.state, "started");

  const bumped = { ...clone(request), correlationId: "corr-bare-bump", attempt: 2 };
  await assert.rejects(
    () => harness.run("route", bumped, env),
    /remote dispatch counter for this head and must be 1 on the first dispatch/u,
  );

  assert.equal(
    client.calls.filter(([name]) => name === "createCheckRun").length,
    1,
    "the refused bump must not mint a second durable check run",
  );
});

// The draft wedge. `draft` is read from live GitHub state (operations.js:377)
// into routingContext, never into the request, so fingerprintFields cannot see
// it and logicalDispatchId does not move when a pull request leaves draft. The
// first review on a draft records route "none" / "draft pull requests are
// disabled"; the second finds that receipt at the same exact head, agrees on
// the fingerprint, and returns the stale skip with dispatchAllowed false. The
// durable lane is workflow_dispatch-only, so both dispatches are a human
// deliberately asking for a review -- and the second one silently gets none.
test("a review requested after a pull request leaves draft is not answered with the draft skip", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);

  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    "INPUT_DEEP-BACKEND": JSON.stringify(backendByName.get("external check backend")),
  };

  client.draft = true;
  const skipped = await harness.run("route", request, env);
  assert.equal(skipped.receipt.selectedRoute, "none", "a draft is not reviewed");

  // Marking a pull request ready for review does not change its head SHA.
  client.draft = false;
  const readied = await harness.run("route", { ...clone(request), correlationId: "corr-readied" }, env);

  assert.notEqual(
    readied.receipt.selectedRoute,
    "none",
    "the pull request is no longer a draft, so the review must actually happen",
  );
  assert.equal(readied.dispatchAllowed, true, "the readied review must be allowed to dispatch");
});

// The other half of the skip-supersede rule. Replacing a skip is safe only
// because a skip represents no dispatched work; it must not cost idempotency
// for the case the receipt exists to serve. A recorded none re-dispatched under
// unchanged conditions is still the same non-decision, so it returns the
// existing receipt, mints no second check run, and authorizes nothing.
test("a recorded skip re-dispatched under unchanged conditions stays idempotent", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    "INPUT_DEEP-BACKEND": JSON.stringify(backendByName.get("external check backend")),
  };

  client.draft = true;
  const first = await harness.run("route", request, env);
  assert.equal(first.receipt.selectedRoute, "none");

  // A later clock is what makes "preserved" distinguishable from "rewritten
  // with the same content". Without it this test passes whether or not the
  // supersede rule is narrowed to skip-becomes-not-skip, and so guards nothing.
  harness.clock.now = "2026-07-23T18:45:00Z";
  const again = await harness.run("route", { ...clone(request), correlationId: "corr-again" }, env);
  assert.equal(again.receipt.selectedRoute, "none", "still a draft, still not reviewed");
  assert.equal(again.dispatchAllowed, false, "an unchanged skip authorizes no dispatch");
  assert.equal(
    client.calls.filter(([name]) => name === "createCheckRun").length,
    1,
    "the repeated skip must not mint a second durable check run",
  );
  assert.equal(
    again.receipt.dispatch.completedAt,
    first.receipt.dispatch.completedAt,
    "the original skip's durable record must be preserved, not rewritten at the new clock",
  );
});

// The gate lives in the action, not the lane: the canonical durable workflow
// (examples/on-demand-review-router.yml) may contain no `run:` step at all
// because it holds checks:write, so it has nowhere to put a shell gate -- and a
// YAML gate is one a consumer can quietly drop while believing it still runs.
test("a stranded receipt fails the route step instead of reporting a green job", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  };

  const started = await harness.run("route", request, env);
  assert.equal(started.dispatchAllowed, true);

  // Inside the window the dispatch could still be running, so a replay stays
  // green and simply declines to dispatch again.
  harness.clock.now = "2026-07-23T18:00:00Z";
  const inFlight = await harness.run("route", { ...clone(request), correlationId: "corr-b" }, env);
  assert.equal(inFlight.state, "in-flight");
  assert.equal(inFlight.dispatchAllowed, false);

  // Past GitHub's job ceiling nothing can still finalize it, so the step fails.
  harness.clock.now = "2026-07-24T12:30:10Z";
  await assert.rejects(
    () => harness.run("route", { ...clone(request), correlationId: "corr-c" }, env),
    /durable receipt that needs reconciliation/u,
  );
});

test("fail-on-reconciliation false reports a stranded receipt without failing", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient(request.headSha);
  const harness = createHarness(client);
  const env = {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
    "INPUT_FAIL-ON-RECONCILIATION": "false",
  };

  await harness.run("route", request, env);
  harness.clock.now = "2026-07-24T12:30:10Z";
  const opted = await harness.run("route", { ...clone(request), correlationId: "corr-opt" }, env);

  assert.equal(opted.state, "reconciliation-required");
  assert.equal(harness.outputs.get("reconciliation-required"), "true");
});
