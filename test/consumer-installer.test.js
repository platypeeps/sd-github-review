import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  lstat as realLstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DESCRIPTOR_PATH,
  DESCRIPTOR_SOURCE_PATH,
  DURABLE_TEMPLATE_PATH,
  DURABLE_WORKFLOW_PATH,
  GH_COMMAND_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  GitHubCli,
  HISTORICAL_TEMPLATE_HASHES,
  MANAGED_RESOURCES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  MANAGED_VARIABLE_NAMES,
  ROUTE_MODES,
  ROUTING_LABELS,
  SECRET_NAME,
  TEMPLATE_PATH,
  WORKFLOW_PATH,
  makeSourceGit,
  parseArguments,
  parseGitHubRemote,
  resolveSourceRelease,
  routeModeNeedsProviderSecret,
  runConsumerInstaller,
  variableValues,
  variableValuesForSchema,
} from "../scripts/consumer-installer.mjs";
import { ROUTES as ACTION_ROUTES } from "../src/protocol.js";
import { reviewLabelNames } from "../src/normalize.js";
import * as installerModule from "../scripts/consumer-installer.mjs";

const REPOSITORY = "acme/consumer";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// install and adopt require an explicit route mode, so every lifecycle test
// that is not itself about route resolution has to pass one. Naming the value
// once keeps those call sites from becoming 60 independent claims about which
// route a test repository runs; the tests below the REVIEW_ROUTE_MODE ownership
// banner keep their literals, because there the value is the thing under test.
const TEST_ROUTE_MODE = "copilot";

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
async function makeSource(
  workflow = "name: managed workflow\n",
  {
    tag,
    version,
    durableWorkflow = "name: SD routed review\n",
    descriptor =
      '{"integrationId":"sd-github-review","workflow":' +
      '{"name":"SD routed review","path":".github/workflows/sd-review.yml",' +
      '"dispatchEvent":"workflow_dispatch"}}\n',
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-source-"));
  await mkdir(path.join(root, "examples"));
  await mkdir(path.join(root, "contract"));
  await writeFile(path.join(root, "examples", "pr-agent-router.yml"), workflow, "utf8");
  // The durable lane's two additional source artifacts. Distinct bytes per
  // source so a test that dirties one cannot be satisfied by another.
  await writeFile(path.join(root, DURABLE_TEMPLATE_PATH), durableWorkflow, "utf8");
  await writeFile(path.join(root, DESCRIPTOR_SOURCE_PATH), descriptor, "utf8");
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

// Reduce a manifest's managed variable block to exactly what a manifest at the
// given schema version records. Every downgrade shim below needs this because
// the decoder compares the variable name set by exact equality against the tier
// the manifest declares — a schema-2 manifest carrying REVIEW_ROUTE_MODE or a
// backend descriptor is as malformed as one missing a variable it should have.
//
// Derived from the production table rather than listing the names to delete, so
// a variable joining at a future tier is dropped here without another edit. The
// old form named REVIEW_ROUTE_MODE explicitly and silently stopped covering the
// tier boundary the moment a second variable joined above it.
function retainVariablesForSchema(manifest, schemaVersion) {
  const managed = variableValuesForSchema(manifest.configuration, schemaVersion);
  for (const name of Object.keys(manifest.resources.variables)) {
    if (!(name in managed)) delete manifest.resources.variables[name];
  }
}

// Every path a complete installation owns: the manifest plus each managed
// resource's destination, derived from the production table so a resource added
// there is asserted on by the idempotency and uninstall checks below without a
// second edit here.
const MANAGED_PATHS = [MANIFEST_PATH, ...MANAGED_RESOURCES.map((r) => r.destination)];

async function writeManagedFile(target, relativePath, content) {
  await mkdir(path.dirname(path.join(target, relativePath)), { recursive: true });
  await writeFile(path.join(target, relativePath), content, "utf8");
}

// Bytes plus mtime for every file the installer manages, so a test can assert
// that a run left them untouched rather than merely rewrote identical bytes.
async function managedFileState(target) {
  const state = {};
  for (const relativePath of MANAGED_PATHS) {
    const absolute = path.join(target, relativePath);
    try {
      state[relativePath] = {
        content: await readFile(absolute, "utf8"),
        mtimeMs: (await realLstat(absolute)).mtimeMs,
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state[relativePath] = null;
    }
  }
  return state;
}

// The durable resources, parameterizing the guard tests so each one is asserted
// for both rather than for the workflow and by assumption for the descriptor.
// The set, its destinations, and its source paths are read from the production
// table rather than restated, so adding a resource there extends this coverage
// instead of silently leaving the new resource untested. Only the per-resource
// replacement bytes are test-owned, since no production value supplies them.
const FRESH_BYTES = {
  descriptor: '{"integrationId":"sd-github-review","revised":true}\n',
  durableWorkflow: "name: SD routed review\n# revised\n",
};
const DURABLE_CASES = MANAGED_RESOURCES.filter((resource) => resource.durable).map(
  ({ field, destination, source }) => ({
    field,
    destination,
    sourcePath: source,
    sourceOption: field,
    freshBytes: FRESH_BYTES[field],
  }),
);

test("every durable managed resource is covered by the parameterized guard cases", () => {
  // The coverage that makes the derivation above load-bearing: a resource added
  // to MANAGED_RESOURCES without replacement bytes here would otherwise produce
  // a case with `freshBytes: undefined` and quietly assert nothing.
  assert.deepEqual(
    DURABLE_CASES.map((item) => item.field).sort(),
    ["descriptor", "durableWorkflow"],
  );
  for (const item of DURABLE_CASES) {
    assert.equal(typeof item.freshBytes, "string", `${item.field} needs replacement bytes`);
    assert.notEqual(item.freshBytes, "");
  }
});

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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
    /no readable GitHub origin; configure origin or pass --github OWNER\/REPO/u,
  );
  assert.deepEqual(github.calls, []);
});

