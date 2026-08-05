import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  HISTORICAL_TEMPLATE_HASHES,
  MANIFEST_PATH,
  ROUTING_LABELS,
  SECRET_NAME,
  WORKFLOW_PATH,
  decodeManifest,
  formatReport,
  manifestJson,
  normalizeRepository,
  parseArguments,
  parseGitHubRemote,
  recognizeTemplate,
  resolveConfiguration,
  resolveOverride,
  sameRepository,
  sha256,
  validateConfiguration,
  variableValues,
} from "../scripts/consumer-installer/codecs.mjs";
import {
  GitHubCli,
  gitOutput,
  resolveSourceRelease,
} from "../scripts/consumer-installer/transport.mjs";
import {
  atomicWrite,
  loadLocalState,
  makePathGuard,
  readOptional,
  removeOptional,
} from "../scripts/consumer-installer/persistence.mjs";
import {
  assertManifestRepository,
  assertWorkflowCanBeManaged,
  createManifest,
  planResources,
  publicAction,
  sourceOverride,
} from "../scripts/consumer-installer/plan.mjs";

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function snapshot({ variables = {}, secrets = [], labels = [] } = {}) {
  return {
    variables: new Map(Object.entries(variables)),
    secrets: new Set(secrets),
    labels: new Map(labels.map((name) => [name, { name }])),
  };
}

// ---------------------------------------------------------------------------
// codecs (leaf)
// ---------------------------------------------------------------------------

test("codecs: sameRepository is case-insensitive and normalizeRepository enforces OWNER/REPO", () => {
  assert.equal(sameRepository("Acme/Repo", "acme/repo"), true);
  assert.equal(normalizeRepository("acme/repo"), "acme/repo");
  assert.throws(() => normalizeRepository("not-a-repo"), /OWNER\/REPO/u);
});

test("codecs: validateConfiguration enforces the provider allowlist and model shape", () => {
  const ok = validateConfiguration(DEFAULT_CONFIG);
  assert.equal(ok.provider, "openrouter");
  assert.throws(() => validateConfiguration({ ...DEFAULT_CONFIG, provider: "nope" }), /provider must be one of/u);
  assert.throws(
    () => validateConfiguration({ provider: "openrouter", cheapModel: "openrouter/x", deepModel: "bad" }),
    /deep model must use the openrouter\/<model-id> form/u,
  );
});

test("codecs: resolveConfiguration falls back to an existing manifest then defaults", () => {
  const existing = { configuration: { provider: "openai", cheapModel: "gpt-a", deepModel: "gpt-b" } };
  assert.deepEqual(resolveConfiguration({}, existing), existing.configuration);
  assert.deepEqual(resolveConfiguration({}, null), { ...DEFAULT_CONFIG });
  assert.equal(resolveConfiguration({ provider: "openai", cheapModel: "gpt-a", deepModel: "gpt-b" }, null).provider, "openai");
});

test("codecs: parseGitHubRemote handles https/ssh and rejects non-GitHub remotes", () => {
  assert.equal(parseGitHubRemote("https://github.com/acme/consumer.git"), "acme/consumer");
  assert.equal(parseGitHubRemote("git@github.com:acme/consumer.git"), "acme/consumer");
  assert.equal(parseGitHubRemote("https://gitlab.com/acme/consumer.git"), null);
});

test("codecs: parseArguments accepts a valid install and rejects mismatched flags", () => {
  const options = parseArguments(["install", "--github", "acme/consumer", "--dry-run"]);
  assert.deepEqual(options, { command: "install", repository: "acme/consumer", dryRun: true });
  assert.deepEqual(parseArguments([]), { help: true });
  assert.throws(() => parseArguments(["check", "--set-secret"]), /check does not accept secret input/u);
  assert.throws(() => parseArguments(["install", "--yes"]), /does not accept --yes/u);
});

test("codecs: resolveOverride requires both a 40-hex commit and a v-semver tag", () => {
  assert.deepEqual(
    resolveOverride({ tag: "v1.2.3", commit: "a".repeat(40) }),
    { commit: "a".repeat(40), tag: "v1.2.3", released: false },
  );
  assert.throws(() => resolveOverride({ tag: "v1.2.3", commit: "short" }), /40-character hex/u);
  assert.throws(() => resolveOverride({ tag: null, commit: "a".repeat(40) }), /v<semver> release tag/u);
});

