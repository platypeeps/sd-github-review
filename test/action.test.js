import assert from "node:assert/strict";
import test from "node:test";
import { annotationEscape, errorAnnotation, runAction, writeOutput, writeSummary } from "../src/index.js";

const basePullRequest = {
  number: 23,
  additions: 40,
  deletions: 2,
  draft: false,
  labels: [],
  head: { sha: "current-head" },
  user: { login: "author" },
};

function createHarness(overrides = {}) {
  const calls = {
    factories: 0,
    getPullRequest: 0,
    listPullRequestFiles: 0,
    getRequestedReviewers: 0,
    listPullRequestReviews: 0,
    requestReviewer: [],
  };
  const client = {
    async getPullRequest() {
      calls.getPullRequest += 1;
      return overrides.pullRequest ?? basePullRequest;
    },
    async listPullRequestFiles() {
      calls.listPullRequestFiles += 1;
      if (overrides.listError) throw overrides.listError;
      return overrides.files ?? [];
    },
    async getRequestedReviewers() {
      calls.getRequestedReviewers += 1;
      return { users: overrides.requestedUsers ?? [] };
    },
    async listPullRequestReviews() {
      calls.listPullRequestReviews += 1;
      return overrides.reviews ?? [];
    },
    async requestReviewer(number, reviewer) {
      calls.requestReviewer.push({ number, reviewer });
    },
  };
  const outputs = new Map();
  const summaries = [];
  const logs = [];
  const run = ({ event, eventName = "pull_request", env = {} }) =>
    runAction({
      event,
      eventName,
      env: {
        GITHUB_REPOSITORY: "platypeeps/example",
        "INPUT_GITHUB-TOKEN": "test-token",
        ...env,
      },
      clientFactory() {
        calls.factories += 1;
        return client;
      },
      outputWriter(name, value) {
        outputs.set(name, value);
      },
      summaryWriter(summary) {
        summaries.push(summary);
      },
      logger(message) {
        logs.push(message);
      },
    });
  return { calls, outputs, summaries, logs, run };
}

test("ignores unrelated comments without constructing a GitHub client", async () => {
  const harness = createHarness();

  const result = await harness.run({
    eventName: "issue_comment",
    event: { action: "created", issue: { number: 23 }, comment: { body: "looks good" } },
  });

  assert.equal(result.decision.route, "none");
  assert.equal(harness.calls.factories, 0);
  assert.equal(harness.outputs.get("operation"), "standalone");
  assert.equal(harness.outputs.get("changed-lines"), "0");
  assert.equal(harness.outputs.get("run-external-reviewer"), "false");
});

test("ignores unrelated label events without constructing a GitHub client", async () => {
  const harness = createHarness();

  await harness.run({
    event: { action: "labeled", label: { name: "documentation" }, pull_request: basePullRequest },
  });

  assert.equal(harness.calls.factories, 0);
  assert.equal(harness.outputs.get("route"), "none");
  assert.equal(harness.outputs.get("changed-lines"), "42");
});

test("explicit routes skip file enumeration even when it would exceed 3,000 files", async () => {
  const harness = createHarness({ listError: new Error("should not list files") });

  const result = await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: { INPUT_MODE: "cheap", "INPUT_CHEAP-MODEL": "economy-model" },
  });

  assert.equal(result.decision.route, "cheap");
  assert.equal(harness.calls.factories, 0);
  assert.equal(harness.calls.listPullRequestFiles, 0);
  assert.equal(harness.outputs.get("model"), "economy-model");
  assert.equal(harness.outputs.get("sensitive-files"), "[]");
  assert.equal(harness.outputs.get("run-external-reviewer"), "true");
});

test("trusted comment commands fetch PR metadata but skip file enumeration", async () => {
  const harness = createHarness();

  const result = await harness.run({
    eventName: "issue_comment",
    event: {
      action: "created",
      issue: { number: 23 },
      comment: {
        body: "/review deep",
        author_association: "MEMBER",
        user: { login: "maintainer" },
      },
    },
    env: { "INPUT_DEEP-MODEL": "deep-model" },
  });

  assert.equal(result.decision.route, "deep");
  assert.equal(harness.calls.getPullRequest, 1);
  assert.equal(harness.calls.listPullRequestFiles, 0);
  assert.equal(harness.outputs.get("model"), "deep-model");
});

const conflictingLabelPullRequest = {
  ...basePullRequest,
  labels: [{ name: "review:cheap" }, { name: "review:copilot" }],
};

// A-011: a higher-precedence control (fixed mode or trusted command) must route
// even when the PR carries conflicting review labels, instead of the run
// throwing on the label conflict.
test("fixed mode routes despite conflicting review labels (A-011)", async () => {
  const harness = createHarness();

  const result = await harness.run({
    event: { action: "opened", pull_request: conflictingLabelPullRequest },
    env: { INPUT_MODE: "deep", "INPUT_DEEP-MODEL": "deep-model" },
  });

  assert.equal(result.decision.route, "deep");
});

