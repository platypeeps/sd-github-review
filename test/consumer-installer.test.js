import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  ROUTING_LABELS,
  SECRET_NAME,
  WORKFLOW_PATH,
  parseArguments,
  parseGitHubRemote,
  resolveSourceRelease,
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