test("codecs: recognizeTemplate matches the current template and allow-listed history only", () => {
  assert.deepEqual(recognizeTemplate("abc", "abc", HISTORICAL_TEMPLATE_HASHES), { label: "current source" });
  const historical = HISTORICAL_TEMPLATE_HASHES[0];
  assert.deepEqual(
    recognizeTemplate(historical.sha256, "abc", HISTORICAL_TEMPLATE_HASHES),
    { label: historical.tag },
  );
  assert.equal(recognizeTemplate("unknown", "abc", HISTORICAL_TEMPLATE_HASHES), null);
});

test("codecs: decodeManifest round-trips a schema-2 manifest and rejects a foreign label", () => {
  const templateSha = sha256Hex("workflow-body");
  const configuration = { ...DEFAULT_CONFIG };
  const manifest = createManifest({
    state: "active",
    repository: "acme/consumer",
    templateSha,
    configuration,
    resources: {
      variables: Object.fromEntries(
        Object.entries(variableValues(configuration)).map(([name, value]) => [name, { value, owned: true }]),
      ),
      secret: { name: SECRET_NAME, owned: true },
      labels: ROUTING_LABELS.map(({ name }) => ({ name, owned: true })),
    },
    release: { commit: "a".repeat(40), tag: "v1.0.0", released: true },
  });
  const decoded = decodeManifest(manifestJson(manifest));
  assert.equal(decoded.repository, "acme/consumer");
  const tampered = { ...manifest, resources: { ...manifest.resources, labels: [{ name: "review:bogus", owned: true }] } };
  assert.throws(() => decodeManifest(manifestJson(tampered)), /label ownership/u);
});

test("codecs: formatReport renders healthy check and dry-run action lists", () => {
  assert.equal(
    formatReport({ command: "check", ok: true, repository: "acme/consumer" }),
    "Installation is healthy for acme/consumer.",
  );
  assert.equal(
    formatReport({ command: "install", ok: true, dryRun: true, repository: "acme/consumer", actions: ["do a thing"] }),
    "install dry run for acme/consumer:\n- do a thing",
  );
});

// ---------------------------------------------------------------------------
// plan (pure)
// ---------------------------------------------------------------------------

test("plan: planResources creates missing resources and marks them owned", () => {
  const { actions, resources } = planResources(DEFAULT_CONFIG, snapshot(), null, true);
  const kinds = actions.map((action) => action.kind).sort();
  assert.deepEqual(kinds, [
    "create-label",
    "create-label",
    "create-label",
    "create-label",
    "create-label",
    "set-secret",
    "set-variable",
    "set-variable",
    "set-variable",
  ]);
  assert.equal(resources.secret.owned, true);
  assert.ok(Object.values(resources.variables).every((entry) => entry.owned === true));
});

test("plan: planResources preserves matching unowned resources and rejects an unowned conflict", () => {
  const existing = snapshot({
    variables: { PR_AGENT_MODEL_PROVIDER: "openrouter", CHEAP_REVIEW_MODEL: DEFAULT_CONFIG.cheapModel, DEEP_REVIEW_MODEL: DEFAULT_CONFIG.deepModel },
    secrets: [SECRET_NAME],
    labels: ROUTING_LABELS.map(({ name }) => name),
  });
  const { actions, resources } = planResources(DEFAULT_CONFIG, existing, null, false);
  assert.deepEqual(actions, []);
  assert.equal(resources.secret.owned, false);
  const conflicting = snapshot({
    variables: { PR_AGENT_MODEL_PROVIDER: "different", CHEAP_REVIEW_MODEL: DEFAULT_CONFIG.cheapModel, DEEP_REVIEW_MODEL: DEFAULT_CONFIG.deepModel },
    secrets: [SECRET_NAME],
  });
  assert.throws(() => planResources(DEFAULT_CONFIG, conflicting, null, false), /already exists with a different unowned value/u);
});

test("plan: planResources without a secret and without --set-secret fails closed", () => {
  assert.throws(() => planResources(DEFAULT_CONFIG, snapshot(), null, false), /is missing; rerun with --set-secret/u);
});