test("trusted command routes despite conflicting review labels (A-011)", async () => {
  const harness = createHarness({ pullRequest: conflictingLabelPullRequest });

  const result = await harness.run({
    eventName: "issue_comment",
    event: {
      action: "created",
      issue: { number: 23 },
      comment: {
        body: "/review deep",
        author_association: "MEMBER",
        user: { login: "maintainer" },
      },
    },
    env: { "INPUT_DEEP-MODEL": "deep-model" },
  });

  assert.equal(result.decision.route, "deep");
});

test("auto mode with conflicting review labels still throws (A-011)", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: conflictingLabelPullRequest },
    }),
    /conflicting review labels/u,
  );
});

test("automatic sensitive routing requests Copilot once and reports outputs", async () => {
  const harness = createHarness({ files: ["src/auth/session.js"] });

  const result = await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: { "INPUT_SENSITIVE-PATHS": "**/auth/**" },
  });

  assert.equal(result.decision.route, "copilot");
  assert.equal(harness.calls.listPullRequestFiles, 1);
  assert.equal(harness.calls.getRequestedReviewers, 1);
  assert.deepEqual(harness.calls.requestReviewer, [
    { number: 23, reviewer: "copilot-pull-request-reviewer[bot]" },
  ]);
  assert.equal(harness.outputs.get("copilot-requested"), "true");
  assert.equal(harness.outputs.get("run-external-reviewer"), "false");
  assert.deepEqual(harness.summaries[0].sensitiveFiles, ["src/auth/session.js"]);
  assert.match(harness.logs[0], /Selected copilot for PR #23/u);
});

test("automatic sensitive routing can run the external deep reviewer without requesting Copilot", async () => {
  const harness = createHarness({ files: ["src/auth/session.js"] });

  const result = await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: {
      "INPUT_SENSITIVE-PATHS": "**/auth/**",
      "INPUT_HIGH-RISK-ROUTE": "deep",
      "INPUT_DEEP-MODEL": "deep-model",
    },
  });

  assert.equal(result.decision.route, "deep");
  assert.equal(harness.calls.listPullRequestFiles, 1);
  assert.equal(harness.calls.getRequestedReviewers, 0);
  assert.equal(harness.calls.listPullRequestReviews, 0);
  assert.deepEqual(harness.calls.requestReviewer, []);
  assert.equal(harness.outputs.get("model"), "deep-model");
  assert.equal(harness.outputs.get("copilot-requested"), "false");
  assert.equal(harness.outputs.get("run-external-reviewer"), "true");
  assert.match(harness.logs[0], /Selected deep for PR #23/u);
});

test("does not duplicate an existing Copilot review request", async () => {
  const harness = createHarness({
    requestedUsers: [{ login: "copilot-pull-request-reviewer[bot]" }],
  });

  await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: { INPUT_MODE: "copilot" },
  });

  assert.equal(harness.calls.listPullRequestFiles, 0);
  assert.equal(harness.calls.getRequestedReviewers, 1);
  assert.equal(harness.calls.listPullRequestReviews, 0);
  assert.deepEqual(harness.calls.requestReviewer, []);
  assert.equal(harness.outputs.get("copilot-requested"), "false");
});

test("does not re-request Copilot after it reviewed the current head commit", async () => {
  const harness = createHarness({
    reviews: [
      {
        user: { login: "copilot-pull-request-reviewer[bot]" },
        commit_id: "current-head",
        state: "COMMENTED",
      },
    ],
  });

  await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: { INPUT_MODE: "copilot" },
  });

  assert.equal(harness.calls.listPullRequestReviews, 1);
  assert.deepEqual(harness.calls.requestReviewer, []);
  assert.equal(harness.outputs.get("copilot-requested"), "false");
});

test("skips automatic file enumeration for disabled draft reviews", async () => {
  const harness = createHarness({ listError: new Error("should not list files") });

  await harness.run({
    event: { action: "opened", pull_request: { ...basePullRequest, draft: true } },
  });

  assert.equal(harness.calls.factories, 0);
  assert.equal(harness.outputs.get("route"), "none");
});

test("rejects invalid inputs and escapes workflow error annotations", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: basePullRequest },
      env: { INPUT_MODE: "expensive" },
    }),
    /mode must be one of/u,
  );
  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: basePullRequest },
      env: { "INPUT_HIGH-RISK-ROUTE": "cheap" },
    }),
    /high-risk-route must be deep or copilot/u,
  );
  assert.equal(annotationEscape("bad%value\nnext"), "bad%25value%0Anext");
  assert.equal(errorAnnotation(new Error("bad\nvalue")).startsWith("::error::Error: bad%0Avalue"), true);
});

