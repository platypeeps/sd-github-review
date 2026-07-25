import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MANIFEST_PATH,
  ROUTING_LABELS,
  SECRET_NAME,
  WORKFLOW_PATH,
  parseArguments,
  parseGitHubRemote,
  runConsumerInstaller,
} from "../scripts/consumer-installer.mjs";
import { reviewLabels } from "../src/router.js";

const REPOSITORY = "acme/consumer";

class FakeGitHub {
  constructor({ variables = {}, secrets = [], labels = [] } = {}) {
    this.repository = REPOSITORY;
    this.variables = new Map(Object.entries(variables));
    this.secrets = new Set(secrets);
    this.labels = new Map(labels.map((name) => [name, { name }]));
    this.calls = [];
    this.failKind = null;
  }

  async inspect() {
    return {
      repository: this.repository,
      variables: new Map(this.variables),
      secrets: new Set(this.secrets),
      labels: new Map(this.labels),
    };
  }

  failIfRequested(kind) {
    if (this.failKind === kind) throw new Error(`simulated ${kind} failure`);
  }

  async setVariable(repository, name, value) {
    this.failIfRequested("set-variable");
    this.calls.push({ kind: "set-variable", repository, name });
    this.variables.set(name, value);
  }

  async deleteVariable(repository, name) {
    this.failIfRequested("delete-variable");
    this.calls.push({ kind: "delete-variable", repository, name });
    this.variables.delete(name);
  }

  async createLabel(repository, label) {
    this.failIfRequested("create-label");
    this.calls.push({ kind: "create-label", repository, name: label.name });
    this.labels.set(label.name, { ...label });
  }

  async deleteLabel(repository, name) {
    this.failIfRequested("delete-label");
    this.calls.push({ kind: "delete-label", repository, name });
    this.labels.delete(name);
  }

  async setSecret(repository, options) {
    this.failIfRequested("set-secret");
    this.calls.push({ kind: "set-secret", repository, interactive: options.interactive });
    this.secrets.add(SECRET_NAME);
  }

  async deleteSecret(repository) {
    this.failIfRequested("delete-secret");
    this.calls.push({ kind: "delete-secret", repository });
    this.secrets.delete(SECRET_NAME);
  }
}

async function makeSource(workflow = "name: managed workflow\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-source-"));
  await mkdir(path.join(root, "examples"));
  await writeFile(path.join(root, "examples", "pr-agent-router.yml"), workflow, "utf8");
  return root;
}

async function makeTarget() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-target-"));
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "remote", "add", "origin", `https://github.com/${REPOSITORY}.git`]);
  return root;
}

async function readManifest(target) {
  return JSON.parse(await readFile(path.join(target, MANIFEST_PATH), "utf8"));
}

test("parses supported GitHub origin shapes and rejects unrelated remotes", () => {
  assert.equal(parseGitHubRemote("https://github.com/acme/consumer.git"), REPOSITORY);
  assert.equal(parseGitHubRemote("git@github.com:acme/consumer.git"), REPOSITORY);
  assert.equal(parseGitHubRemote("ssh://git@github.com/acme/consumer.git"), REPOSITORY);
  assert.equal(parseGitHubRemote("https://gitlab.com/acme/consumer.git"), null);
});

test("reports actionable recovery when a target checkout has no origin", async () => {
  const sourceRoot = await makeSource();
  const target = await mkdtemp(path.join(os.tmpdir(), "sd-review-no-origin-"));
  execFileSync("git", ["init", "-b", "main", target], { stdio: "ignore" });
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    /no readable GitHub origin; configure origin or pass --github OWNER\/REPO/u,
  );
  assert.deepEqual(github.calls, []);
});

test("installer labels stay aligned with the router contract", () => {
  assert.deepEqual(
    new Set(ROUTING_LABELS.map(({ name }) => name)),
    reviewLabels,
  );
});