test("installer labels stay aligned with the router contract", () => {
  assert.deepEqual(
    new Set(ROUTING_LABELS.map(({ name }) => name)),
    new Set(reviewLabelNames),
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
    { command: "install", target, routeMode: TEST_ROUTE_MODE, secretMode: "stdin", secretInput: secret },
    { sourceRoot, github },
  );
  const manifest = await readManifest(target);
  assert.equal(manifest.state, "active");
  assert.equal(manifest.repository, REPOSITORY);
  assert.deepEqual(manifest.configuration, {
    provider: "openrouter",
    cheapModel: "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
    deepModel: "openrouter/moonshotai/kimi-k2.6",
    routeMode: TEST_ROUTE_MODE,
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
  // AC 6 / D4. Counting GitHub calls alone passed while every managed file was
  // rewritten on every run, which is how this looked satisfied when it was not.
  // A converged second run must perform no work at all: no planned actions and
  // no filesystem write, asserted through both bytes and mtime.
  const managedBefore = await managedFileState(target);
  const second = await runConsumerInstaller(
    { command: "install", target, routeMode: TEST_ROUTE_MODE },
    { sourceRoot, github },
  );
  assert.equal(second.ok, true);
  assert.equal(github.calls.length, callsAfterFirst);
  assert.deepEqual(second.actions, [], "a converged second run plans no actions");
  assert.deepEqual(
    await managedFileState(target),
    managedBefore,
    "a converged second run rewrites no managed file",
  );

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
    routeMode: TEST_ROUTE_MODE,
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
    routeMode: TEST_ROUTE_MODE,
  };

  await runConsumerInstaller(
    { command: "install", target, routeMode: TEST_ROUTE_MODE, ...existingConfiguration },
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
      { command: "install", target: targetWithWorkflow, routeMode: TEST_ROUTE_MODE },
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
      { command: "install", target: targetWithVariable, routeMode: TEST_ROUTE_MODE },
      { sourceRoot, github: conflictingGitHub },
    ),
    /different unowned value/u,
  );
  await assert.rejects(
    runConsumerInstaller(
      { command: "install", target: targetWithVariable, routeMode: TEST_ROUTE_MODE, repository: "acme/other" },
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
        routeMode: TEST_ROUTE_MODE,
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
    /simulated create-label failure/u,
  );
  const pending = await readManifest(target);
  assert.equal(pending.state, "pending");
  assert.equal(pending.resources.variables.PR_AGENT_MODEL_PROVIDER.owned, true);

  github.failKind = null;
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot: sourceV1, github });

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

  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
    { command: "install", target, routeMode: TEST_ROUTE_MODE, dryRun: true, secretMode: "stdin" },
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
    { command: "install", target, routeMode: TEST_ROUTE_MODE, sourceTag: "v0.1.0", sourceCommit: declaredCommit },
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
      { command: "install", target, routeMode: TEST_ROUTE_MODE },
      { sourceRoot, github, env: { SD_SOURCE_TAG: "" } },
    ),
    /SD_SOURCE_TAG is set but empty/u,
  );
});

test("a schema-1 manifest decodes as pre-provenance; check flags it and update migrates it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

  // Downgrade the freshly written manifest to a legacy schema-1 shape.
  const manifest = await readManifest(target);
  delete manifest.source.commit;
  delete manifest.source.tag;
  delete manifest.source.released;
  delete manifest.descriptor;
  delete manifest.durableWorkflow;
  delete manifest.configuration.routeMode;
  retainVariablesForSchema(manifest, 1);
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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
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
    { command: "install", target, routeMode: TEST_ROUTE_MODE },
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github, lstat }),
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github, lstat }),
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
    runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE, dryRun: true }, { sourceRoot, github }),
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

// Every managed variable already set by hand at exactly the value the installer
// would synthesize — the shape of a consumer whose lane a human wired up. That
// is the only way its lane ever ran, and adoption must claim each one unowned
// rather than rewrite it.
//
// Derived from the managed table rather than listed, so a variable joining it
// is pre-provisioned here too. Listing them by hand is what made this helper
// need editing every time the table grew.
const FULLY_PROVISIONED_VARIABLES = variableValues({ ...DEFAULT_CONFIG, routeMode: "copilot" });

function fullyProvisionedGitHub() {
  return new FakeGitHub({
    variables: { ...FULLY_PROVISIONED_VARIABLES },
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
    { command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true },
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
  assert.equal(github.variables.size, Object.keys(FULLY_PROVISIONED_VARIABLES).length);
  assert.equal(
    github.variables.get("REVIEW_ROUTE_MODE"),
    "copilot",
    "a route variable adoption found already set is unowned, so uninstall must leave it",
  );
  assert.equal(
    github.variables.get("SD_REVIEW_CHEAP_BACKEND_V1"),
    FULLY_PROVISIONED_VARIABLES.SD_REVIEW_CHEAP_BACKEND_V1,
    "a backend descriptor adoption found already set is unowned, so uninstall must leave it",
  );
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
    { command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true },
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
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
    /is not a recognized sd-github-review template/u,
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);
});

test("adopt refuses a repository already managed by sd-github-review", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const github = fullyProvisionedGitHub();
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
    /already manages this installation; use update/u,
  );
});