function createIdentityHarness(overrides = {}) {
  const numbers = {
    getPullRequest: [],
    listPullRequestFiles: [],
    getRequestedReviewers: [],
    listPullRequestReviews: [],
    requestReviewer: [],
  };
  let factories = 0;
  const client = {
    async getPullRequest(number) {
      numbers.getPullRequest.push(number);
      return overrides.pullRequest ?? basePullRequest;
    },
    async listPullRequestFiles(number) {
      numbers.listPullRequestFiles.push(number);
      return overrides.files ?? [];
    },
    async getRequestedReviewers(number) {
      numbers.getRequestedReviewers.push(number);
      return { users: [] };
    },
    async listPullRequestReviews(number) {
      numbers.listPullRequestReviews.push(number);
      return [];
    },
    async requestReviewer(number) {
      numbers.requestReviewer.push(number);
    },
  };
  const run = ({ event, eventName = "pull_request", env = {} }) =>
    runAction({
      event,
      eventName,
      env: { GITHUB_REPOSITORY: "platypeeps/example", "INPUT_GITHUB-TOKEN": "test-token", ...env },
      clientFactory() {
        factories += 1;
        return client;
      },
      outputWriter() {},
      summaryWriter() {},
      logger() {},
    });
  return { numbers, factoryCount: () => factories, run };
}

test("rejects a malformed pr-number override with a field-specific error before any GitHub call", async () => {
  const harness = createIdentityHarness();

  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: basePullRequest },
      env: { "INPUT_PR-NUMBER": "12garbage" },
    }),
    /pr-number must be a complete positive integer/u,
  );
  assert.equal(harness.factoryCount(), 0);
});

test("rejects an unsafe-integer pr-number override that would round during conversion", async () => {
  const harness = createIdentityHarness();

  // 9007199254740993 (2^53 + 1) is not exactly representable and Number() rounds
  // it to 9007199254740992 (2^53), which is itself unsafe — the decoder must
  // reject it rather than silently bind a mutated identity.
  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: basePullRequest },
      env: { "INPUT_PR-NUMBER": "9007199254740993" },
    }),
    /pr-number must be a complete positive integer/u,
  );
  assert.equal(harness.factoryCount(), 0);
});

test("rejects a pr-number override that conflicts with the event identity before any GitHub call", async () => {
  const harness = createIdentityHarness();

  await assert.rejects(
    harness.run({
      event: { action: "opened", pull_request: basePullRequest },
      env: { "INPUT_PR-NUMBER": "99" },
    }),
    /pr-number 99 conflicts with event pull request #23/u,
  );
  assert.equal(harness.factoryCount(), 0);
});

test("event-target routing drives every client call with the single event PR number", async () => {
  const harness = createIdentityHarness({ files: ["src/auth/session.js"] });

  const result = await harness.run({
    event: { action: "opened", pull_request: basePullRequest },
    env: { "INPUT_SENSITIVE-PATHS": "**/auth/**" },
  });

  assert.equal(result.decision.route, "copilot");
  // Event carries metadata, so getPullRequest is never called; every other call binds to #23.
  assert.deepEqual(harness.numbers.getPullRequest, []);
  const called = [
    ...harness.numbers.listPullRequestFiles,
    ...harness.numbers.getRequestedReviewers,
    ...harness.numbers.listPullRequestReviews,
    ...harness.numbers.requestReviewer,
  ];
  assert.ok(called.length >= 4);
  assert.ok(called.every((number) => number === 23), `expected all calls to bind #23, saw ${called}`);
});

test("explicit-target override fetches metadata and binds every client call to the normalized number", async () => {
  const harness = createIdentityHarness({ files: ["src/auth/session.js"] });

  const result = await harness.run({
    eventName: "workflow_dispatch",
    event: {},
    env: { "INPUT_PR-NUMBER": "77", "INPUT_SENSITIVE-PATHS": "**/auth/**" },
  });

  assert.equal(result.decision.route, "copilot");
  const called = [
    ...harness.numbers.getPullRequest,
    ...harness.numbers.listPullRequestFiles,
    ...harness.numbers.getRequestedReviewers,
    ...harness.numbers.listPullRequestReviews,
    ...harness.numbers.requestReviewer,
  ];
  assert.ok(harness.numbers.getPullRequest.length >= 1, "explicit target must fetch its own metadata");
  assert.ok(harness.numbers.listPullRequestReviews.length >= 1, "copilot de-dup must check reviews");
  assert.ok(called.length >= 5);
  assert.ok(called.every((number) => number === 77), `expected all calls to bind #77, saw ${called}`);
});

test("writes multiline outputs and summaries through injected append operations", async () => {
  const writes = [];
  const env = { GITHUB_OUTPUT: "/tmp/output", GITHUB_STEP_SUMMARY: "/tmp/summary" };
  const appendFileImpl = async (path, value) => writes.push({ path, value });

  await writeOutput("reason", "line one\nline two", { env, appendFileImpl });
  await writeSummary(
    {
      pullRequestNumber: 23,
      route: "cheap",
      reason: "routine",
      changedLines: 42,
      sensitiveFiles: [],
      copilotRequested: false,
    },
    { env, appendFileImpl },
  );

  assert.equal(writes[0].path, "/tmp/output");
  assert.match(writes[0].value, /^reason<<sd_review_[^\n]+\nline one\nline two\n/u);
  assert.equal(writes[1].path, "/tmp/summary");
  assert.match(writes[1].value, /Pull request: #23/u);
});
