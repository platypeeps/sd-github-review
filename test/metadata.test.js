import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import {
  prohibitedPublishedMetadataReason,
  validateMetadata,
} from "../scripts/validate-action-metadata.mjs";

const execFileAsync = promisify(execFile);

async function writeMetadataFixture(root, actionReference) {
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(root, "examples"), { recursive: true });
  await writeFile(path.join(root, "index.js"), "", "utf8");
  await writeFile(
    path.join(root, "action.yml"),
    [
      "name: Fixture",
      "description: Fixture action",
      "inputs: {}",
      "outputs: {}",
      "runs:",
      "  using: node24",
      "  main: index.js",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on:",
      "  push:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${actionReference}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("validates the repository action metadata, pinned workflows, and examples", async () => {
  const result = await validateMetadata(path.resolve(import.meta.dirname, ".."));
  assert.equal(result.workflowCount, 1);
  assert.equal(result.exampleCount, 4);
  assert.ok(result.trackedPathCount > 0);
});

test("publishes consistent read-only setup discovery and a no-checkout durable workflow", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const descriptor = JSON.parse(
    await readFile(path.join(root, "config", "routed-review-setup-v1.json"), "utf8"),
  );
  const discovery = JSON.parse(
    await readFile(path.join(root, "fixtures", "setup", "v1", "discovery.json"), "utf8"),
  );
  const workflowSource = await readFile(
    path.join(root, "examples", "on-demand-review-router.yml"),
    "utf8",
  );
  const workflowDocument = parseDocument(workflowSource, { prettyErrors: true, uniqueKeys: true });
  assert.deepEqual(workflowDocument.errors, []);
  const workflow = workflowDocument.toJS();

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.contractMajor, 1);
  assert.deepEqual(descriptor.supportedIntents, ["auto", "cheap", "deep", "copilot", "none"]);
  assert.deepEqual(descriptor.supportedOperations, ["route", "finalize", "query"]);
  assert.equal(descriptor.durableReceipt.checkName, "sd-github-review/receipt");
  assert.equal(descriptor.workflow.name, workflow.name);
  assert.equal(descriptor.noninteractive, true);
  assert.equal(descriptor.checkoutRequired, false);
  assert.deepEqual(workflow.permissions, descriptor.requiredPermissions);
  assert.ok(workflow.on.workflow_dispatch.inputs["review-request"]);

  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  assert.equal(steps.some((step) => step.uses?.startsWith("actions/checkout@")), false);
  assert.equal(steps.some((step) => typeof step.run === "string"), false);
  assert.equal(workflowSource.includes("AskUserQuestion"), false);
  assert.equal(workflowSource.includes("pull_request_target"), false);

  const classify = ({ declarationPresent, metadata }) => {
    if (!declarationPresent) return "absent";
    if (!metadata?.readable) return "unavailable";
    if (!metadata.workflowPresent || metadata.workflowState !== "active") return "invalid";
    if (metadata.contractMajor !== descriptor.contractMajor) return "incompatible";
    return "ready";
  };
  assert.deepEqual(
    discovery.cases.map((entry) => [entry.name, classify(entry)]),
    discovery.cases.map((entry) => [entry.name, entry.expectedState]),
  );
});

test("rejects local and session metadata paths while preserving shared project knowledge", () => {
  const prohibited = [
    ".env.local",
    ".trellis/.developer",
    ".trellis\\.developer",
    ".trellis/.runtime/session.json",
    ".trellis/.cache/context.json",
    ".trellis/worktrees/task",
    ".trellis/.template-hashes.json",
    ".trellis/.current-task",
    ".trellis/tasks/example/.plan-log",
    ".trellis/scripts/__pycache__/task.cpython-314.pyc",
    ".trellis/workspace/sdelmas/transcript.jsonl",
    ".agents/skills/example/cache/state.json",
    ".agents/session.local.json",
    ".codex/sessions/session.jsonl",
    ".gemini/hooks/debug.log",
    ".opencode/state/session.json",
    ".github/copilot/sessions/session.jsonl",
  ];
  for (const filePath of prohibited) {
    assert.ok(prohibitedPublishedMetadataReason(filePath), `${filePath} should be prohibited`);
  }

  const allowed = [
    ".env.example",
    ".trellis/workflow.md",
    ".trellis/tasks/07-22-example/prd.md",
    ".trellis/workspace/index.md",
    ".trellis/workspace/sdelmas/index.md",
    ".trellis/workspace/sdelmas/journal-1.md",
    ".trellis\\workspace\\sdelmas\\journal-1.md",
    ".agents/skills/sd-status/SKILL.md",
    ".codex/config.toml",
    ".github/copilot/hooks/session-start.py",
    ".opencode/lib/session-utils.js",
    ".gito/sd-ai-command-pack.env",
    ".sd-ai-command-pack/provenance.json",
  ];
  for (const filePath of allowed) {
    assert.equal(prohibitedPublishedMetadataReason(filePath), null, `${filePath} should be public`);
  }
});

test("rejects floating third-party Action references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-metadata-"));
  await writeMetadataFixture(root, "actions/checkout@v4");

  await assert.rejects(
    validateMetadata(root),
    /must pin third-party action actions\/checkout@v4 to a 40-character commit SHA/u,
  );
});

test("rejects a prohibited path even when it is force-added to Git", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-public-metadata-"));
  await writeMetadataFixture(
    root,
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c",
  );
  await mkdir(path.join(root, ".trellis"), { recursive: true });
  await writeFile(path.join(root, ".trellis", ".developer"), "fixture-user\n", "utf8");
  await execFileAsync("git", ["init", "-q", root]);
  await execFileAsync("git", ["-C", root, "add", "-f", "."]);

  await assert.rejects(
    validateMetadata(root),
    /prohibited local\/session metadata is tracked:[\s\S]*\.trellis\/\.developer/u,
  );
});