test("adopt refuses when no workflow exists to adopt", async () => {
  const sourceRoot = await makeSource("name: current source\n");
  const target = await makeTarget();
  const github = fullyProvisionedGitHub();

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
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
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
    /adopt cancelled; pass --yes/u,
  );
  assert.deepEqual(github.calls, []);
  await assert.rejects(readFile(path.join(target, MANIFEST_PATH), "utf8"), /ENOENT/u);

  // A confirm seam that approves proceeds to an active adoption.
  await runConsumerInstaller(
    { command: "adopt", target, routeMode: TEST_ROUTE_MODE },
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
    { command: "adopt", target, routeMode: TEST_ROUTE_MODE, dryRun: true },
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
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
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
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
    /simulated create-label failure/u,
  );
  const pending = await readManifest(target);
  assert.equal(pending.state, "pending");

  // Once adoption has written the pending manifest and converged the workflow,
  // the installation is managed; the normal lifecycle resumes it to active.
  github.failKind = null;
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
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
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
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

test("gh read-only runJson timeout advises a plain retry, not reconciliation", () => {
  const github = new GitHubCli({ spawnImpl: timedOutSpawn([]) });
  // A read-only query carries no side effect, so a timeout must not claim a
  // partial change. inspect() now uses the async seam (covered separately); this
  // pins the read-only wording on the synchronous runJson path.
  assert.throws(
    () => github.runJson("gh", ["repo", "view", REPOSITORY, "--json", "nameWithOwner"]),
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

// A-022: inspect() fans its four independent reads out through the async
// execFile seam. This fake resolves per-query JSON after yielding, and tracks
// how many reads are in flight at once so the test can prove they overlap.
function concurrentInspectExec(inFlight) {
  return async (command, args) => {
    inFlight.now += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await Promise.resolve();
    await Promise.resolve();
    inFlight.now -= 1;
    const subcommand = args[0];
    if (subcommand === "repo") {
      return { stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: "" };
    }
    if (subcommand === "variable") {
      return { stdout: JSON.stringify([{ name: "PR_AGENT_ROUTING_CONFIG", value: "cfg" }]), stderr: "" };
    }
    if (subcommand === "secret") {
      return { stdout: JSON.stringify([{ name: SECRET_NAME }]), stderr: "" };
    }
    if (subcommand === "label") {
      return { stdout: JSON.stringify([{ name: "review:auto", color: "ededed", description: "d" }]), stderr: "" };
    }
    throw new Error(`unexpected gh read: ${subcommand}`);
  };
}

test("inspect issues its four reads concurrently through the async seam (A-022)", async () => {
  const inFlight = { now: 0, max: 0 };
  const github = new GitHubCli({
    execImpl: concurrentInspectExec(inFlight),
    // inspect must go through the async seam, never the synchronous mutation path.
    spawnImpl: () => {
      throw new Error("inspect must not use the synchronous spawn path");
    },
  });
  const snapshot = await github.inspect(REPOSITORY);
  assert.equal(inFlight.max, 4, "all four inspect reads should be in flight at once");
  assert.equal(snapshot.repository, REPOSITORY);
  assert.equal(snapshot.variables.get("PR_AGENT_ROUTING_CONFIG"), "cfg");
  assert.equal(snapshot.secrets.has(SECRET_NAME), true);
  assert.equal(snapshot.labels.get("review:auto").color, "ededed");
});

test("inspect async read timeout advises a plain retry, not reconciliation (A-022)", async () => {
  // The read-only timeout guidance (A-012) must survive the move to the async
  // seam: a killSignal-timeout carries no error code.
  const github = new GitHubCli({
    execImpl: async () => {
      throw Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
    },
  });
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

test("inspect async nonzero exit surfaces a command failure, not a timeout (A-022)", async () => {
  const github = new GitHubCli({
    execImpl: async () => {
      throw Object.assign(new Error("gh failed"), { code: 1, stdout: "", stderr: "denied" });
    },
  });
  await assert.rejects(github.inspect(REPOSITORY), (error) => {
    assert.doesNotMatch(error.message, /timed out/u);
    return true;
  });
});

test("inspect async maxBuffer kill is not misreported as a timeout (A-022 C-1)", async () => {
  // execFile kills the child with killSignal on a maxBuffer overflow too, but
  // that rejection carries a string code — it must not be read as a timeout.
  const github = new GitHubCli({
    execImpl: async () => {
      throw Object.assign(new Error("stdout maxBuffer length exceeded"), {
        killed: true,
        signal: "SIGTERM",
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      });
    },
  });
  await assert.rejects(github.inspect(REPOSITORY), (error) => {
    assert.doesNotMatch(error.message, /timed out/u);
    assert.match(error.message, /could not start/u);
    return true;
  });
});

test("inspect async ENOENT is reported as could-not-start, not a timeout (A-022)", async () => {
  const github = new GitHubCli({
    execImpl: async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    },
  });
  await assert.rejects(github.inspect(REPOSITORY), (error) => {
    assert.match(error.message, /could not start/u);
    assert.doesNotMatch(error.message, /timed out/u);
    return true;
  });
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

// ---------------------------------------------------------------------------
// Durable lane: the descriptor and .github/workflows/sd-review.yml. Every guard
// below is asserted for both resources, because "handled exactly like the
// workflow" is a claim about five separate mechanisms, not one.
// ---------------------------------------------------------------------------

test("a fresh install writes the descriptor and the durable workflow beside the event-driven one", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

  assert.equal(
    await readFile(path.join(target, DESCRIPTOR_PATH), "utf8"),
    await readFile(path.join(sourceRoot, DESCRIPTOR_SOURCE_PATH), "utf8"),
    "the descriptor is installed verbatim, not rendered",
  );
  assert.equal(
    await readFile(path.join(target, DURABLE_WORKFLOW_PATH), "utf8"),
    await readFile(path.join(sourceRoot, DURABLE_TEMPLATE_PATH), "utf8"),
  );
  // D2 non-regression: the event-driven lane every existing consumer relies on
  // is still installed from its own template, unchanged.
  assert.equal(
    await readFile(path.join(target, WORKFLOW_PATH), "utf8"),
    await readFile(path.join(sourceRoot, "examples", "pr-agent-router.yml"), "utf8"),
  );

  const manifest = await readManifest(target);
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.descriptor.path, DESCRIPTOR_PATH);
  assert.equal(manifest.descriptor.source, DESCRIPTOR_SOURCE_PATH);
  assert.equal(manifest.durableWorkflow.path, DURABLE_WORKFLOW_PATH);
  assert.equal(manifest.durableWorkflow.source, DURABLE_TEMPLATE_PATH);
});

test("the installed durable workflow sits at the path the installed descriptor declares", async () => {
  // AC 2. Read both from the consumer after install and compare them to each
  // other; a literal on either side would pass while the two drifted together.
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

  const installed = JSON.parse(await readFile(path.join(target, DESCRIPTOR_PATH), "utf8"));
  assert.equal(DURABLE_WORKFLOW_PATH, installed.workflow.path);
  assert.equal(existsSync(path.join(target, installed.workflow.path)), true);
});

for (const { field, destination, sourceOption, freshBytes } of DURABLE_CASES) {
  test(`install refuses a pre-existing unmanaged ${destination}`, async () => {
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await writeManagedFile(target, destination, "operator content\n");

    await assert.rejects(
      runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github }),
      new RegExp(`${destination.replace(/[./]/gu, "\\$&")} exists and is not managed`, "u"),
    );
    assert.equal(await readFile(path.join(target, destination), "utf8"), "operator content\n");
    assert.equal(existsSync(path.join(target, MANIFEST_PATH)), false);
    assert.deepEqual(github.calls, [], "the collision is refused before any mutation");
  });

  test(`check reports ${destination} drift against its managed hash`, async () => {
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
    await writeManagedFile(target, destination, "operator edit\n");

    const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
    assert.equal(checked.ok, false);
    assert.ok(
      checked.issues.includes(`${destination} differs from its managed hash`),
      checked.issues.join("\n"),
    );
  });

  test(`update refuses to clobber an operator-modified ${destination}`, async () => {
    // Separate from the check-drift guard: check reporting drift does nothing to
    // stop a direct update from overwriting the file.
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
    await writeManagedFile(target, destination, "operator edit\n");

    await assert.rejects(
      runConsumerInstaller({ command: "update", target }, { sourceRoot, github }),
      /was modified after installation/u,
    );
    assert.equal(
      await readFile(path.join(target, destination), "utf8"),
      "operator edit\n",
      "the operator edit survives the refused update byte-for-byte",
    );
  });

  test(`uninstall refuses to remove an operator-modified ${destination}`, async () => {
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
    await writeManagedFile(target, destination, "operator edit\n");

    await assert.rejects(
      runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github }),
      /was modified; refusing to remove operator changes/u,
    );
    assert.equal(existsSync(path.join(target, destination)), true);
    assert.equal(existsSync(path.join(target, MANIFEST_PATH)), true);
  });

  test(`check reports a newer source for ${destination}`, async () => {
    // Without this, a consumer stays "healthy" on an obsolete descriptor or
    // durable workflow after a later release changes it.
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

    const manifest = await readManifest(target);
    await writeFile(path.join(sourceRoot, manifest[field].source), freshBytes, "utf8");

    const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
    assert.equal(checked.ok, false);
    assert.ok(
      checked.issues.includes(`a newer source ${manifest[field].source} is available; run update`),
      checked.issues.join("\n"),
    );
    assert.equal(
      checked.issues.includes(`${destination} differs from its managed hash`),
      false,
      "a newer source is not local drift",
    );
  });

  test(`a dirty ${sourceOption} source records released:false`, async () => {
    // released:true asserts the installed bytes came from the tagged release.
    // Checking only the event-driven template would let a dirty copy of this
    // source ship under a clean tagged provenance claim.
    const sourceRoot = await makeSource("name: clean\n", { tag: "v0.9.9", version: "0.9.9" });
    const manifestSourcePath = field === "descriptor" ? DESCRIPTOR_SOURCE_PATH : DURABLE_TEMPLATE_PATH;
    await writeFile(path.join(sourceRoot, manifestSourcePath), freshBytes, "utf8");
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });

    const manifest = await readManifest(target);
    assert.equal(manifest.source.released, false);
    assert.equal(manifest.source.tag, null);
  });
}