test("parses lifecycle options without accepting a secret value argument", () => {
  assert.deepEqual(
    parseArguments(["install", "--target", "/tmp/target", "--secret-stdin", "--json"]),
    {
      command: "install",
      target: "/tmp/target",
      secretMode: "stdin",
      json: true,
    },
  );
  assert.throws(
    () => parseArguments(["install", "--secret-value", "credential"]),
    /unknown option --secret-value/u,
  );
  assert.throws(
    () => parseArguments(["check", "--set-secret"]),
    /check does not accept secret input/u,
  );
});

test("installs, checks, and repeats without leaking secret input", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub();
  const secret = "never-print-this-value";

  const first = await runConsumerInstaller(
    { command: "install", target, secretMode: "stdin", secretInput: secret },
    { sourceRoot, github },
  );
  const manifest = await readManifest(target);
  assert.equal(manifest.state, "active");
  assert.equal(manifest.repository, REPOSITORY);
  assert.equal(manifest.resources.secret.owned, true);
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    "name: managed workflow\n",
  );
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(JSON.stringify(manifest).includes(secret), false);
  assert.equal(github.calls.some((call) => JSON.stringify(call).includes(secret)), false);

  const callsAfterFirst = github.calls.length;
  const second = await runConsumerInstaller(
    { command: "install", target },
    { sourceRoot, github },
  );
  assert.equal(second.ok, true);
  assert.equal(github.calls.length, callsAfterFirst);

  const checked = await runConsumerInstaller(
    { command: "check", target },
    { sourceRoot, github },
  );
  assert.equal(checked.ok, true, checked.issues.join("\n"));
  assert.deepEqual(checked.issues, []);
  assert.equal(github.calls.length, callsAfterFirst);
});

test("check detects a source update and update refreshes the workflow", async () => {
  const sourceRoot = await makeSource("name: version one\n");
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  await writeFile(
    path.join(sourceRoot, "examples", "pr-agent-router.yml"),
    "name: version two\n",
    "utf8",
  );
  const drifted = await runConsumerInstaller(
    { command: "check", target },
    { sourceRoot, github },
  );
  assert.equal(drifted.ok, false);
  assert.ok(drifted.issues.includes("a newer source workflow is available; run update"));

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    "name: version two\n",
  );
  const healthy = await runConsumerInstaller(
    { command: "check", target },
    { sourceRoot, github },
  );
  assert.equal(healthy.ok, true, healthy.issues.join("\n"));

  github.variables.set("DEEP_REVIEW_MODEL", "openrouter/drifted/model");
  const remoteDrift = await runConsumerInstaller(
    { command: "check", target },
    { sourceRoot, github },
  );
  assert.equal(remoteDrift.ok, false);
  assert.ok(remoteDrift.issues.includes("GitHub variable DEEP_REVIEW_MODEL has drifted"));
});

test("update can deliberately change an installer-owned provider and models", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  await runConsumerInstaller(
    {
      command: "update",
      target,
      provider: "gemini",
      cheapModel: "gemini/cheap-model",
      deepModel: "gemini/deep-model",
    },
    { sourceRoot, github },
  );
  const manifest = await readManifest(target);
  assert.deepEqual(manifest.configuration, {
    provider: "gemini",
    cheapModel: "gemini/cheap-model",
    deepModel: "gemini/deep-model",
  });
  assert.equal(github.variables.get("PR_AGENT_MODEL_PROVIDER"), "gemini");
  assert.equal(github.variables.get("CHEAP_REVIEW_MODEL"), "gemini/cheap-model");
  assert.equal(github.variables.get("DEEP_REVIEW_MODEL"), "gemini/deep-model");
});