test("plan: assertWorkflowCanBeManaged rejects an unmanaged workflow but resumes a pending one", () => {
  assert.throws(
    () => assertWorkflowCanBeManaged("install", { manifest: null, workflow: "operator edit" }, "template"),
    /is not managed by sd-github-review/u,
  );
  assert.throws(
    () => assertWorkflowCanBeManaged("update", { manifest: null, workflow: null }, "template"),
    /update requires/u,
  );
  // A pending manifest with a mismatched workflow hash must resume, not throw.
  assert.doesNotThrow(() =>
    assertWorkflowCanBeManaged(
      "install",
      { manifest: { state: "pending", workflow: { sha256: "other" } }, workflow: "drifted" },
      "template",
    ),
  );
});

test("plan: assertWorkflowCanBeManaged rejects operator drift on an active install", () => {
  assert.throws(
    () =>
      assertWorkflowCanBeManaged(
        "update",
        { manifest: { state: "active", workflow: { sha256: sha256("original") } }, workflow: "edited" },
        "template",
      ),
    /was modified after installation/u,
  );
});

test("plan: assertManifestRepository rejects a foreign manifest and publicAction is exhaustive", () => {
  assert.throws(() => assertManifestRepository({ repository: "acme/other" }, "acme/consumer"), /manages acme\/other/u);
  assert.doesNotThrow(() => assertManifestRepository(null, "acme/consumer"));
  assert.equal(publicAction({ kind: "set-variable", name: "X" }), "set GitHub variable X");
  assert.equal(publicAction({ kind: "delete-secret" }), `delete GitHub secret ${SECRET_NAME}`);
  assert.throws(() => publicAction({ kind: "nope" }), /unsupported lifecycle action/u);
});

test("plan: sourceOverride reads options then env, rejecting an explicitly empty env var", () => {
  assert.equal(sourceOverride({}, {}), undefined);
  assert.deepEqual(sourceOverride({ sourceTag: "v1.0.0" }, {}), { tag: "v1.0.0", commit: null });
  assert.deepEqual(sourceOverride({}, { SD_SOURCE_COMMIT: "a".repeat(40) }), { tag: null, commit: "a".repeat(40) });
  assert.throws(() => sourceOverride({}, { SD_SOURCE_TAG: "" }), /SD_SOURCE_TAG is set but empty/u);
});

test("plan: createManifest encodes the (released, tag) provenance pair verbatim", () => {
  const manifest = createManifest({
    state: "pending",
    repository: "acme/consumer",
    templateSha: "deadbeef",
    configuration: DEFAULT_CONFIG,
    resources: { variables: {}, secret: { name: SECRET_NAME, owned: true }, labels: [] },
    release: { commit: "a".repeat(40), tag: "v2.0.0", released: true },
  });
  assert.equal(manifest.source.released, true);
  assert.equal(manifest.source.tag, "v2.0.0");
  assert.equal(manifest.workflow.sha256, "deadbeef");
});

// ---------------------------------------------------------------------------
// transport (imports codecs)
// ---------------------------------------------------------------------------

test("transport: GitHubCli redacts the secret from a failed secret-set subprocess", async () => {
  const secret = "sk-super-secret-value";
  const fakeSpawn = (command, args, options) => ({
    status: 1,
    stdout: "",
    stderr: `refused: token ${options.input} rejected`,
    error: null,
  });
  const cli = new GitHubCli({ spawnImpl: fakeSpawn });
  await assert.rejects(
    () => cli.setSecret("acme/consumer", { value: secret }),
    (error) => {
      assert.ok(!error.message.includes(secret), "the secret must not appear in the error");
      assert.ok(error.message.includes("[redacted]"), "the secret must be redacted");
      return true;
    },
  );
});

test("transport: GitHubCli maps a subprocess timeout to reconciliation guidance", async () => {
  const fakeSpawn = () => ({
    status: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
  });
  const cli = new GitHubCli({ spawnImpl: fakeSpawn });
  await assert.rejects(
    () => cli.setVariable("acme/consumer", "PR_AGENT_MODEL_PROVIDER", "openrouter"),
    /timed out after .*verify no partial change was applied/u,
  );
});