test("uninstall removes the manifest and every managed file", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
  await runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github });

  for (const relativePath of MANAGED_PATHS) {
    assert.equal(existsSync(path.join(target, relativePath)), false, `${relativePath} must be removed`);
  }
});

test("adopt installs the durable resources and finishes with no check issues", async () => {
  // adopt promises the adopted install behaves exactly like a fresh one. Under
  // schema 3 that means writing the two resources it never used to write, or the
  // manifest records blocks for files that are not there.
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await placeManualWorkflow(target, await readFile(path.join(sourceRoot, "examples", "pr-agent-router.yml"), "utf8"));

  await runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github });

  assert.equal(existsSync(path.join(target, DESCRIPTOR_PATH)), true);
  assert.equal(existsSync(path.join(target, DURABLE_WORKFLOW_PATH)), true);
  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.deepEqual(checked.issues, []);
});

test("adopt refuses a pre-existing unmanaged durable workflow before any mutation", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await placeManualWorkflow(target, await readFile(path.join(sourceRoot, "examples", "pr-agent-router.yml"), "utf8"));
  await writeManagedFile(target, DURABLE_WORKFLOW_PATH, "hand-placed\n");

  await assert.rejects(
    runConsumerInstaller({ command: "adopt", target, routeMode: TEST_ROUTE_MODE, yes: true }, { sourceRoot, github }),
    /exists and is not managed by sd-github-review/u,
  );
  assert.equal(await readFile(path.join(target, DURABLE_WORKFLOW_PATH), "utf8"), "hand-placed\n");
  assert.equal(existsSync(path.join(target, MANIFEST_PATH)), false);
});

// --- D3b: migrating a schema-2 installation, where no hash is recorded yet ---

// Reduce a freshly installed schema-3 consumer to the schema-2 shape a live
// fleet consumer actually has: provenance recorded, durable resources absent.
async function downgradeToSchema2(target) {
  const manifest = await readManifest(target);
  delete manifest.descriptor;
  delete manifest.durableWorkflow;
  // Route-mode ownership arrived at schema 4, so a manifest presented as
  // schema 2 must not carry it: the decoder checks the managed variable set by
  // exact equality against the tier the manifest declares.
  delete manifest.configuration.routeMode;
  retainVariablesForSchema(manifest, 2);
  manifest.schemaVersion = 2;
  await writeFile(path.join(target, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await removeManagedFile(target, DESCRIPTOR_PATH);
  await removeManagedFile(target, DURABLE_WORKFLOW_PATH);
  return manifest;
}

async function removeManagedFile(target, relativePath) {
  const absolute = path.join(target, relativePath);
  if (existsSync(absolute)) await rm(absolute);
}

test("check reports a schema-2 installation as needing the durable lane, and update migrates it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
  await downgradeToSchema2(target);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.ok(
    checked.issues.includes(
      "manifest predates the durable review lane; run update to install the descriptor and sd-review.yml",
    ),
    checked.issues.join("\n"),
  );
  assert.equal(
    checked.issues.includes("manifest predates provenance tracking; run update to record provenance"),
    false,
    "a schema-2 manifest already records provenance",
  );

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });
  const migrated = await readManifest(target);
  assert.equal(migrated.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(existsSync(path.join(target, DESCRIPTOR_PATH)), true);
  assert.equal(existsSync(path.join(target, DURABLE_WORKFLOW_PATH)), true);
  const rechecked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.deepEqual(rechecked.issues, []);
});