test("refuses unmanaged workflow collisions and unowned variable conflicts", async () => {
  const sourceRoot = await makeSource();
  const targetWithWorkflow = await makeTarget();
  await mkdir(path.join(targetWithWorkflow, ".github", "workflows"), { recursive: true });
  await writeFile(
    path.join(targetWithWorkflow, WORKFLOW_PATH),
    "name: operator workflow\n",
    "utf8",
  );
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await assert.rejects(
    runConsumerInstaller(
      { command: "install", target: targetWithWorkflow },
      { sourceRoot, github },
    ),
    /exists and is not managed/u,
  );

  const targetWithVariable = await makeTarget();
  const conflictingGitHub = new FakeGitHub({
    secrets: [SECRET_NAME],
    variables: { PR_AGENT_MODEL_PROVIDER: "gemini" },
  });
  await assert.rejects(
    runConsumerInstaller(
      { command: "install", target: targetWithVariable },
      { sourceRoot, github: conflictingGitHub },
    ),
    /different unowned value/u,
  );
  await assert.rejects(
    runConsumerInstaller(
      { command: "install", target: targetWithVariable, repository: "acme/other" },
      { sourceRoot, github: conflictingGitHub },
    ),
    /does not match origin/u,
  );
});

test("validates provider/model pairing before writing managed files", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await assert.rejects(
    runConsumerInstaller(
      {
        command: "install",
        target,
        provider: "gemini",
        cheapModel: "openrouter/moonshotai/kimi-k2.6",
        deepModel: "gemini/model",
      },
      { sourceRoot, github },
    ),
    /cheap model must use the gemini\/<model-id> form/u,
  );
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("retains pending ownership after a partial GitHub failure and resumes safely", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  github.failKind = "create-label";

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    /simulated create-label failure/u,
  );
  const pending = await readManifest(target);
  assert.equal(pending.state, "pending");
  assert.equal(pending.resources.variables.PR_AGENT_MODEL_PROVIDER.owned, true);

  github.failKind = null;
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  assert.equal((await readManifest(target)).state, "active");
  assert.equal(github.variables.get("PR_AGENT_MODEL_PROVIDER"), "openrouter");
  assert.ok(ROUTING_LABELS.every(({ name }) => github.labels.has(name)));
});

test("dry-run plans secret setup without reading or mutating secret state", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub();
  const report = await runConsumerInstaller(
    { command: "install", target, dryRun: true, secretMode: "stdin" },
    { sourceRoot, github },
  );
  assert.equal(report.dryRun, true);
  assert.ok(report.actions.includes(`set GitHub secret ${SECRET_NAME}`));
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("uninstall removes owned resources while preserving shared labels and secrets", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({
    secrets: [SECRET_NAME],
    labels: ["review:auto"],
  });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  const manifest = await readManifest(target);
  assert.equal(
    manifest.resources.labels.find(({ name }) => name === "review:auto").owned,
    false,
  );

  await runConsumerInstaller(
    { command: "uninstall", target, yes: true, removeSecret: true, removeLabels: true },
    { sourceRoot, github },
  );
  assert.equal(github.variables.size, 0);
  assert.equal(github.secrets.has(SECRET_NAME), false);
  assert.equal(github.labels.has("review:auto"), true);
  assert.equal(github.labels.size, 1);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
  await assert.rejects(readFile(path.join(target, WORKFLOW_PATH), "utf8"), /ENOENT/u);
});

test("uninstall preserves all labels and the secret by default", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  await runConsumerInstaller(
    { command: "uninstall", target, yes: true },
    { sourceRoot, github },
  );
  assert.equal(github.secrets.has(SECRET_NAME), true);
  assert.ok(ROUTING_LABELS.every(({ name }) => github.labels.has(name)));
});

test("uninstall refuses to remove a modified managed workflow", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  await writeFile(path.join(target, WORKFLOW_PATH), "name: operator edit\n", "utf8");

  await assert.rejects(
    runConsumerInstaller(
      { command: "uninstall", target, yes: true },
      { sourceRoot, github },
    ),
    /refusing to remove operator changes/u,
  );
  assert.equal((await readManifest(target)).state, "active");
});

test("manifest decoding cannot expand uninstall ownership beyond managed resources", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME], labels: ["do-not-delete"] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  const manifest = await readManifest(target);
  manifest.resources.labels.push({ name: "do-not-delete", owned: true });
  await writeFile(
    path.join(target, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(
    runConsumerInstaller(
      { command: "uninstall", target, yes: true, removeLabels: true },
      { sourceRoot, github },
    ),
    /label ownership is malformed/u,
  );
  assert.equal(github.labels.has("do-not-delete"), true);
});
