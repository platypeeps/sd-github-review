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
    this.comparison = null;
  }

  async getPullRequest(number) {
    this.calls.push(["getPullRequest", number]);
    return {
      number,
      additions: 40,
      deletions: 2,
      draft: false,
      head: { sha: this.headSha },
    };
  }

  async listPullRequestFiles(number) {
    this.calls.push(["listPullRequestFiles", number]);
    return clone(this.fileNames);
  }

  async listCheckRuns(head, name) {
    this.calls.push(["listCheckRuns", head, name]);
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
    return { users: clone(this.requestedUsers), teams: [] };
  }

  async listPullRequestReviews(number) {
    this.calls.push(["listPullRequestReviews", number]);
    return clone(this.reviews);
  }

  async requestReviewer(number, reviewer) {
    this.calls.push(["requestReviewer", number, reviewer]);
    if (this.requestError) throw this.requestError;
    this.requestedUsers.push({ login: reviewer });
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
      now: () => "2026-07-23T12:30:10Z",
    });
  };
  return { outputs, summaries, logs, run };
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
  assert.equal(replay.reconciliationRequired, true);
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

test("ambiguous Copilot dispatch returns reconciliation state and never suggests fallback", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient(request.headSha);
  client.requestError = new Error("connection closed after review request");
  const harness = createHarness(client);

  const result = await harness.run("route", request);

  assert.equal(result.state, "reconciliation-required");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(harness.outputs.get("receipt-verified"), "true");
  assert.equal(harness.outputs.get("dispatch-phase"), "started");
  assert.match(harness.outputs.get("reconciliation-error"), /connection closed/u);
  assert.equal(harness.outputs.get("adapter-request"), "");
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

test("automatic routing never mirrors sensitive paths into durable outputs", async () => {
  const request = clone(requestByName.get("automatic with exact-head local evidence"));
  const client = new FakeGitHubClient(request.headSha);
  client.fileNames = ["src/auth/session.js"];
  const harness = createHarness(client);

  const result = await harness.run("route", request, {
    "INPUT_SENSITIVE-PATHS": "**/auth/**",
  });

  assert.equal(result.receipt.selectedRoute, "copilot");
  assert.equal(harness.outputs.get("sensitive-files"), "[]");
  assert.equal(harness.outputs.get("sensitive-file-count"), "1");
  assert.equal(harness.outputs.get("receipt").includes("src/auth/session.js"), false);
  assert.equal(JSON.stringify(harness.summaries).includes("src/auth/session.js"), false);
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
  const ambiguous = await ambiguousHarness.run("route", request, {
    "INPUT_CHEAP-BACKEND": JSON.stringify(backendByName.get("external comment backend")),
  });
  assert.equal(ambiguous.state, "reconciliation-required");
  assert.equal(ambiguous.dispatchAllowed, false);
  assert.equal(ambiguousHarness.outputs.get("adapter-request"), "");
  assert.equal(ambiguousHarness.outputs.get("receipt"), "");
  assert.equal(ambiguousHarness.outputs.get("receipt-verified"), "false");
  assert.equal(
    ambiguousHarness.outputs.get("logical-dispatch-id"),
    ambiguous.receipt.logicalDispatchId,
  );

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