for (const { destination } of DURABLE_CASES) {
  test(`migrating a schema-2 install refuses a hand-placed differing ${destination}`, async () => {
    // The overwrite guard cannot fire here: a schema-2 manifest records no hash
    // to compare against, so without a collision guard the unconditional write
    // path would silently clobber the hand-placed file.
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
    await downgradeToSchema2(target);
    await writeManagedFile(target, destination, "hand placed by an operator\n");

    await assert.rejects(
      runConsumerInstaller({ command: "update", target }, { sourceRoot, github }),
      /exists and is not managed by sd-github-review/u,
    );
    assert.equal(
      await readFile(path.join(target, destination), "utf8"),
      "hand placed by an operator\n",
      "the hand-placed file survives byte-for-byte",
    );
    assert.equal((await readManifest(target)).schemaVersion, 2, "the refusal precedes any mutation");
  });

  test(`migrating a schema-2 install adopts a byte-identical ${destination} without rewriting it`, async () => {
    // Refusing here would strand exactly the hand-placed installs this task
    // exists to bring under management.
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub({ secrets: [SECRET_NAME] });
    await runConsumerInstaller({ command: "install", target, routeMode: TEST_ROUTE_MODE }, { sourceRoot, github });
    const schema2Manifest = await downgradeToSchema2(target);
    const sourcePath = destination === DESCRIPTOR_PATH ? DESCRIPTOR_SOURCE_PATH : DURABLE_TEMPLATE_PATH;
    const sourceBytes = await readFile(path.join(sourceRoot, sourcePath), "utf8");
    await writeManagedFile(target, destination, sourceBytes);
    const before = (await realLstat(path.join(target, destination))).mtimeMs;

    await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });

    const migrated = await readManifest(target);
    assert.equal(migrated.schemaVersion, MANIFEST_SCHEMA_VERSION);
    assert.equal(await readFile(path.join(target, destination), "utf8"), sourceBytes);
    assert.equal(
      (await realLstat(path.join(target, destination))).mtimeMs,
      before,
      "an adopted byte-identical file is recorded, not rewritten",
    );
    assert.equal(schema2Manifest.schemaVersion, 2);
  });
}

// The installer's accepted route-mode values and the installed lane's own gate
// are two literals in two files. A variable this installer writes but the lane
// rejects fails the pull request it was supposed to route, so the two sets are
// bound here by extraction rather than by restating the list a third time.
function laneRouteModeGate() {
  const source = readFileSync(path.join(REPO_ROOT, TEMPLATE_PATH), "utf8");
  const lines = source.split("\n");
  const caseIndex = lines.findIndex((line) => line.includes('case "$REVIEW_ROUTE_MODE" in'));
  assert.notEqual(caseIndex, -1, "the lane must gate on REVIEW_ROUTE_MODE with a case statement");
  const pattern = lines.slice(caseIndex + 1).find((line) => line.trim().length > 0);
  const match = pattern.trim().match(/^([A-Za-z|]+)\)$/u);
  assert.ok(match, `expected an accepted-value pattern, got ${pattern.trim()}`);
  const invalidMessage = lines.find((line) => line.includes("must be one of"));
  assert.ok(invalidMessage, "the lane must reject an invalid value with a message naming the set");
  return { accepted: match[1].split("|"), invalidMessage };
}

test("installer route modes stay identical to the lane's accepted set", () => {
  const { accepted } = laneRouteModeGate();
  assert.deepEqual(
    [...accepted].sort(),
    [...ROUTE_MODES].sort(),
    "examples/pr-agent-router.yml and ROUTE_MODES accept different route sets",
  );
});

test("the lane's invalid-route message names every accepted mode", () => {
  const { invalidMessage } = laneRouteModeGate();
  for (const mode of ROUTE_MODES) {
    assert.ok(
      new RegExp(`\\b${mode}\\b`, "u").test(invalidMessage),
      `the invalid-route error omits ${mode}`,
    );
  }
});

// The operator-facing docs carry runnable install invocations, and a required
// flag added to the CLI does not fail anything when a document forgets it. The
// file list is enumerated from the tracked tree rather than restated, so a new
// operator document is covered the day it is added. Records under `.trellis/`
// are excluded deliberately: archived task artifacts quote historical commands
// and the spec quotes a `[options]` placeholder, neither of which is runnable.
function documentedInstallInvocations() {
  const files = execFileSync("git", ["ls-files", "*.md"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file.length > 0 && !file.startsWith(".trellis/"));
  const invocations = [];
  for (const file of files) {
    // Rejoin shell line continuations so a multi-line invocation reads as one.
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8").replace(/\\\n\s*/gu, " ");
    for (const line of source.split("\n")) {
      if (line.includes("install-consumer.mjs install")) invocations.push({ file, line });
    }
  }
  return invocations;
}

test("every documented install invocation passes the required --route-mode", () => {
  const invocations = documentedInstallInvocations();
  assert.ok(invocations.length > 0, "no documented install invocation found to check");
  for (const { file, line } of invocations) {
    const match = line.match(/--route-mode\s+(\S+)/u);
    assert.ok(match, `${file} documents an install without --route-mode: ${line.trim()}`);
    assert.ok(
      ROUTE_MODES.includes(match[1]),
      `${file} documents --route-mode ${match[1]}, which the installer rejects`,
    );
  }
});

// --- REVIEW_ROUTE_MODE ownership -------------------------------------------
// One test per acceptance criterion of 08-15-installer-managed-route-mode. The
// drift binding between ROUTE_MODES and the lane's own gate lives above.

test("install creates REVIEW_ROUTE_MODE and records it owned in the manifest", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });

  await runConsumerInstaller(
    { command: "install", target, routeMode: "deep" },
    { sourceRoot, github },
  );

  assert.equal(github.variables.get("REVIEW_ROUTE_MODE"), "deep");
  const manifest = await readManifest(target);
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.configuration.routeMode, "deep");
  assert.deepEqual(manifest.resources.variables.REVIEW_ROUTE_MODE, {
    value: "deep",
    owned: true,
  });
});

