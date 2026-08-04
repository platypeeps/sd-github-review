// Subprocess coverage for the shipped Action entrypoint `src/index.js`
// (action.yml runs it as the process entry). The in-process tests in
// action.test.js drive `runAction` with an injected client; these run the real
// `node src/index.js` composition root and assert on GITHUB_OUTPUT /
// GITHUB_STEP_SUMMARY files, the `::error::` annotation, and the exit status.
// Every case is hermetic: a pre-network routing decision is used for the
// success path so no GitHub client is ever constructed, and an unroutable
// GITHUB_API_URL makes any accidental network attempt fail loudly.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  UNROUTABLE_API_URL,
  makeTempDir,
  parseGithubOutput,
  runEntrypoint,
  writeEventFile,
} from "./support/subprocess.mjs";

// A `pull_request` `labeled` event with a routing-irrelevant label resolves to
// the pre-network "ignored" decision: the entrypoint writes outputs and exits 0
// without building a client, so the run is fully hermetic.
function ignoredLabelEvent() {
  return {
    action: "labeled",
    label: { name: "unrelated-label" },
    pull_request: { number: 11, additions: 3, deletions: 1, draft: false, labels: [] },
  };
}

function actionEnv(eventPath, overrides = {}) {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "acme/consumer",
    GITHUB_API_URL: UNROUTABLE_API_URL,
    ...overrides,
  };
}

test("action entrypoint writes routing outputs and a summary, then exits 0", async () => {
  const eventPath = await writeEventFile(ignoredLabelEvent());
  const workDir = await makeTempDir("action-io");
  const outputPath = path.join(workDir, "output");
  const summaryPath = path.join(workDir, "summary");
  await writeFile(outputPath, "", "utf8");
  await writeFile(summaryPath, "", "utf8");

  const { status, stderr } = runEntrypoint("src/index.js", [], {
    env: actionEnv(eventPath, { GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath }),
  });

  assert.equal(status, 0, stderr);
  const outputs = parseGithubOutput(await readFile(outputPath, "utf8"));
  assert.equal(outputs.operation, "standalone");
  assert.equal(outputs.route, "none");
  assert.equal(outputs.reason, "label event was unrelated to review routing");
  assert.equal(outputs["changed-lines"], "4");
  assert.equal(outputs["run-external-reviewer"], "false");
  assert.equal(outputs["copilot-requested"], "false");

  const summary = await readFile(summaryPath, "utf8");
  assert.match(summary, /### AI review route/u);
  assert.match(summary, /- Route: `none`/u);
});

test("action entrypoint falls back to stdout when GITHUB_OUTPUT is unset", async () => {
  const eventPath = await writeEventFile(ignoredLabelEvent());

  const { status, stdout, stderr } = runEntrypoint("src/index.js", [], {
    env: actionEnv(eventPath),
  });

  assert.equal(status, 0, stderr);
  assert.match(stdout, /^route=none$/mu);
  assert.match(stdout, /^operation=standalone$/mu);
});

test("action entrypoint annotates and exits 1 when GITHUB_EVENT_PATH is missing", async () => {
  const { status, stderr } = runEntrypoint("src/index.js", [], {
    env: {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "acme/consumer",
      GITHUB_API_URL: UNROUTABLE_API_URL,
    },
  });

  assert.equal(status, 1);
  assert.match(stderr, /^::error::/u);
  assert.match(stderr, /GITHUB_EVENT_PATH is required/u);
});

test("action entrypoint annotates and exits 1 on a malformed event payload", async () => {
  const dir = await makeTempDir("bad-event");
  const eventPath = path.join(dir, "event.json");
  await writeFile(eventPath, "{ this is not valid json", "utf8");

  const { status, stderr } = runEntrypoint("src/index.js", [], { env: actionEnv(eventPath) });

  assert.equal(status, 1);
  assert.match(stderr, /^::error::/u);
});