test("transport: resolveSourceRelease records released:true only for a clean exact tag", () => {
  const cleanTag = {
    head: () => "a".repeat(40),
    exactTag: () => "v1.2.3",
    templateDirty: () => false,
  };
  assert.deepEqual(
    resolveSourceRelease({ sourceRoot: "/x", gitImpl: cleanTag, version: "1.2.3" }),
    { commit: "a".repeat(40), tag: "v1.2.3", released: true },
  );
  const dirty = { ...cleanTag, templateDirty: () => true };
  assert.deepEqual(
    resolveSourceRelease({ sourceRoot: "/x", gitImpl: dirty, version: "1.2.3" }),
    { commit: "a".repeat(40), tag: null, released: false },
  );
});

test("transport: resolveSourceRelease honors an operator override and fails closed with no git", () => {
  assert.deepEqual(
    resolveSourceRelease({ sourceRoot: "/x", override: { tag: "v9.9.9", commit: "b".repeat(40) } }),
    { commit: "b".repeat(40), tag: "v9.9.9", released: false },
  );
  const noGit = {
    head: () => {
      throw new Error("not a git checkout");
    },
    exactTag: () => null,
    templateDirty: () => false,
  };
  assert.throws(
    () => resolveSourceRelease({ sourceRoot: "/x", gitImpl: noGit, version: "1.0.0" }),
    /installer source has no git identity/u,
  );
});

test("transport: gitOutput surfaces bounded timeout recovery guidance", () => {
  const execImpl = () => {
    throw Object.assign(new Error("killed"), { code: "ETIMEDOUT" });
  };
  assert.throws(
    () => gitOutput("/src", ["rev-parse", "HEAD"], execImpl),
    /timed out after .*retry once the source checkout is responsive/u,
  );
});

// ---------------------------------------------------------------------------
// persistence (imports codecs)
// ---------------------------------------------------------------------------

async function makeTarget() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "installer-persistence-"));
  return dir;
}

test("persistence: atomicWrite/removeOptional/loadLocalState round-trip managed files", async () => {
  const root = await makeTarget();
  const guard = makePathGuard(root);
  const workflowFile = path.join(root, WORKFLOW_PATH);
  await atomicWrite(guard, workflowFile, "workflow-body\n");
  assert.equal(await readFile(workflowFile, "utf8"), "workflow-body\n");
  const state = await loadLocalState(guard, root);
  assert.equal(state.workflow, "workflow-body\n");
  assert.equal(state.manifest, null);
  await removeOptional(guard, workflowFile);
  assert.equal(await readOptional(workflowFile), null);
});

test("persistence: the guard rejects a symlinked managed ancestor with a bounded error", async () => {
  const root = await makeTarget();
  const outside = await makeTarget();
  const guard = makePathGuard(root);
  // Replace .github with a symlink pointing outside the root.
  await symlink(outside, path.join(root, ".github"), "dir");
  const workflowFile = path.join(root, WORKFLOW_PATH);
  await assert.rejects(
    () => guard.assert(workflowFile),
    (error) => {
      assert.ok(!error.message.includes(outside), "the error must not embed the symlink target");
      assert.match(error.message, /refusing to follow a symlinked or escaping installer path/u);
      return true;
    },
  );
});

test("persistence: the guard rejects a path escaping the canonical root", async () => {
  const root = await makeTarget();
  const guard = makePathGuard(root);
  await assert.rejects(
    () => guard.assert(path.join(root, "..", "escape.txt")),
    /refusing to follow a symlinked or escaping installer path/u,
  );
});

test("persistence: loadLocalState decodes an existing managed manifest", async () => {
  const root = await makeTarget();
  const guard = makePathGuard(root);
  const templateSha = sha256("workflow-body\n");
  const configuration = { ...DEFAULT_CONFIG };
  const manifest = createManifest({
    state: "active",
    repository: "acme/consumer",
    templateSha,
    configuration,
    resources: {
      variables: Object.fromEntries(
        Object.entries(variableValues(configuration)).map(([name, value]) => [name, { value, owned: true }]),
      ),
      secret: { name: SECRET_NAME, owned: true },
      labels: ROUTING_LABELS.map(({ name }) => ({ name, owned: true })),
    },
    release: { commit: "a".repeat(40), tag: null, released: false },
  });
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, WORKFLOW_PATH), "workflow-body\n", "utf8");
  await writeFile(path.join(root, MANIFEST_PATH), manifestJson(manifest), "utf8");
  const state = await loadLocalState(guard, root);
  assert.equal(state.manifest.repository, "acme/consumer");
  assert.equal(state.workflow, "workflow-body\n");
});