test("install refuses without a route mode rather than choosing one", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    /install requires --route-mode/u,
  );
  // The refusal precedes every mutation: `auto` can select cheap or deep and
  // bill the provider key, so a half-installed consumer is not an acceptable
  // intermediate state to leave behind.
  assert.deepEqual(github.calls, []);
  assert.equal(existsSync(path.join(target, MANIFEST_PATH)), false);
});

test("check names REVIEW_ROUTE_MODE when it is deleted after a successful install", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller(
    { command: "install", target, routeMode: "copilot" },
    { sourceRoot, github },
  );
  assert.equal(
    (await runConsumerInstaller({ command: "check", target }, { sourceRoot, github })).ok,
    true,
  );

  github.variables.delete("REVIEW_ROUTE_MODE");

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.ok(
    checked.issues.includes("GitHub variable REVIEW_ROUTE_MODE is missing"),
    checked.issues.join("\n"),
  );
});

test("uninstall removes an installer-created route variable", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller(
    { command: "install", target, routeMode: "cheap" },
    { sourceRoot, github },
  );

  await runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github });

  assert.equal(github.variables.has("REVIEW_ROUTE_MODE"), false);
});

test("install adopts a pre-existing route variable unowned and uninstall preserves it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({
    secrets: [SECRET_NAME],
    variables: { REVIEW_ROUTE_MODE: "none" },
  });

  // No --route-mode: the value the repository already carries resolves the run,
  // which is the manual-install path this installer is converging.
  await runConsumerInstaller({ command: "install", target }, { sourceRoot, github });

  const manifest = await readManifest(target);
  assert.deepEqual(manifest.resources.variables.REVIEW_ROUTE_MODE, {
    value: "none",
    owned: false,
  });
  assert.equal(
    github.calls.some((call) => call.name === "REVIEW_ROUTE_MODE"),
    false,
    "a matching pre-existing variable is claimed, not rewritten",
  );

  await runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github });
  assert.equal(github.variables.get("REVIEW_ROUTE_MODE"), "none");
});

test("install refuses a pre-existing route variable holding an unsupported value", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({
    secrets: [SECRET_NAME],
    variables: { REVIEW_ROUTE_MODE: "sometimes" },
  });

  await assert.rejects(
    runConsumerInstaller({ command: "install", target }, { sourceRoot, github }),
    /REVIEW_ROUTE_MODE holds an unsupported value/u,
  );
  assert.deepEqual(github.calls, []);
});

test("a schema-3 manifest decodes, reports only the route-mode migration, and update migrates it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller(
    { command: "install", target, routeMode: "copilot" },
    { sourceRoot, github },
  );

  // Present the installed consumer as the schema-3 shape the fleet is running:
  // three managed variables, no recorded route mode, the variable itself still
  // set by hand on the repository.
  const manifest = await readManifest(target);
  delete manifest.configuration.routeMode;
  retainVariablesForSchema(manifest, 3);
  manifest.schemaVersion = 3;
  await writeFile(
    path.join(target, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.deepEqual(
    checked.issues,
    ["manifest predates route-mode management; run update to record REVIEW_ROUTE_MODE"],
    "an un-migrated manifest reports the migration and nothing else",
  );
  assert.equal(
    checked.issues.some((issue) => issue.includes("durable review lane")),
    false,
    "schema 3 already has the durable lane; the ladder must not misname its tier",
  );

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });

  const migrated = await readManifest(target);
  assert.equal(migrated.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(migrated.resources.variables.REVIEW_ROUTE_MODE, {
    value: "copilot",
    owned: false,
  });
  assert.equal(
    (await runConsumerInstaller({ command: "check", target }, { sourceRoot, github })).ok,
    true,
  );
});

test("a schema-4 manifest reports the missing backend descriptors, and update provisions them", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller(
    { command: "install", target, routeMode: "copilot" },
    { sourceRoot, github },
  );

  // Present the installed consumer as the schema-4 shape sd-github-review itself
  // is running: route mode managed, neither backend descriptor present — on the
  // repository as well as in the manifest. Deleting them from GitHub too is what
  // makes this the real defect rather than a manifest-only shim; without it the
  // check below would pass on variables the install had just created.
  const manifest = await readManifest(target);
  retainVariablesForSchema(manifest, 4);
  manifest.schemaVersion = 4;
  await writeManifest(target, manifest);
  github.variables.delete("SD_REVIEW_CHEAP_BACKEND_V1");
  github.variables.delete("SD_REVIEW_DEEP_BACKEND_V1");

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.issues.sort(), [
    "GitHub variable SD_REVIEW_CHEAP_BACKEND_V1 is missing",
    "GitHub variable SD_REVIEW_DEEP_BACKEND_V1 is missing",
    "manifest predates durable backend management; run update to record SD_REVIEW_CHEAP_BACKEND_V1 and SD_REVIEW_DEEP_BACKEND_V1",
  ]);
  // The ladder names the tier the manifest is actually at. Reporting the
  // route-mode migration here would mean a bump had retargeted the previous
  // rung at manifests that already satisfy it.
  assert.equal(
    checked.issues.some((issue) => issue.includes("route-mode management")),
    false,
    "schema 4 already records the route mode; the ladder must not misname its tier",
  );

  await runConsumerInstaller({ command: "update", target }, { sourceRoot, github });

  const migrated = await readManifest(target);
  assert.equal(migrated.schemaVersion, MANIFEST_SCHEMA_VERSION);
  const expected = variableValues(migrated.configuration);
  for (const name of ["SD_REVIEW_CHEAP_BACKEND_V1", "SD_REVIEW_DEEP_BACKEND_V1"]) {
    assert.deepEqual(
      migrated.resources.variables[name],
      { value: expected[name], owned: true },
      `${name} must be installer-created, since uninstall only removes what it owns`,
    );
    assert.equal(github.variables.get(name), expected[name]);
  }
  assert.equal(
    (await runConsumerInstaller({ command: "check", target }, { sourceRoot, github })).ok,
    true,
  );

  // The point of managing them: uninstall takes back what it created.
  await runConsumerInstaller({ command: "uninstall", target, yes: true }, { sourceRoot, github });
  assert.equal(github.variables.has("SD_REVIEW_CHEAP_BACKEND_V1"), false);
  assert.equal(github.variables.has("SD_REVIEW_DEEP_BACKEND_V1"), false);
});

