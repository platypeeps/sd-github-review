import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decodeReceipt,
  decodeReviewRequest,
  stableProtocolJson,
} from "../src/protocol.js";
import {
  decodeReceiptCheckRun,
  encodeReceiptCheckText,
  normalizeSuccessorComparison,
  RECEIPT_CHECK_NAME,
  RECEIPT_MARKER,
  ReceiptStore,
} from "../src/receipt.js";

async function fixture(name) {
  const url = new URL(`../fixtures/protocol/v1/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const requests = await fixture("requests.valid.json");
const receipts = await fixture("receipts.valid.json");
const supporting = await fixture("supporting.valid.json");
const requestByName = new Map(requests.map((entry) => [entry.name, entry.value]));
const receiptByName = new Map(receipts.map((entry) => [entry.name, entry.value]));
const backendByName = new Map(supporting.backends.map((entry) => [entry.name, entry.value]));

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
  constructor({ headSha = "b".repeat(40), comparison } = {}) {
    this.owner = "platypeeps";
    this.repo = "sd-github-review";
    this.headSha = headSha;
    this.comparison = comparison;
    this.checks = new Map();
    this.nextId = 100;
    this.calls = [];
    this.createError = null;
    this.updateError = null;
    this.beforeCreate = null;
    this.onCreate = null;
    this.onUpdate = null;
    this.onCompare = null;
  }

  async getPullRequest(number) {
    this.calls.push(["getPullRequest", number]);
    return { number, head: { sha: this.headSha }, base: { sha: "0".repeat(40) } };
  }

  async listCheckRuns(head, name) {
    this.calls.push(["listCheckRuns", head, name]);
    return clone(this.checks.get(head) ?? []);
  }

  async createCheckRun(payload) {
    if (this.beforeCreate) await this.beforeCreate();
    this.calls.push(["createCheckRun", clone(payload)]);
    if (this.createError) throw this.createError;
    const check = checkFromPayload(this.nextId, payload);
    this.nextId += 1;
    this.checks.set(payload.head_sha, [...(this.checks.get(payload.head_sha) ?? []), check]);
    if (this.onCreate) this.onCreate();
    return clone(check);
  }

  async updateCheckRun(id, payload) {
    this.calls.push(["updateCheckRun", id, clone(payload)]);
    if (this.updateError) throw this.updateError;
    for (const [head, checks] of this.checks.entries()) {
      const index = checks.findIndex((check) => check.id === id);
      if (index === -1) continue;
      checks[index] = {
        ...checks[index],
        ...clone(payload),
        head_sha: head,
        name: checks[index].name,
      };
      if (this.onUpdate) this.onUpdate();
      return clone(checks[index]);
    }
    throw new Error("missing fake check");
  }

  async compareCommits(base, head) {
    this.calls.push(["compareCommits", base, head]);
    const result = clone(this.comparison);
    if (this.onCompare) this.onCompare();
    return result;
  }
}

function makeStore(client, options = {}) {
  return new ReceiptStore({
    client,
    now: () => "2026-07-23T12:30:00Z",
    bookkeepingPatterns: [".trellis/**", ".obsidian-kb/**"],
    ...options,
  });
}

function cheapBeginOptions(overrides = {}) {
  return {
    decision: { route: "cheap", reason: "explicit cheap route selected" },
    backend: clone(backendByName.get("external comment backend")),
    ...overrides,
  };
}

test("encodes and decodes one canonical bounded receipt marker", () => {
  const receipt = decodeReceipt(receiptByName.get("external comment receipt"));
  const text = encodeReceiptCheckText(receipt);
  const check = {
    id: 7,
    name: RECEIPT_CHECK_NAME,
    head_sha: receipt.headSha,
    external_id: receipt.logicalDispatchId,
    output: { text },
  };

  assert.equal(text, `${RECEIPT_MARKER}${stableProtocolJson(receipt)}`);
  assert.deepEqual(decodeReceiptCheckRun(check).receipt, receipt);
  assert.throws(() => decodeReceiptCheckRun({ ...check, id: false }), /positive integer/u);

  const noncanonical = { ...check, output: { text: `${RECEIPT_MARKER}${JSON.stringify(receipt, null, 2)}` } };
  assert.throws(() => decodeReceiptCheckRun(noncanonical), /canonical receipt JSON/u);
  assert.throws(
    () => decodeReceiptCheckRun({ ...check, output: { text: `${RECEIPT_MARKER}{` } }),
    /valid JSON/u,
  );
});

test("creates an exact-head receipt and queries the mirrored canonical envelope", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);

  assert.equal(await store.query({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: decodeReviewRequest(request).logicalDispatchId,
  }), null);

  const result = await store.begin(request, cheapBeginOptions());

  assert.equal(result.state, "started");
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.reconciliationRequired, false);
  assert.equal(result.receipt.headSha, request.headSha);
  assert.equal(result.receipt.dispatch.phase, "started");
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);
  const createPayload = client.calls.find(([name]) => name === "createCheckRun")[1];
  assert.equal(createPayload.name, RECEIPT_CHECK_NAME);
  assert.equal(createPayload.head_sha, request.headSha);
  assert.equal(createPayload.external_id, result.receipt.logicalDispatchId);
  assert.equal(createPayload.started_at, "2026-07-23T12:30:00Z");
  assert.equal(createPayload.output.text, encodeReceiptCheckText(result.receipt));

  const queried = await store.query({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    correlationId: request.correlationId,
  });
  assert.deepEqual(queried, result.receipt);
});

test("matching retries append aliases without authorizing a second dispatch", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const first = await store.begin(request, cheapBeginOptions());
  const retry = { ...clone(request), correlationId: "corr-cheap-retry" };

  const second = await store.begin(retry, cheapBeginOptions());

  // The first dispatch is still running, so this retry is a healthy replay, not
  // a case for a human. It reported reconciliation-required until the state was
  // split by age -- which is why no lane could gate on that flag.
  assert.equal(second.state, "in-flight");
  assert.equal(second.dispatchAllowed, false);
  assert.equal(second.reconciliationRequired, false);
  assert.deepEqual(second.receipt.correlationIds, ["corr-cheap", "corr-cheap-retry"]);
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);
  assert.equal(client.calls.filter(([name]) => name === "updateCheckRun").length, 1);
  assert.equal(second.receipt.logicalDispatchId, first.receipt.logicalDispatchId);
});

test("conflicting fingerprints and malformed checks fail closed; duplicates elect the authoritative receipt", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const first = await store.begin(request, cheapBeginOptions());

  await assert.rejects(
    store.begin(
      { ...clone(request), route: "deep" },
      {
        decision: { route: "deep", reason: "explicit deep route selected" },
        backend: clone(backendByName.get("external check backend")),
      },
    ),
    /conflicts with the canonical request fingerprint/u,
  );

  // A duplicate durable receipt for one identity no longer wedges reads: query
  // elects the authoritative (lowest-id) receipt instead of throwing (A-003).
  const checks = client.checks.get(request.headSha);
  checks.push({ ...clone(checks[0]), id: 999 });
  assert.deepEqual(
    await store.query({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: first.receipt.logicalDispatchId,
    }),
    first.receipt,
  );

  checks.splice(1, 1);
  checks[0].output.text = `${RECEIPT_MARKER}{`;
  await assert.rejects(
    store.query({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: first.receipt.logicalDispatchId,
    }),
    /valid JSON/u,
  );
});

test("changed heads and ambiguous create failures never authorize dispatch", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const staleClient = new FakeGitHubClient({ headSha: "9".repeat(40) });
  await assert.rejects(
    makeStore(staleClient).begin(request, cheapBeginOptions()),
    /live pull request head must match/u,
  );
  assert.equal(staleClient.calls.some(([name]) => name === "createCheckRun"), false);

  const ambiguousClient = new FakeGitHubClient({ headSha: request.headSha });
  ambiguousClient.createError = new Error("connection closed after request body");
  const result = await makeStore(ambiguousClient).begin(request, cheapBeginOptions());
  assert.equal(result.state, "reconciliation-required");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.reconciliationRequired, true);
  assert.match(result.error, /connection closed/u);

  const racingClient = new FakeGitHubClient({ headSha: request.headSha });
  racingClient.onCreate = () => {
    racingClient.headSha = "8".repeat(40);
  };
  const raced = await makeStore(racingClient).begin(request, cheapBeginOptions());
  assert.equal(raced.state, "reconciliation-required");
  assert.equal(raced.dispatchAllowed, false);
  assert.match(raced.error, /live pull request head must match/u);

  const missingClient = new FakeGitHubClient({ headSha: request.headSha });
  missingClient.onCreate = () => {
    missingClient.checks.delete(request.headSha);
  };
  const missing = await makeStore(missingClient).begin(request, cheapBeginOptions());
  assert.equal(missing.state, "reconciliation-required");
  assert.equal(missing.dispatchAllowed, false);
  assert.equal(missing.reconciliationRequired, true);
  assert.match(missing.error, /not observable after mutation/u);
});

test("concurrent begins elect exactly one authoritative dispatch", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);

  // Barrier: hold both begins at their durable create until both have passed the
  // pre-create absence check, forcing a genuine two-create race for one identity
  // against a single shared Check Run store.
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  client.beforeCreate = async () => {
    arrived += 1;
    if (arrived >= 2) release();
    await gate;
  };

  const [a, b] = await Promise.all([
    store.begin(clone(request), cheapBeginOptions()),
    store.begin(clone(request), cheapBeginOptions()),
  ]);

  // Both durably created a Check Run, but exactly one is authorized to dispatch;
  // the other is recoverable and nothing is deleted.
  assert.equal(client.checks.get(request.headSha).length, 2);
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 2);
  const dispatched = [a, b].filter((result) => result.dispatchAllowed);
  const deferred = [a, b].filter((result) => !result.dispatchAllowed);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].state, "started");
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].state, "reconciliation-required");
  assert.equal(deferred[0].reconciliationRequired, true);
  assert.equal(
    deferred[0].reconciliation.authoritativeCheckId,
    Math.min(...client.checks.get(request.headSha).map((check) => check.id)),
  );
});

test("a superseded durable create defers with bounded reconciliation evidence and deletes nothing", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  // A concurrent begin durably lands a lower-id Check Run first, so this caller
  // (the higher id) must defer rather than authorize a second dispatch.
  client.onCreate = () => {
    client.onCreate = null;
    const headChecks = client.checks.get(request.headSha);
    headChecks.unshift({ ...clone(headChecks[0]), id: 50 });
  };

  const loser = await makeStore(client).begin(request, cheapBeginOptions());

  assert.equal(loser.state, "reconciliation-required");
  assert.equal(loser.dispatchAllowed, false);
  assert.equal(loser.reconciliationRequired, true);
  assert.equal(loser.receiptVerified, true);
  assert.equal(loser.reconciliation.authoritativeCheckId, 50);
  assert.equal(loser.reconciliation.supersededCheckId, 100);
  assert.equal(loser.reconciliation.duplicateCount, 1);
  assert.deepEqual(loser.reconciliation.duplicateCheckIds, [100]);
  assert.equal(client.checks.get(request.headSha).length, 2);
});

test("an unusable create response id keeps the verified authoritative receipt for reconciliation", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const create = client.createCheckRun.bind(client);
  client.createCheckRun = async (payload) => {
    const check = await create(payload);
    return { ...check, id: null };
  };

  const result = await makeStore(client).begin(request, cheapBeginOptions());

  assert.equal(result.state, "reconciliation-required");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.receiptVerified, true);
  assert.equal(result.receipt.logicalDispatchId, decodeReviewRequest(request).logicalDispatchId);
  assert.match(result.error, /created receipt identity is ambiguous/u);
});

test("a duplicate receipt never authorizes a second dispatch and finalize resolves the elected receipt", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, cheapBeginOptions());
  assert.equal(started.dispatchAllowed, true);

  // A duplicate durable receipt for the same identity lands afterwards.
  const checks = client.checks.get(request.headSha);
  checks.push({ ...clone(checks[0]), id: 777 });

  // A retry that reaches begin with the duplicate present never authorizes a
  // second dispatch: the identity already resolves to the elected receipt.
  const second = await store.begin(request, cheapBeginOptions());
  assert.equal(second.dispatchAllowed, false);
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);

  // query and the acknowledge/observe finalize path resolve the elected
  // (lowest-id) receipt rather than wedging, and leave the duplicate intact.
  assert.deepEqual(
    await store.query({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: started.receipt.logicalDispatchId,
    }),
    started.receipt,
  );
  await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment: {
      schemaVersion: 1,
      logicalDispatchId: started.receipt.logicalDispatchId,
      backendId: "pr-agent",
      status: "acknowledged",
      acknowledgedAt: "2026-07-23T12:30:10Z",
      findingChannels: ["conversation-comment"],
    },
  });
  const observed = await store.observe({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    completedAt: "2026-07-23T12:30:20Z",
  });
  assert.equal(observed.state, "observed");
  assert.ok(client.checks.get(request.headSha).some((check) => check.id === 777));
});

// dispatchFailed writes phase "started". Without the guard it would force an
// acknowledged or observed receipt back to "started", rewriting history rather
// than recording an outcome.
test("dispatchFailed records only a live dispatch, never a settled one", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, cheapBeginOptions());

  await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment: {
      schemaVersion: 1,
      logicalDispatchId: started.receipt.logicalDispatchId,
      backendId: "pr-agent",
      status: "acknowledged",
      acknowledgedAt: "2026-07-23T12:30:10Z",
      findingChannels: ["conversation-comment"],
    },
  });

  await assert.rejects(
    store.dispatchFailed({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: started.receipt.logicalDispatchId,
      completedAt: "2026-07-23T12:30:20Z",
    }),
    /only a started dispatch can be recorded as failed/u,
  );
});

// Issue #154. dispatchDeclined shares dispatchFailed's guards and its gate;
// what it adds is the backend's reason, and what it must never do is let a
// later generic failure overwrite that reason.
test("dispatchDeclined records the backend's refusal and blocks the gate like a failure", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, {
    decision: { route: "copilot", reason: "explicit copilot route selected" },
    backend: clone(backendByName.get("native Copilot")),
  });
  const identity = {
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
  };

  await assert.rejects(
    store.dispatchDeclined({ ...identity, completedAt: "2026-07-23T12:30:05Z" }),
    /must carry the backend's reason/u,
  );

  const declined = await store.dispatchDeclined({
    ...identity,
    completedAt: "2026-07-23T12:30:05Z",
    reason: "Review cannot be requested from pull request author",
  });
  assert.equal(declined.receipt.dispatch.status, "declined");
  assert.equal(declined.receipt.dispatch.phase, "started");
  assert.equal(
    declined.receipt.dispatch.declineReason,
    "Review cannot be requested from pull request author",
  );
  assert.equal(declined.reconciliationRequired, true);
  assert.equal(declined.dispatchAllowed, false);

  // Age-irrelevant, exactly like failed: a fresh begin at the same clock reads
  // it as needing a human and authorizes nothing.
  const seen = await store.begin(
    { ...clone(request), correlationId: "corr-after-decline" },
    {
      decision: { route: "copilot", reason: "explicit copilot route selected" },
      backend: clone(backendByName.get("native Copilot")),
    },
  );
  assert.equal(seen.state, "reconciliation-required");
  assert.equal(seen.dispatchAllowed, false);

  // Settled: a later failure report neither rewrites it nor erases the reason.
  const failedAfter = await store.dispatchFailed({ ...identity, completedAt: "2026-07-23T12:31:00Z" });
  assert.equal(failedAfter.receipt.dispatch.status, "declined");
  assert.equal(failedAfter.receipt.dispatch.completedAt, "2026-07-23T12:30:05Z");
  assert.equal(failedAfter.state, "reconciliation-required");

  await assert.rejects(
    store.observe({ ...identity, completedAt: "2026-07-23T12:32:00Z" }),
    /declined, or skipped receipts cannot transition to observed/u,
  );
  const check = [...client.checks.values()].flat().find((entry) => entry.conclusion);
  assert.equal(check.conclusion, "failure");
});

test("acknowledgment and observation advance phases monotonically", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, cheapBeginOptions());

  await assert.rejects(
    store.observe({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: started.receipt.logicalDispatchId,
      completedAt: "2026-07-23T12:30:05Z",
    }),
    /require acknowledgment before observation/u,
  );

  const acknowledged = await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment: {
      schemaVersion: 1,
      logicalDispatchId: started.receipt.logicalDispatchId,
      backendId: "pr-agent",
      status: "acknowledged",
      acknowledgedAt: "2026-07-23T12:30:10Z",
      findingChannels: ["conversation-comment"],
    },
  });
  assert.equal(acknowledged.state, "acknowledged");
  assert.equal(acknowledged.receipt.dispatch.phase, "acknowledged");

  const observed = await store.observe({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    observations: { latencyMs: 20_000, costTier: "low" },
    completedAt: "2026-07-23T12:30:20Z",
  });
  assert.equal(observed.state, "observed");
  assert.equal(observed.receipt.dispatch.phase, "observed");
  assert.deepEqual(observed.receipt.observations, { latencyMs: 20_000, costTier: "low" });
  const storedCheck = client.checks.get(request.headSha)[0];
  assert.equal(storedCheck.status, "completed");
  assert.equal(storedCheck.conclusion, "success");

  const replayed = await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment: {
      schemaVersion: 1,
      logicalDispatchId: started.receipt.logicalDispatchId,
      backendId: "pr-agent",
      status: "acknowledged",
      acknowledgedAt: "2026-07-23T12:30:30Z",
      findingChannels: ["conversation-comment"],
    },
  });
  assert.equal(replayed.state, "observed");
  assert.equal(replayed.receipt.dispatch.phase, "observed");

  await assert.rejects(
    store.acknowledge({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: started.receipt.logicalDispatchId,
      acknowledgment: {
        schemaVersion: 1,
        logicalDispatchId: started.receipt.logicalDispatchId,
        backendId: "pr-agent",
        status: "failed",
        errorCode: "late-failure",
        acknowledgedAt: "2026-07-23T12:30:31Z",
        findingChannels: ["conversation-comment"],
      },
    }),
    /cannot follow an observed receipt/u,
  );
});

test("contradictory acknowledgments fail and ambiguous updates require reconciliation", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, cheapBeginOptions());
  const acknowledgment = {
    schemaVersion: 1,
    logicalDispatchId: started.receipt.logicalDispatchId,
    backendId: "pr-agent",
    status: "acknowledged",
    acknowledgedAt: "2026-07-23T12:30:10Z",
    findingChannels: ["conversation-comment"],
  };

  await assert.rejects(
    store.acknowledge({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: started.receipt.logicalDispatchId,
      acknowledgment: { ...acknowledgment, findingChannels: ["check"] },
    }),
    /findingChannels must match/u,
  );

  client.updateError = new Error("connection closed after update body");
  const ambiguous = await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment,
  });
  assert.equal(ambiguous.state, "reconciliation-required");
  assert.equal(ambiguous.dispatchAllowed, false);
  assert.equal(ambiguous.reconciliationRequired, true);
  assert.match(ambiguous.error, /connection closed after update/u);

  client.updateError = null;
  client.onUpdate = () => {
    client.checks.delete(request.headSha);
  };
  const missing = await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    acknowledgment,
  });
  assert.equal(missing.state, "reconciliation-required");
  assert.equal(missing.dispatchAllowed, false);
  assert.equal(missing.reconciliationRequired, true);
  assert.match(missing.error, /not observable after mutation/u);
});

test("native Copilot receipts can advance directly from started to observed", async () => {
  const request = clone(requestByName.get("explicit copilot"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const started = await store.begin(request, {
    decision: { route: "copilot", reason: "explicit copilot route selected" },
    backend: clone(backendByName.get("native Copilot")),
  });

  const observed = await store.observe({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: started.receipt.logicalDispatchId,
    completedAt: "2026-07-23T12:30:20Z",
  });

  assert.equal(observed.state, "observed");
  assert.equal(observed.receipt.dispatch.phase, "observed");
});

test("same-head rerequests require explicit policy and prior capability evidence", async () => {
  const firstRequest = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: firstRequest.headSha });
  const store = makeStore(client);
  const first = await store.begin(firstRequest, cheapBeginOptions());
  const rerequest = {
    ...clone(firstRequest),
    correlationId: "corr-rerequest",
    attempt: 2,
    rerequestOf: {
      priorReceiptId: first.receipt.receiptId,
      priorLogicalDispatchId: first.receipt.logicalDispatchId,
      priorAttempt: 1,
    },
  };

  await assert.rejects(
    store.begin(rerequest, cheapBeginOptions()),
    /not authorized by repository policy/u,
  );
  const second = await store.begin(
    rerequest,
    cheapBeginOptions({ rerequestAuthorized: true }),
  );
  assert.equal(second.dispatchAllowed, true);
  assert.equal(second.receipt.attempt, 2);
  assert.notEqual(second.receipt.logicalDispatchId, first.receipt.logicalDispatchId);
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 2);
});

test("same-head rerequest loads the current-head snapshot once before create (A-015)", async () => {
  const firstRequest = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: firstRequest.headSha });
  const store = makeStore(client);
  const first = await store.begin(firstRequest, cheapBeginOptions());
  const rerequest = {
    ...clone(firstRequest),
    correlationId: "corr-rerequest-snapshot",
    attempt: 2,
    rerequestOf: {
      priorReceiptId: first.receipt.receiptId,
      priorLogicalDispatchId: first.receipt.logicalDispatchId,
      priorAttempt: 1,
    },
  };

  // Isolate the authorized rerequest begin from the setup begin.
  client.calls.length = 0;
  const second = await store.begin(
    rerequest,
    cheapBeginOptions({ rerequestAuthorized: true }),
  );

  assert.equal(second.dispatchAllowed, true);
  // One shared pre-create snapshot (rerequest validation + identity lookup) plus
  // one post-create reread. Before A-015 this was three: validation and identity
  // each loaded the same current-head set separately.
  assert.equal(client.calls.filter(([name]) => name === "listCheckRuns").length, 2);
});

test("same-head rerequests reject unsupported backends even when policy authorizes them", async () => {
  const firstRequest = clone(requestByName.get("explicit deep"));
  const client = new FakeGitHubClient({ headSha: firstRequest.headSha });
  const store = makeStore(client);
  const backend = clone(backendByName.get("external check backend"));
  const first = await store.begin(firstRequest, {
    decision: { route: "deep", reason: "explicit deep route selected" },
    backend,
  });
  const rerequest = {
    ...clone(firstRequest),
    correlationId: "corr-deep-rerequest",
    attempt: 2,
    rerequestOf: {
      priorReceiptId: first.receipt.receiptId,
      priorLogicalDispatchId: first.receipt.logicalDispatchId,
      priorAttempt: 1,
    },
  };

  await assert.rejects(
    store.begin(rerequest, {
      decision: { route: "deep", reason: "explicit deep route selected" },
      backend,
      rerequestAuthorized: true,
    }),
    /backend does not support rerequest/u,
  );
  assert.equal(client.calls.filter(([name]) => name === "createCheckRun").length, 1);
});

test("successor normalization covers bookkeeping, mixed, oversized, rewritten, and incomplete", () => {
  const base = {
    status: "ahead",
    aheadBy: 1,
    behindBy: 0,
    totalCommits: 1,
    mergeBaseSha: "a".repeat(40),
    incomplete: false,
    inconsistent: false,
  };
  const options = {
    priorHeadSha: "a".repeat(40),
    currentHeadSha: "b".repeat(40),
    bookkeepingPatterns: [".trellis/**"],
  };
  const file = (filename) => ({ filename, status: "modified", additions: 1, deletions: 1, changes: 2 });

  assert.equal(
    normalizeSuccessorComparison({ ...base, files: [file(".trellis/tasks/x/task.json")] }, options).comparison,
    "bookkeeping-only",
  );
  assert.equal(
    normalizeSuccessorComparison({
      ...base,
      files: [file(".trellis/tasks/x/task.json"), file("src/index.js")],
    }, options).comparison,
    "mixed",
  );
  assert.equal(
    normalizeSuccessorComparison({ ...base, files: [file("src/index.js")] }, options).comparison,
    "content-changing",
  );
  assert.equal(
    normalizeSuccessorComparison({ ...base, files: [file("a"), file("b")] }, {
      ...options,
      maximumFiles: 1,
    }).comparison,
    "oversized",
  );
  assert.equal(
    normalizeSuccessorComparison({ ...base, status: "diverged", files: [file("src/index.js")] }, options).comparison,
    "non-comparable",
  );
  assert.equal(
    normalizeSuccessorComparison({ ...base, incomplete: true, files: [file("src/index.js")] }, options).comparison,
    "ambiguous",
  );
  assert.equal(
    normalizeSuccessorComparison({ ...base, incomplete: true, files: [file("src/index.js")] }, {
      ...options,
      maximumFiles: 1,
    }).comparison,
    "oversized",
  );
  assert.equal(
    normalizeSuccessorComparison({
      ...base,
      files: [{ ...file(".trellis/tasks/x/task.json"), additions: false }],
    }, options).comparison,
    "ambiguous",
  );
});

test("trusted successor comparison emits no raw paths and detects a changed live head", async () => {
  const priorRequest = clone(requestByName.get("explicit none"));
  const client = new FakeGitHubClient({ headSha: priorRequest.headSha });
  const store = makeStore(client);
  const prior = await store.begin(priorRequest, {
    decision: { route: "none", reason: "explicit none route selected" },
  });
  const successor = clone(requestByName.get("automatic successor"));
  successor.supersedes = {
    priorReceiptId: prior.receipt.receiptId,
    priorLogicalDispatchId: prior.receipt.logicalDispatchId,
    priorHeadSha: prior.receipt.headSha,
    correlationId: priorRequest.correlationId,
  };
  const decodedSuccessor = decodeReviewRequest(successor);
  client.headSha = decodedSuccessor.headSha;
  client.comparison = {
    status: "ahead",
    aheadBy: 1,
    behindBy: 0,
    totalCommits: 1,
    mergeBaseSha: prior.receipt.headSha,
    files: [{
      filename: ".trellis/workspace/sdelmas/journal-1.md",
      status: "modified",
      additions: 4,
      deletions: 0,
      changes: 4,
    }],
    incomplete: false,
    inconsistent: false,
  };

  const wrongCorrelation = clone(successor);
  wrongCorrelation.supersedes.correlationId = "not-a-prior-alias";
  await assert.rejects(
    store.compareSuccessor(wrongCorrelation),
    /correlationId does not match the prior receipt/u,
  );

  const clean = await store.compareSuccessor(successor);
  assert.equal(clean.evidence.comparison, "bookkeeping-only");
  assert.equal(JSON.stringify(clean).includes("journal-1.md"), false);
  assert.deepEqual(clean.counts, { files: 1, additions: 4, deletions: 0 });

  client.onCompare = () => {
    client.headSha = "8".repeat(40);
  };
  const changed = await store.compareSuccessor(successor);
  assert.equal(changed.evidence.comparison, "changed-head");
});

// The stranded case, and the reason the state was split at all. A finalize that
// never lands -- a transient 502 on the PATCH is enough -- leaves a receipt at
// phase "started" forever. GitHub's REST API has no delete-check-run endpoint,
// so there is no manual escape: the receipt outlives every job that could
// advance it and the pull request cannot be reviewed again at that head.
// Before the split this was indistinguishable from a healthy in-flight replay,
// so no lane could gate on it and it stayed silent.
test("a receipt that outlives any job that could advance it is reported stranded", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const clock = { now: "2026-07-23T12:30:00Z" };
  const store = new ReceiptStore({
    client,
    now: () => clock.now,
    bookkeepingPatterns: [".trellis/**", ".obsidian-kb/**"],
  });

  await store.begin(request, cheapBeginOptions());

  // Still inside the window: the dispatching job could plausibly be alive.
  clock.now = "2026-07-23T18:29:00Z";
  const young = await store.begin(
    { ...clone(request), correlationId: "corr-young" },
    cheapBeginOptions(),
  );
  assert.equal(young.state, "in-flight");
  assert.equal(young.reconciliationRequired, false);

  // Past GitHub's maximum job lifetime, no job can still be running to finalize
  // it, so this receipt is stranded rather than slow.
  clock.now = "2026-07-23T18:31:00Z";
  const stranded = await store.begin(
    { ...clone(request), correlationId: "corr-stranded" },
    cheapBeginOptions(),
  );
  assert.equal(stranded.state, "reconciliation-required");
  assert.equal(stranded.reconciliationRequired, true);
  assert.equal(stranded.dispatchAllowed, false, "a stranded receipt still authorizes nothing");
});

// A dispatch recorded as failed is known broken, not slow, so it must call for
// a human immediately rather than waiting out the window.
test("a failed dispatch needs reconciliation regardless of how recent it is", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const begun = await store.begin(request, cheapBeginOptions());

  // Rewrite the durable record in place as a failed dispatch still at phase
  // "started" -- the shape mutationFailure leaves behind.
  const failed = decodeReceipt({
    ...begun.receipt,
    dispatch: { ...begun.receipt.dispatch, status: "failed", phase: "started" },
  });
  for (const checks of client.checks.values()) {
    for (const check of checks) check.output = { ...check.output, text: encodeReceiptCheckText(failed) };
  }

  // Same clock as the create, so it is as young as a receipt can be. Age must
  // not rescue it.
  const seen = await store.begin(
    { ...clone(request), correlationId: "corr-after-failure" },
    cheapBeginOptions(),
  );
  assert.equal(seen.state, "reconciliation-required");
  assert.equal(seen.reconciliationRequired, true);
});

// `dispatch.startedAt` is optional in the protocol (src/protocol.js:819), so a
// receipt can sit at phase "started" with no timestamp to age it against --
// from an older action version, or any path that omits it. This pins the
// deliberate choice rather than leaving it to fall out of Date.parse: a receipt
// that cannot be dated is reported stranded, not in flight.
//
// Fail-closed is the right side here. Nothing tracks such a receipt, so it will
// never be finalized, and calling it in-flight would recreate exactly the
// permanent wedge this split exists to end. It is also the pre-split behaviour,
// where every "started" receipt reported reconciliation-required. The cost is
// real and accepted: with the route gate in place this now fails a job rather
// than setting an output nobody read.
test("a started receipt with no timestamp is reported stranded rather than in flight", async () => {
  const request = clone(requestByName.get("explicit cheap"));
  const client = new FakeGitHubClient({ headSha: request.headSha });
  const store = makeStore(client);
  const begun = await store.begin(request, cheapBeginOptions());

  const { startedAt: _dropped, ...dispatch } = begun.receipt.dispatch;
  const undatable = decodeReceipt({ ...begun.receipt, dispatch });
  assert.equal(undatable.dispatch.startedAt, undefined, "the fixture must actually lack a timestamp");
  for (const checks of client.checks.values()) {
    for (const check of checks) check.output = { ...check.output, text: encodeReceiptCheckText(undatable) };
  }

  // Same clock as the create: it is as young as a receipt can be, so only the
  // missing timestamp can make it stranded.
  const seen = await store.begin(
    { ...clone(request), correlationId: "corr-undatable" },
    cheapBeginOptions(),
  );
  assert.equal(seen.state, "reconciliation-required");
  assert.equal(seen.reconciliationRequired, true);
});
