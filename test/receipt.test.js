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

  assert.equal(second.state, "reconciliation-required");
  assert.equal(second.dispatchAllowed, false);
  assert.equal(second.reconciliationRequired, true);
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

  // Winner: a concurrent begin durably lands a higher-id Check Run for the same
  // identity right as this caller creates the lower id. The caller is elected.
  const winnerClient = new FakeGitHubClient({ headSha: request.headSha });
  winnerClient.onCreate = () => {
    winnerClient.onCreate = null;
    const headChecks = winnerClient.checks.get(request.headSha);
    headChecks.push({ ...clone(headChecks[0]), id: 999 });
  };
  const winner = await makeStore(winnerClient).begin(request, cheapBeginOptions());
  assert.equal(winner.state, "started");
  assert.equal(winner.dispatchAllowed, true);

  // Loser: a concurrent begin durably lands a lower-id Check Run first, so this
  // caller (higher id) must defer with a recoverable reconciliation state and
  // must not authorize a second dispatch. No Check Run is deleted.
  const loserClient = new FakeGitHubClient({ headSha: request.headSha });
  loserClient.onCreate = () => {
    loserClient.onCreate = null;
    const headChecks = loserClient.checks.get(request.headSha);
    headChecks.unshift({ ...clone(headChecks[0]), id: 50 });
  };
  const loser = await makeStore(loserClient).begin(request, cheapBeginOptions());
  assert.equal(loser.state, "reconciliation-required");
  assert.equal(loser.dispatchAllowed, false);
  assert.equal(loser.reconciliationRequired, true);
  assert.equal(loser.reconciliation.authoritativeCheckId, 50);
  assert.equal(loser.reconciliation.supersededCheckId, 100);
  assert.deepEqual(loser.reconciliation.duplicateCheckIds, [100]);
  assert.equal(loserClient.checks.get(request.headSha).length, 2);

  // Across the racing pair exactly one dispatch is authorized.
  assert.equal([winner, loser].filter((result) => result.dispatchAllowed).length, 1);
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