test("uninstall rejects a route option the way it rejects provider and model options", () => {
  assert.throws(
    () => parseArguments(["uninstall", "--route-mode", "deep"]),
    /uninstall does not accept provider, model, or route options/u,
  );
  assert.deepEqual(parseArguments(["install", "--route-mode", "deep"]), {
    command: "install",
    routeMode: "deep",
  });
  // The grammar accepts any string; the value set is enforced when the
  // configuration is validated, so an unsupported mode still cannot install.
  assert.throws(
    () => installerModule.validateConfiguration({ ...DEFAULT_CONFIG, routeMode: "sometimes" }),
    /route mode must be one of/u,
  );
});

// The install/check secret gate used to be mode-blind: every route mode was
// refused without PR_AGENT_MODEL_API_KEY, including copilot and none, which
// reach no PR-Agent provider. Both installed lanes bind the secret only behind
// `vars.PR_AGENT_MODEL_PROVIDER == '<name>'` guards that fall through to '', so
// the gate was stricter than the artifact it protected. Nothing pinned the
// refusal for any mode, which is how it went unnoticed.

test("routeModeNeedsProviderSecret classifies every declared route mode", () => {
  // Keyed by every value in ROUTE_MODES. The key-set assertion below is the
  // point: a mode added to ROUTE_MODES without a decision here fails this test
  // rather than silently inheriting the strict default and going uncovered.
  const expected = { auto: true, cheap: true, deep: true, copilot: false, none: false };

  assert.deepEqual(
    Object.keys(expected).sort(),
    [...ROUTE_MODES].sort(),
    "every declared route mode needs an explicit secret-requirement decision",
  );
  for (const [mode, needsSecret] of Object.entries(expected)) {
    assert.equal(routeModeNeedsProviderSecret(mode), needsSecret, mode);
  }

  // Unknown and absent modes stay strict. A pre-schema-4 manifest records no
  // route mode at all.
  assert.equal(routeModeNeedsProviderSecret(undefined), true);
  assert.equal(routeModeNeedsProviderSecret("future-mode"), true);
});

for (const routeMode of ["copilot", "none"]) {
  test(`install under ${routeMode} succeeds with no provider secret present`, async () => {
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub();
    assert.equal(github.secrets.has(SECRET_NAME), false);

    const report = await runConsumerInstaller(
      { command: "install", target, routeMode },
      { sourceRoot, github },
    );

    assert.equal(report.ok, true);
    assert.equal(
      github.calls.some((call) => call.kind === "set-secret"),
      false,
      "no secret was requested, so none should be set",
    );
    const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
    assert.equal(checked.ok, true, checked.issues?.join("\n"));
    assert.equal(
      checked.issues.some((issue) => issue.includes(SECRET_NAME)),
      false,
      "check must not report a credential this mode never reads",
    );
  });
}

for (const routeMode of ["auto", "cheap", "deep"]) {
  test(`install under ${routeMode} still refuses without the provider secret`, async () => {
    const sourceRoot = await makeSource();
    const target = await makeTarget();
    const github = new FakeGitHub();

    await assert.rejects(
      runConsumerInstaller({ command: "install", target, routeMode }, { sourceRoot, github }),
      new RegExp(`${SECRET_NAME} is missing`),
    );
  });
}

test("check reports the missing secret when the recorded mode needs it", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub({ secrets: [SECRET_NAME] });
  await runConsumerInstaller(
    { command: "install", target, routeMode: "deep" },
    { sourceRoot, github },
  );

  github.secrets.delete(SECRET_NAME);

  const checked = await runConsumerInstaller({ command: "check", target }, { sourceRoot, github });
  assert.equal(checked.ok, false);
  assert.ok(
    checked.issues.includes(`GitHub secret ${SECRET_NAME} is missing`),
    checked.issues.join("\n"),
  );
});

test("install under copilot still provisions the secret when one is supplied", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub();

  const report = await runConsumerInstaller(
    { command: "install", target, routeMode: "copilot", secretMode: "stdin", secretInput: "k" },
    { sourceRoot, github },
  );

  assert.equal(report.ok, true);
  assert.equal(github.secrets.has(SECRET_NAME), true, "an explicit secret is still honoured");
});

test("update to a PR-Agent mode refuses on an install that skipped the secret", async () => {
  const sourceRoot = await makeSource();
  const target = await makeTarget();
  const github = new FakeGitHub();
  await runConsumerInstaller(
    { command: "install", target, routeMode: "copilot" },
    { sourceRoot, github },
  );
  assert.equal(github.secrets.has(SECRET_NAME), false);

  // Relaxing install must not open a path to a PR-Agent route with no
  // credential: that would move the failure from install time to review time.
  await assert.rejects(
    runConsumerInstaller({ command: "update", target, routeMode: "auto" }, { sourceRoot, github }),
    new RegExp(`${SECRET_NAME} is missing`),
  );
});

