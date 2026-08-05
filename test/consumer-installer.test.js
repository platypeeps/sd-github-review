import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import {
  lstat as realLstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GH_COMMAND_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  GitHubCli,
  HISTORICAL_TEMPLATE_HASHES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  ROUTING_LABELS,
  SECRET_NAME,
  WORKFLOW_PATH,
  makeSourceGit,
  parseArguments,
  parseGitHubRemote,
  resolveSourceRelease,
  runConsumerInstaller,
} from "../scripts/consumer-installer.mjs";
import { reviewLabels } from "../src/normalize.js";
import * as installerModule from "../scripts/consumer-installer.mjs";

const REPOSITORY = "acme/consumer";

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

async function placeManualWorkflow(target, content) {
  await mkdir(path.join(target, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(target, WORKFLOW_PATH), content, "utf8");
}

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

function gitCommit(root, message) {
  execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=Test", "commit", "-m", message, "--no-gpg-sign"],
    { stdio: "ignore" },
  );
}

// The installer source root is a git checkout in production, so resolveSourceRelease
// reads real git here. Provenance-specific tests pass { tag, version } to exercise
// the released path; the default is an untagged dev checkout (released:false).
async function makeSource(workflow = "name: managed workflow\n", { tag, version } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-source-"));
  await mkdir(path.join(root, "examples"));
  await writeFile(path.join(root, "examples", "pr-agent-router.yml"), workflow, "utf8");
  if (version !== undefined) {
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "sd-github-review-source", version }, null, 2)}\n`,
      "utf8",
    );
  }
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
  gitCommit(root, "source");
  if (tag !== undefined) execFileSync("git", ["-C", root, "tag", tag], { stdio: "ignore" });
  return root;
}

async function sourceCommit(root) {
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
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

test("the installer does not export the unreachable hasManagedFiles helper (A-021)", () => {
  // A-021: hasManagedFiles had no in-repo caller — a public surface that served
  // no behavior. This locks it out so a future dead export cannot slip back in
  // (and reasserts the module's presence checks flow through readOptional).
  assert.equal(
    "hasManagedFiles" in installerModule,
    false,
    "hasManagedFiles must not be re-exported; it had no caller and only widened the installer surface",
  );
});

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
  assert.deepEqual(manifest.configuration, {
    provider: "openrouter",
    cheapModel: "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
    deepModel: "openrouter/moonshotai/kimi-k2.6",
  });
  assert.equal(github.variables.get("PR_AGENT_MODEL_PROVIDER"), "openrouter");
  assert.equal(
    github.variables.get("CHEAP_REVIEW_MODEL"),
    "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
  );
  assert.equal(
    github.variables.get("DEEP_REVIEW_MODEL"),
    "openrouter/moonshotai/kimi-k2.6",
  );
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

test("update without model flags preserves an existing non-default configuration", async () => {
  const sourceRoot = await makeSource("name: version one\n");
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const existingConfiguration = {
    provider: "openrouter",
    cheapModel: "openrouter/moonshotai/kimi-k2.6",
    deepModel: "openrouter/moonshotai/kimi-k2.6",
  };

  await runConsumerInstaller(
    { command: "install", target, ...existingConfiguration },
    { sourceRoot, github },
  );
  const managedWorkflow = await readFile(
    path.resolve(import.meta.dirname, "..", "examples", "pr-agent-router.yml"),
    "utf8",
  );
  await writeFile(
    path.join(sourceRoot, "examples", "pr-agent-router.yml"),
    managedWorkflow,
    "utf8",
  );

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });

  assert.deepEqual((await readManifest(target)).configuration, existingConfiguration);
  assert.equal(github.variables.get("PR_AGENT_MODEL_PROVIDER"), existingConfiguration.provider);
  assert.equal(github.variables.get("CHEAP_REVIEW_MODEL"), existingConfiguration.cheapModel);
  assert.equal(github.variables.get("DEEP_REVIEW_MODEL"), existingConfiguration.deepModel);
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    managedWorkflow,
  );
  assert.match(managedWorkflow, /high-risk-route: deep/u);
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

test("resumes an update interrupted before the workflow was replaced (A-013)", async () => {
  const sourceV1 = await makeSource("name: managed v1\n");
  const sourceV2 = await makeSource("name: managed v2\n");
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });

  // Establish an active v1 installation.
  await runConsumerInstaller({ command: "install", target }, { sourceRoot: sourceV1, github });

  // Simulate an update to v2 interrupted AFTER the pending manifest was written
  // (recording the v2 hash) but BEFORE the workflow file was replaced: the
  // manifest is pending with the v2 hash while the on-disk workflow is still v1.
  const v2Content = "name: managed v2\n";
  const v2Sha = sha256Hex(v2Content);
  const interrupted = await readManifest(target);
  interrupted.state = "pending";
  interrupted.workflow.sha256 = v2Sha;
  interrupted.source.sha256 = v2Sha;
  await writeFile(
    path.join(target, MANIFEST_PATH),
    `${JSON.stringify(interrupted, null, 2)}\n`,
    "utf8",
  );

  // Re-running the update must resume rather than mistake installer-owned pending
  // state for operator modification.
  await runConsumerInstaller({ command: "update", target }, { sourceRoot: sourceV2, github });

  const resumed = await readManifest(target);
  assert.equal(resumed.state, "active");
  assert.equal(resumed.workflow.sha256, v2Sha);
  assert.equal(await readFile(path.join(target, WORKFLOW_PATH), "utf8"), v2Content);
});

test("active install still rejects an operator-modified workflow (A-013 lock)", async () => {
  const sourceRoot = await makeSource("name: managed v1\n");
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });

  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  // Operator edits the workflow of a completed (active) install.
  await writeFile(path.join(target, WORKFLOW_PATH), "name: operator edit\n", "utf8");

  await assert.rejects(
    runConsumerInstaller({ command: "update", target }, { sourceRoot, github }),
    /modified after installation/u,
  );
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

async function writeManifest(target, manifest) {
  await writeFile(
    path.join(target, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

test("resolveSourceRelease resolves the git-verified, dirty, mismatched, and override paths", () => {
  const commit = "a".repeat(40);
  const clean = { head: () => commit, exactTag: () => "v1.2.3", templateDirty: () => false };
  assert.deepEqual(
    resolveSourceRelease({ gitImpl: clean, version: "1.2.3" }),
    { commit, tag: "v1.2.3", released: true },
  );

  const dirty = { head: () => commit, exactTag: () => "v1.2.3", templateDirty: () => true };
  assert.deepEqual(
    resolveSourceRelease({ gitImpl: dirty, version: "1.2.3" }),
    { commit, tag: null, released: false },
  );

  const mismatched = { head: () => commit, exactTag: () => "v9.9.9", templateDirty: () => false };
  assert.deepEqual(
    resolveSourceRelease({ gitImpl: mismatched, version: "1.2.3" }),
    { commit, tag: null, released: false },
  );

  const untagged = { head: () => commit, exactTag: () => null, templateDirty: () => false };
  assert.deepEqual(
    resolveSourceRelease({ gitImpl: untagged, version: "1.2.3" }),
    { commit, tag: null, released: false },
  );

  const overrideCommit = "b".repeat(40);
  assert.deepEqual(
    resolveSourceRelease({ override: { tag: "v0.1.0", commit: overrideCommit } }),
    { commit: overrideCommit, tag: "v0.1.0", released: false },
  );

  assert.throws(
    () => resolveSourceRelease({ override: { tag: "v0.1.0", commit: "short" } }),
    /--source-commit must be a 40-character hex commit/u,
  );
  // A commit-only override would collide with dev's (false, null); require the tag.
  assert.throws(
    () => resolveSourceRelease({ override: { tag: null, commit: overrideCommit } }),
    /--source-tag must be a v<semver> release tag/u,
  );
  // A prerelease+build semver tag is valid.
  assert.deepEqual(
    resolveSourceRelease({ override: { tag: "v1.2.3-rc.1+build.5", commit: overrideCommit } }),
    { commit: overrideCommit, tag: "v1.2.3-rc.1+build.5", released: false },
  );
  const noGit = {
    head() {
      throw new Error("not a git repository");
    },
    exactTag: () => null,
    templateDirty: () => false,
  };
  assert.throws(
    () => resolveSourceRelease({ gitImpl: noGit, version: "1.2.3" }),
    /installer source has no git identity/u,
  );
});

test("install records git-verified released provenance from a clean tagged checkout", async () => {
  const sourceRoot = await makeSource("name: released\n", { tag: "v0.9.9", version: "0.9.9" });
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  const manifest = await readManifest(target);
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.source.commit, await sourceCommit(sourceRoot));
  assert.equal(manifest.source.tag, "v0.9.9");
  assert.equal(manifest.source.released, true);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.deepEqual(checked.issues, []);
});

test("a dirty template at a release tag records released:false", async () => {
  const sourceRoot = await makeSource("name: clean\n", { tag: "v0.9.9", version: "0.9.9" });
  // Dirty the shipped template after tagging: the bytes no longer match the tag.
  await writeFile(
    path.join(sourceRoot, "examples", "pr-agent-router.yml"),
    "name: dirtied\n",
    "utf8",
  );
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  const manifest = await readManifest(target);
  assert.equal(manifest.source.released, false);
  assert.equal(manifest.source.tag, null);
});

test("the .git-less override records a declared (false, v-tag) provenance", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const declaredCommit = "c".repeat(40);
  await runConsumerInstaller(
    { command: "install", target, sourceTag: "v0.1.0", sourceCommit: declaredCommit },
    { sourceRoot, github },
  );

  const manifest = await readManifest(target);
  assert.equal(manifest.source.commit, declaredCommit);
  assert.equal(manifest.source.tag, "v0.1.0");
  assert.equal(manifest.source.released, false);
});

test("an explicitly-empty SD_SOURCE_TAG env rejects rather than silently skipping the override", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await assert.rejects(
    runConsumerInstaller(
      { command: "install", target },
      { sourceRoot, github, env: { SD_SOURCE_TAG: "" } },
    ),
    /SD_SOURCE_TAG is set but empty/u,
  );
});

test("a schema-1 manifest decodes as pre-provenance; check flags it and update migrates it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  // Downgrade the freshly written manifest to a legacy schema-1 shape.
  const manifest = await readManifest(target);
  delete manifest.source.commit;
  delete manifest.source.tag;
  delete manifest.source.released;
  manifest.schemaVersion = 1;
  await writeManifest(target, manifest);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.ok(
    checked.issues.includes("manifest predates provenance tracking; run update to record provenance"),
    checked.issues.join("\n"),
  );

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });
  const migrated = await readManifest(target);
  assert.equal(migrated.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.match(migrated.source.commit, /^[0-9a-f]{40}$/u);
});

test("check reports a newer source commit as provenance drift", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  // A new source commit that leaves the template bytes unchanged isolates the
  // commit-drift signal from the byte-hash "newer source workflow" signal.
  await writeFile(path.join(sourceRoot, "NOTES.md"), "changed\n", "utf8");
  execFileSync("git", ["-C", sourceRoot, "add", "-A"], { stdio: "ignore" });
  gitCommit(sourceRoot, "advance");

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.ok(
    checked.issues.includes("a newer source commit is available; run update"),
    checked.issues.join("\n"),
  );
  assert.equal(
    checked.issues.includes("a newer source workflow is available; run update"),
    false,
    "byte hash is unchanged, so only commit drift should fire",
  );
});

test("check reports release-tag drift when a released manifest's tag no longer matches", async () => {
  const sourceRoot = await makeSource("name: released\n", { tag: "v0.9.9", version: "0.9.9" });
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  // Same commit, but the recorded tag drifts from the source's resolved tag.
  const manifest = await readManifest(target);
  assert.equal(manifest.source.released, true);
  manifest.source.tag = "v0.9.8";
  await writeManifest(target, manifest);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.ok(
    checked.issues.includes("recorded release provenance no longer matches the source; run update"),
    checked.issues.join("\n"),
  );
});

test("check ignores ambient SD_SOURCE_* env and stays deterministic", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  // Ambient overrides must not perturb read-only check's resolved provenance.
  const env = { SD_SOURCE_TAG: "v9.9.9", SD_SOURCE_COMMIT: "d".repeat(40) };
  const checked = await runConsumerInstaller(
    { command: "check", target },
    { sourceRoot, github, env },
  );
  assert.deepEqual(checked.issues, []);
});

test("parseArguments accepts source overrides only for install and update", () => {
  const parsed = parseArguments([
    "install",
    "--target",
    "/tmp/t",
    "--source-tag",
    "v0.1.0",
    "--source-commit",
    "a".repeat(40),
  ]);
  assert.equal(parsed.sourceTag, "v0.1.0");
  assert.equal(parsed.sourceCommit, "a".repeat(40));

  assert.throws(
    () => parseArguments(["check", "--target", "/tmp/t", "--source-tag", "v0.1.0"]),
    /check does not accept source provenance overrides/u,
  );
});

// A-005: contain every installer read/write/rename/removal beneath the
// canonical worktree without following repository-controlled symlink ancestors.

const CONTAINMENT_PATTERN = /refusing to follow a symlinked or escaping installer path/u;

async function makeExternal() {
  return mkdtemp(path.join(os.tmpdir(), "sd-review-external-"));
}

test("install rejects a symlinked .github/workflows ancestor before writing outside the target", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const external = await makeExternal();
  await mkdir(path.join(target, ".github"), { recursive: true });
  await symlink(external, path.join(target, ".github", "workflows"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    (error) => {
      assert.match(error.message, CONTAINMENT_PATTERN);
      assert.equal(error.message.includes(external), false, "must not leak the symlink target");
      return true;
    },
  );
  await assert.rejects(readFile(path.join(external, "ai-review-router.yml"), "utf8"), /ENOENT/u);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
  assert.deepEqual(github.calls, []);
});

test("install rejects a symlinked .github manifest ancestor before writing outside the target", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const external = await makeExternal();
  await symlink(external, path.join(target, ".github"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    (error) => {
      assert.match(error.message, CONTAINMENT_PATTERN);
      assert.equal(error.message.includes(external), false, "must not leak the symlink target");
      return true;
    },
  );
  await assert.rejects(readFile(path.join(external, "sd-github-review.json"), "utf8"), /ENOENT/u);
  assert.deepEqual(github.calls, []);
});

test("install through a symlinked .github ancestor creates nothing outside the target", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const external = await makeExternal();
  // .github is a symlink to an external directory. The containment guard must
  // reject before any managed directory is created beneath it — nothing is
  // created inside the external target. (A pre-existing symlink is caught by
  // the read-phase guard; component-wise mkdirWithin additionally narrows the
  // recursive-mkdir-follow window for a symlink swapped in mid-operation, a
  // race the injected-lstat harness cannot reproduce deterministically.)
  await symlink(external, path.join(target, ".github"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    CONTAINMENT_PATTERN,
  );
  // No directory was created through the symlink into the external target.
  assert.deepEqual(readdirSync(external), []);
  assert.deepEqual(github.calls, []);
});

test("install succeeds when .github already exists as a regular directory", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await mkdir(path.join(target, ".github"), { recursive: true });

  const report = await runConsumerInstaller(
    { command: "install", target },
    { sourceRoot, github },
  );
  assert.equal(report.ok, true);
  assert.equal((await readManifest(target)).state, "active");
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    "name: managed workflow\n",
  );
});

test("a replacement between plan and write fails safely without touching the external target", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  // git resolves the worktree root (e.g. /var -> /private/var on macOS), so the
  // guard inspects a realpath prefix; match the workflows dir by suffix.
  const workflowsSuffix = path.join(".github", "workflows");
  const symlinkStat = {
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  };
  // Simulate an attacker swapping .github/workflows for a symlink in the window
  // between the temp write and the rename: report a symlink only once the
  // in-flight *.tmp file exists in the directory. The pre-mkdir guard (no temp
  // yet) sees the real state and passes; the pre-rename guard catches the swap.
  const lstat = async (targetPath) => {
    if (
      targetPath.endsWith(workflowsSuffix) &&
      existsSync(targetPath) &&
      readdirSync(targetPath).some((name) => name.endsWith(".tmp"))
    ) {
      return symlinkStat;
    }
    return realLstat(targetPath);
  };

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github, lstat }),
    CONTAINMENT_PATTERN,
  );
  // The workflow was never renamed into place and no temp file leaked.
  await assert.rejects(readFile(path.join(target, WORKFLOW_PATH), "utf8"), /ENOENT/u);
  assert.deepEqual(
    readdirSync(path.join(target, ".github", "workflows")).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("a replacement between mkdir and temp write fails before writing through the swap", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const workflowsSuffix = path.join(".github", "workflows");
  const symlinkStat = {
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  };
  // Simulate an attacker swapping .github/workflows for a symlink in the window
  // between mkdir and the temp write: report a symlink only once the directory
  // exists but before any *.tmp file has been created. The pre-mkdir guard (dir
  // absent) passes; the pre-write guard must catch the swap before writeFile.
  // Without the pre-write recheck the temp write proceeds, the later pre-rename
  // guard sees the *.tmp (so this predicate is false and reports the real dir),
  // and the install would wrongly succeed.
  const lstat = async (targetPath) => {
    if (
      targetPath.endsWith(workflowsSuffix) &&
      existsSync(targetPath) &&
      !readdirSync(targetPath).some((name) => name.endsWith(".tmp"))
    ) {
      return symlinkStat;
    }
    return realLstat(targetPath);
  };

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github, lstat }),
    CONTAINMENT_PATTERN,
  );
  // No workflow file and no leaked temp: the write never happened through the swap.
  await assert.rejects(readFile(path.join(target, WORKFLOW_PATH), "utf8"), /ENOENT/u);
  assert.deepEqual(
    readdirSync(path.join(target, ".github", "workflows")).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("check reports a bounded containment error without leaking the symlink target", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const external = await makeExternal();
  await mkdir(path.join(target, ".github"), { recursive: true });
  await symlink(external, path.join(target, ".github", "workflows"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "check", target }, { sourceRoot, github }),
    (error) => {
      assert.match(error.message, CONTAINMENT_PATTERN);
      assert.equal(error.message.includes(external), false, "must not leak the symlink target");
      assert.equal(error.message.includes(target), false, "must stay bounded to the managed path");
      return true;
    },
  );
});

test("dry-run install reports a bounded containment error and mutates nothing", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  const external = await makeExternal();
  await mkdir(path.join(target, ".github"), { recursive: true });
  await symlink(external, path.join(target, ".github", "workflows"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "install", target, dryRun: true }, { sourceRoot, github }),
    (error) => {
      assert.match(error.message, CONTAINMENT_PATTERN);
      assert.equal(error.message.includes(external), false, "must not leak the symlink target");
      assert.equal(error.message.includes(target), false, "must stay bounded to the managed path");
      return true;
    },
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(external, "ai-review-router.yml"), "utf8"), /ENOENT/u);
});

// A-019: adopt a manually installed workflow into installer ownership.

const DEFAULT_CONFIG = {
  provider: "openrouter",
  cheapModel: "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
  deepModel: "openrouter/moonshotai/kimi-k2.6",
};
const ALL_LABELS = ROUTING_LABELS.map(({ name }) => name);

function fullyProvisionedGitHub() {
  return new FakeGitHub({
    variables: {
      PR_AGENT_MODEL_PROVIDER: DEFAULT_CONFIG.provider,
      CHEAP_REVIEW_MODEL: DEFAULT_CONFIG.cheapModel,
      DEEP_REVIEW_MODEL: DEFAULT_CONFIG.deepModel,
    },
    secrets: [SECRET_NAME],
    labels: ALL_LABELS,
  });
}

test("the historical adoption registry is well-formed and distinct from the current template", async () => {
  const currentTemplate = await readFile(
    path.resolve(import.meta.dirname, "..", "examples", "pr-agent-router.yml"),
    "utf8",
  );
  const currentSha = sha256Hex(currentTemplate);
  assert.ok(HISTORICAL_TEMPLATE_HASHES.length >= 1);
  for (const entry of HISTORICAL_TEMPLATE_HASHES) {
    assert.match(entry.tag, /^v[0-9]+\.[0-9]+\.[0-9]+/u);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
    assert.notEqual(entry.sha256, currentSha, "historical hash must differ from the current template");
  }
});

test("adopt brings a current manual workflow under management and preserves unowned resources", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: current source\n");
  const github = fullyProvisionedGitHub();

  const report = await runConsumerInstaller(
    { command: "adopt", target, yes: true },
    { sourceRoot, github },
  );
  assert.equal(report.ok, true);
  assert.equal(report.adoptedFrom, "current source");
  // Every GitHub resource pre-existed and matched, so adoption performs no
  // remote mutation and claims none of them.
  assert.deepEqual(github.calls, []);

  const manifest = await readManifest(target);
  assert.equal(manifest.state, "active");
  assert.equal(manifest.repository, REPOSITORY);
  assert.equal(manifest.resources.secret.owned, false);
  assert.equal(manifest.resources.variables.PR_AGENT_MODEL_PROVIDER.owned, false);
  assert.ok(manifest.resources.labels.every((label) => label.owned === false));
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    "name: current source\n",
  );

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, true, checked.issues.join("\n"));

  // Uninstall preserves resources adoption never claimed.
  await runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github });
  assert.equal(github.variables.size, 3);
  assert.equal(github.secrets.has(SECRET_NAME), true);
  assert.ok(ALL_LABELS.every((name) => github.labels.has(name)));
});

test("adopt recognizes an allow-listed historical workflow and converges it to the current source", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const legacy = "name: legacy v0.1.0 workflow\n";
  await placeManualWorkflow(target, legacy);
  const github = fullyProvisionedGitHub();

  const report = await runConsumerInstaller(
    { command: "adopt", target, yes: true },
    {
      sourceRoot,
      github,
      historicalTemplates: [{ tag: "v0.1.0", sha256: sha256Hex(legacy) }],
    },
  );
  assert.equal(report.adoptedFrom, "v0.1.0");
  assert.ok(
    report.actions.some((action) => /refresh .* from adopted v0\.1\.0 to current source/u.test(action)),
  );
  // The historical workflow was converged in place to the current source.
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    "name: current source\n",
  );
  const manifest = await readManifest(target);
  assert.equal(manifest.state, "active");
  assert.equal(manifest.source.sha256, manifest.workflow.sha256);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, true, checked.issues.join("\n"));
});

test("adopt refuses an unrecognized workflow before any mutation", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: hand-rolled by an operator\n");
  const github = fullyProvisionedGitHub();

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    /is not a recognized sd-github-review template/u,
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("adopt refuses a repository already managed by sd-github-review", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const github = fullyProvisionedGitHub();
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    /already manages this installation; use update/u,
  );
});

test("adopt refuses when no workflow exists to adopt", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const github = fullyProvisionedGitHub();

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    /nothing to adopt/u,
  );
  assert.deepEqual(github.calls, []);
});

test("adopt requires confirmation and mutates nothing when it is declined", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: current source\n");
  const github = fullyProvisionedGitHub();

  // No --yes and no confirm seam: adoption is cancelled before any mutation.
  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target }, { sourceRoot, github }),
    /adopt cancelled; pass --yes/u,
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);

  // A confirm seam that approves proceeds to an active adoption.
  await runConsumerInstaller(
    { command: "adopt", target },
    { sourceRoot, github, confirm: async () => true },
  );
  assert.equal((await readManifest(target)).state, "active");
});

test("adopt dry-run plans without confirmation or mutation", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: current source\n");
  const github = fullyProvisionedGitHub();

  const report = await runConsumerInstaller(
    { command: "adopt", target, dryRun: true },
    { sourceRoot, github },
  );
  assert.equal(report.dryRun, true);
  assert.ok(report.actions.some((action) => /write .* with active state/u.test(action)));
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("adopt fails on a provider-conflicting unowned variable before mutation", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: current source\n");
  const github = new FakeGitHub({
    secrets: [SECRET_NAME],
    labels: ALL_LABELS,
    variables: { PR_AGENT_MODEL_PROVIDER: "gemini" },
  });

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    /different unowned value/u,
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("adopt retains pending ownership after a partial GitHub failure and resumes via install", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  await placeManualWorkflow(target, "name: current source\n");
  // A manual install missing one label: adoption must create it, and that call fails.
  const github = new FakeGitHub({
    variables: {
      PR_AGENT_MODEL_PROVIDER: DEFAULT_CONFIG.provider,
      CHEAP_REVIEW_MODEL: DEFAULT_CONFIG.cheapModel,
      DEEP_REVIEW_MODEL: DEFAULT_CONFIG.deepModel,
    },
    secrets: [SECRET_NAME],
    labels: ALL_LABELS.filter((name) => name !== "review:auto"),
  });
  github.failKind = "create-label";

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    /simulated create-label failure/u,
  );
  const pending = await readManifest(target);
  assert.equal(pending.state, "pending");

  // Once adoption has written the pending manifest and converged the workflow,
  // the installation is managed; the normal lifecycle resumes it to active.
  github.failKind = null;
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });
  assert.equal((await readManifest(target)).state, "active");
  assert.ok(github.labels.has("review:auto"));
});

test("adopt rejects a symlinked workflow ancestor before reading outside the target", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const github = fullyProvisionedGitHub();
  const external = await makeExternal();
  await mkdir(path.join(target, ".github"), { recursive: true });
  await symlink(external, path.join(target, ".github", "workflows"), "dir");

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, yes: true }, { sourceRoot, github }),
    (error) => {
      assert.match(error.message, CONTAINMENT_PATTERN);
      assert.equal(error.message.includes(external), false, "must not leak the symlink target");
      return true;
    },
  );
  assert.deepEqual(github.calls, []);
});

test("parseArguments accepts adopt confirmation and rejects uninstall cleanup flags", () => {
  assert.deepEqual(
    parseArguments(["adopt", "--target", "/tmp/t", "--yes", "--provider", "openrouter"]),
    { command: "adopt", target: "/tmp/t", yes: true, provider: "openrouter" },
  );
  assert.equal(
    parseArguments(["adopt", "--source-tag", "v0.1.0", "--source-commit", "a".repeat(40)]).sourceTag,
    "v0.1.0",
  );
  assert.throws(
    () => parseArguments(["adopt", "--remove-labels"]),
    /adopt does not accept uninstall cleanup options/u,
  );
  assert.throws(
    () => parseArguments(["check", "--yes"]),
    /check does not accept --yes/u,
  );
});

// A-012: bounded subprocess timeouts for the installer's gh and git seams.
// A fake spawn/exec drives the ETIMEDOUT path with no real subprocess.
function timedOutSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), status: null, signal: "SIGTERM", stdout: "", stderr: "" };
  };
}

test("gh subprocess timeout raises a bounded error with recovery guidance", async () => {
  const calls = [];
  const github = new GitHubCli({ spawnImpl: timedOutSpawn(calls) });
  await assert.rejects(
    github.setVariable(REPOSITORY, "PR_AGENT_ROUTING_CONFIG", "value"),
    (error) => {
      assert.match(error.message, new RegExp(`timed out after ${GH_COMMAND_TIMEOUT_MS}ms`, "u"));
      assert.match(error.message, /verify no partial change was applied before retrying/u);
      assert.doesNotMatch(error.message, /the read was interrupted/u);
      return true;
    },
  );
  // The timeout and kill signal are actually passed to the child.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.timeout, GH_COMMAND_TIMEOUT_MS);
  assert.equal(calls[0].options.killSignal, "SIGTERM");
});

test("gh read-only query timeout advises a plain retry, not reconciliation", async () => {
  const github = new GitHubCli({ spawnImpl: timedOutSpawn([]) });
  // inspect() reaches gh only through runJson (repo/variable/secret/label list),
  // which carries no side effect, so a timeout must not claim a partial change.
  await assert.rejects(
    github.inspect(REPOSITORY),
    (error) => {
      assert.match(error.message, new RegExp(`timed out after ${GH_COMMAND_TIMEOUT_MS}ms`, "u"));
      assert.match(error.message, /the read was interrupted — retry once GitHub is responsive/u);
      assert.doesNotMatch(error.message, /verify no partial change/u);
      return true;
    },
  );
});

test("gh subprocess timeout redacts the secret from its error", () => {
  const github = new GitHubCli({ spawnImpl: timedOutSpawn([]) });
  const secret = "sk-live-SUPER-SECRET";
  assert.throws(
    () => github.run("gh", ["secret", "set", "--body", secret], { secret }),
    (error) => {
      assert.doesNotMatch(error.message, /SUPER-SECRET/u);
      assert.match(error.message, /\[redacted\]/u);
      return true;
    },
  );
});

test("gh nonzero-exit error redacts a secret passed in args", () => {
  const github = new GitHubCli({
    spawnImpl: () => ({ error: null, status: 1, stdout: "", stderr: "denied" }),
  });
  const secret = "sk-live-EXIT-SECRET";
  assert.throws(
    () => github.run("gh", ["secret", "set", "--body", secret], { secret }),
    (error) => {
      assert.doesNotMatch(error.message, /EXIT-SECRET/u);
      assert.match(error.message, /\[redacted\]/u);
      return true;
    },
  );
});

test("gh non-timeout spawn error is not misreported as a timeout", async () => {
  const github = new GitHubCli({
    spawnImpl: () => ({ error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }), status: null, stdout: "", stderr: "" }),
  });
  await assert.rejects(
    github.deleteSecret(REPOSITORY),
    (error) => {
      assert.match(error.message, /could not start/u);
      assert.doesNotMatch(error.message, /timed out/u);
      return true;
    },
  );
});

test("git subprocess timeout raises a bounded error with recovery guidance", () => {
  const calls = [];
  const execImpl = (command, args, options) => {
    calls.push({ command, args, options });
    throw Object.assign(new Error("git timed out"), { code: "ETIMEDOUT" });
  };
  const git = makeSourceGit("/some/source/root", execImpl);
  assert.throws(
    () => git.head(),
    (error) => {
      assert.match(error.message, new RegExp(`timed out after ${GIT_COMMAND_TIMEOUT_MS}ms`, "u"));
      // git reads have no side effect to reconcile — recovery is a plain retry.
      assert.match(error.message, /the read was interrupted — retry/u);
      assert.doesNotMatch(error.message, /partial change/u);
      return true;
    },
  );
  assert.equal(calls[0].options.timeout, GIT_COMMAND_TIMEOUT_MS);
  assert.equal(calls[0].options.killSignal, "SIGTERM");
});

test("git non-timeout failure keeps its diagnostic and is not a timeout", () => {
  const execImpl = () => {
    throw Object.assign(new Error("fatal: not a git repository"), { stderr: "fatal: not a git repository" });
  };
  const git = makeSourceGit("/some/source/root", execImpl);
  assert.throws(
    () => git.head(),
    (error) => {
      assert.match(error.message, /not a git repository/u);
      assert.doesNotMatch(error.message, /timed out/u);
      return true;
    },
  );
});