// Route policy is the durable lane's half of REVIEW_ROUTE_MODE: the installer
// writes the variable, and the action refuses an explicit route outside it. The
// two guards below are the ones that fail when the wiring is right in spirit
// and wrong in fact.
function durableLaneRoutePolicyWiring() {
  const source = readFileSync(path.join(REPO_ROOT, DURABLE_TEMPLATE_PATH), "utf8");
  const line = source.split("\n").find((entry) => entry.trim().startsWith("route-policy:"));
  assert.ok(line, `${DURABLE_TEMPLATE_PATH} must pass route-policy to the durable action`);
  return line;
}

// The policy exists to constrain workflow_dispatch callers. Sourcing it from a
// dispatch input would let the constrained caller supply their own policy, so
// this must read the repository variable and nothing else. Every neighbouring
// policy line in the file *is* an `inputs.` line, which is exactly why a
// consistency-minded edit would silently disable enforcement.
test("the durable lane reads route policy from the repository variable, not a dispatch input", () => {
  const line = durableLaneRoutePolicyWiring();
  assert.match(line, /\$\{\{\s*vars\.REVIEW_ROUTE_MODE\s*\}\}/u);
  assert.ok(
    !line.includes("inputs."),
    `route-policy must not be caller-settable, got: ${line.trim()}`,
  );
});

// The test above is pinned to one path, so it cannot see a *second* lane that
// wires route-policy wrongly -- and adding a lane is exactly how this would
// recur. This enumerates every shipped workflow instead of naming one. The
// scan is deliberately over all of them, not only the ones that mention
// route-policy today: a file joins the set by existing, not by being listed.
function shippedWorkflowPaths() {
  const paths = [];
  for (const directory of ["examples", ".github/workflows"]) {
    for (const entry of readdirSync(path.join(REPO_ROOT, directory))) {
      if (entry.endsWith(".yml") || entry.endsWith(".yaml")) paths.push(`${directory}/${entry}`);
    }
  }
  return paths;
}

test("no shipped workflow lets a caller supply its own route policy", () => {
  const offenders = [];
  for (const relative of shippedWorkflowPaths()) {
    const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    for (const line of source.split("\n")) {
      if (!line.trim().startsWith("route-policy:")) continue;
      // `inputs.` and `github.event.inputs.` are both caller-supplied on a
      // workflow_dispatch lane; either one hands the constrained caller the
      // constraint itself.
      if (/inputs\./u.test(line)) offenders.push(`${relative}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "route-policy bounds what a workflow_dispatch caller may request, so sourcing it "
      + "from a dispatch input lets that caller lift its own bound",
  );
});

// The installer's ROUTE_MODES and the action's ROUTES are two literals in two
// trees. A mode added to the installer but not the action would be written into
// a consumer's REVIEW_ROUTE_MODE and then refused on every dispatch against it.
test("installer route modes stay identical to the action's accepted route set", () => {
  assert.deepEqual(
    [...ROUTE_MODES].sort(),
    [...ACTION_ROUTES].sort(),
    "ROUTE_MODES and src/protocol.js ROUTES accept different route sets",
  );
});

// This repository dogfoods its own durable lane: .github/workflows/sd-review.yml
// is an installer-managed copy of DURABLE_TEMPLATE_PATH, and the manifest records
// the source hash, so `check` treats any difference as drift. Nothing asserted
// that here, and the gap is not hypothetical -- adding route-policy to the
// template left this repository as the one consumer not enforcing what it ships.
// The same applies to the event-driven lane, so both are bound.
for (const [source, installed] of [
  [DURABLE_TEMPLATE_PATH, ".github/workflows/sd-review.yml"],
  [TEMPLATE_PATH, ".github/workflows/ai-review-router.yml"],
]) {
  test(`${installed} stays byte-identical to ${source}`, () => {
    assert.equal(
      readFileSync(path.join(REPO_ROOT, installed), "utf8"),
      readFileSync(path.join(REPO_ROOT, source), "utf8"),
      `${installed} has drifted from ${source}; run update rather than editing it`,
    );
  });
}

// The generalization of the SD_REVIEW_*_BACKEND_V1 defect. That bug was a
// template reading `${{ vars.X }}` that no installer table entry ever created;
// an unset GitHub variable expands to "", so the lane installed clean, passed
// `check`, and failed only at dispatch. The shipped fix was point-wise -- two
// table entries -- so the next template to add a vars. reference reproduces it
// exactly. This enumerates the references from the installed templates instead
// of restating them, which is the only form that can catch a name nobody
// thought to add here.
function installedTemplateVariables() {
  const found = new Map();
  for (const source of [DURABLE_TEMPLATE_PATH, TEMPLATE_PATH]) {
    const text = readFileSync(path.join(REPO_ROOT, source), "utf8");
    for (const match of text.matchAll(/vars\.([A-Z][A-Z0-9_]*)/gu)) {
      const name = match[1];
      // A `vars.X || 'literal'` fallback makes an unset variable harmless, so
      // those are exempt -- but record them, because an exempt variable is still
      // invisible to `check` and cannot be configured through the installer.
      const covered = new RegExp(`vars\\.${name}\\s*\\|\\|`, "u").test(text);
      const prior = found.get(name);
      found.set(name, { covered: (prior?.covered ?? true) && covered, source });
    }
  }
  return found;
}

// Managed *names*, not the values a particular configuration produces.
// `variableValues(DEFAULT_CONFIG)` drops REVIEW_ROUTE_MODE, because
// DEFAULT_CONFIG leaves routeMode unset and variableValuesForSchema filters
// undefined out -- an unpopulated variable, not an unmanaged one. That
// distinction is the whole question here, so this reads the table directly.
test("every variable the installed templates read is installer-managed or has a fallback", () => {
  const managed = new Set(MANAGED_VARIABLE_NAMES);
  const unmanaged = [];
  for (const [name, { covered, source }] of installedTemplateVariables()) {
    if (!managed.has(name) && !covered) unmanaged.push(`${name} (read by ${source})`);
  }
  assert.deepEqual(
    unmanaged,
    [],
    "these variables are read by an installed lane but nothing creates them, so an "
      + "install produces a lane that fails at dispatch and `check` cannot see it",
  );
});
