import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  DESCRIPTOR_PATH,
  DESCRIPTOR_SOURCE_PATH,
  DURABLE_TEMPLATE_PATH,
  DURABLE_WORKFLOW_PATH,
  HISTORICAL_TEMPLATE_HASHES,
  MANAGED_RESOURCES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
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
  ROUTE_MODE_MIN_SCHEMA_VERSION,
  resolveOverride,
  sameConfiguration,
  sameRepository,
  sha256,
  validateConfiguration,
  variableValues,
  variableValuesForSchema,
} from "../scripts/consumer-installer/codecs.mjs";
// The action's own backend decoder. Importing it here is the point: what the
// installer writes and what the action accepts are two sides of one contract,
// and asserting the installer against its own idea of the shape would test
// nothing.
import { decodeBackend } from "../src/protocol.js";
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

// Managed source bytes keyed exactly as `readManagedSources` returns them, so
// `createManifest` derives every hash it records from one fixture. A resource
// added to MANAGED_RESOURCES needs an entry here and nothing else in these tests.
const MANAGED_SOURCE_BODIES = Object.fromEntries(
  MANAGED_RESOURCES.map(({ field }) => [field, `${field}-body`]),
);

// Fully-formed manifest bodies for the decoder tests below. Built as literals
// rather than through createManifest so a decoder regression cannot be masked
// by the constructor changing in the same direction.
function manifestBody(schemaVersion, overrides = {}) {
  const configuration = { ...DEFAULT_CONFIG };
  // Route mode joined the managed set at schema 4, so it belongs in the
  // configuration only from that tier up; below it the manifest must record
  // three variables and still decode. The two backend descriptors joined at
  // schema 5 the same way, but they derive from cheapModel/deepModel rather than
  // from a configuration field of their own, so the tier scoping for them lives
  // entirely in variableValuesForSchema rather than here.
  if (schemaVersion >= ROUTE_MODE_MIN_SCHEMA_VERSION) configuration.routeMode = "copilot";
  const body = {
    schemaVersion,
    tool: "sd-github-review",
    state: "active",
    repository: "acme/consumer",
    workflow: { path: WORKFLOW_PATH, sha256: "a".repeat(64) },
    source: { template: "examples/pr-agent-router.yml", sha256: "a".repeat(64) },
    configuration,
    resources: {
      variables: Object.fromEntries(
        Object.entries(variableValuesForSchema(configuration, schemaVersion)).map(
          ([name, value]) => [name, { value, owned: true }],
        ),
      ),
      secret: { name: SECRET_NAME, owned: true },
      labels: ROUTING_LABELS.map(({ name }) => ({ name, owned: true })),
    },
  };
  if (schemaVersion >= 2) {
    body.source.commit = "b".repeat(40);
    body.source.tag = "v1.0.0";
    body.source.released = true;
  }
  if (schemaVersion >= 3) {
    body.descriptor = {
      path: DESCRIPTOR_PATH,
      source: DESCRIPTOR_SOURCE_PATH,
      sha256: "c".repeat(64),
    };
    body.durableWorkflow = {
      path: DURABLE_WORKFLOW_PATH,
      source: DURABLE_TEMPLATE_PATH,
      sha256: "d".repeat(64),
    };
  }
  return { ...body, ...overrides };
}

// ---------------------------------------------------------------------------
// synthesized backend descriptors
// ---------------------------------------------------------------------------

test("codecs: the synthesized backend descriptors satisfy the action's decoder", () => {
  // The whole failure mode this variable exists to remove: the installer writes
  // a descriptor the action then refuses, turning a silent missing-variable
  // error into a silent malformed-variable one. Assert across the exact path the
  // consumer takes — table -> JSON string in `vars.*` -> JSON.parse in the
  // action -> decodeBackend — rather than against the object the table builds,
  // so a value that only survives in memory cannot pass.
  const configuration = { ...DEFAULT_CONFIG, routeMode: "copilot" };
  const values = variableValues(configuration);
  for (const [name, modelField, costTier, qualityTier] of [
    ["SD_REVIEW_CHEAP_BACKEND_V1", "cheapModel", "low", "standard"],
    ["SD_REVIEW_DEEP_BACKEND_V1", "deepModel", "medium", "advanced"],
  ]) {
    const raw = values[name];
    assert.equal(typeof raw, "string", `${name} must be provisioned`);
    const backend = decodeBackend(JSON.parse(raw), name);
    // `kind: external` is not cosmetic: selectedBackend rejects anything else
    // for a `{route}-backend` input, so a descriptor that decodes but is not
    // external still fails the route it was provisioned for.
    assert.equal(backend.kind, "external");
    assert.equal(backend.model, configuration[modelField]);
    assert.equal(backend.costTier, costTier);
    assert.equal(backend.qualityTier, qualityTier);
    // reviewAuthors feeds finding attribution. An empty list is accepted by the
    // decoder only when every channel is `check`, which these are not, so an
    // empty value here would misattribute every finding rather than fail.
    assert.deepEqual(backend.reviewAuthors, ["github-actions[bot]"]);
  }
});

test("codecs: a backend descriptor follows the configured model, not the default", () => {
  // Falsifies the derivation being a constant. A synthesized descriptor that
  // ignored the configuration would pass the decode test above unchanged.
  const configuration = {
    provider: "anthropic",
    cheapModel: "anthropic/claude-haiku-4-5",
    deepModel: "anthropic/claude-opus-4-1",
    routeMode: "cheap",
  };
  const values = variableValues(configuration);
  assert.equal(JSON.parse(values.SD_REVIEW_CHEAP_BACKEND_V1).model, "anthropic/claude-haiku-4-5");
  assert.equal(JSON.parse(values.SD_REVIEW_DEEP_BACKEND_V1).model, "anthropic/claude-opus-4-1");
  // The model is the configured value verbatim, never `${provider}/${model}`.
  // validateConfiguration already requires the prefix, so concatenating would
  // produce "anthropic/anthropic/..." and a model no provider resolves.
  assert.equal(
    JSON.parse(values.SD_REVIEW_CHEAP_BACKEND_V1).model.startsWith("anthropic/anthropic/"),
    false,
  );
});

test("codecs: a schema-5 manifest must record a descriptor naming its own model", () => {
  // The decoder deliberately does not compare a derived variable against a fresh
  // synthesis — that would couple every stored manifest to the descriptor shape
  // of whichever installer version reads it. What it does assert is that the
  // recorded descriptor names the recorded model, which is the disagreement that
  // actually matters.
  const drifted = manifestBody(MANIFEST_SCHEMA_VERSION);
  drifted.resources.variables.SD_REVIEW_CHEAP_BACKEND_V1.value = JSON.stringify({
    ...JSON.parse(drifted.resources.variables.SD_REVIEW_CHEAP_BACKEND_V1.value),
    model: "openrouter/someone/else",
  });
  assert.throws(
    () => decodeManifest(JSON.stringify(drifted)),
    /variable SD_REVIEW_CHEAP_BACKEND_V1 must match the recorded configuration/u,
  );

  const notJson = manifestBody(MANIFEST_SCHEMA_VERSION);
  notJson.resources.variables.SD_REVIEW_DEEP_BACKEND_V1.value = "not-json";
  assert.throws(
    () => decodeManifest(JSON.stringify(notJson)),
    /variable SD_REVIEW_DEEP_BACKEND_V1 must match the recorded configuration/u,
  );

  // But a descriptor whose shape differs while still naming the right model
  // decodes, which is what keeps `check` and `update` usable on a manifest an
  // older installer wrote.
  const olderShape = manifestBody(MANIFEST_SCHEMA_VERSION);
  const recorded = JSON.parse(olderShape.resources.variables.SD_REVIEW_CHEAP_BACKEND_V1.value);
  delete recorded.limitations;
  olderShape.resources.variables.SD_REVIEW_CHEAP_BACKEND_V1.value = JSON.stringify(recorded);
  assert.equal(
    decodeManifest(JSON.stringify(olderShape)).schemaVersion,
    MANIFEST_SCHEMA_VERSION,
  );
});

test("codecs: every supported schema decodes at the current schema version", () => {
  // The fleet-breaking direction. Bumping MANIFEST_SCHEMA_VERSION must not stop
  // a live manifest at any earlier schema from decoding.
  //
  // Enumerated from the constant rather than from a literal list, so the next
  // bump extends this test's coverage instead of leaving it asserting the
  // previous schema's world. `manifestBody` still needs its own tier for the
  // new version's required fields — that part cannot be derived — but the
  // decode sweep and the above-range rejection both follow the constant.
  for (let version = 1; version <= MANIFEST_SCHEMA_VERSION; version += 1) {
    const decoded = decodeManifest(JSON.stringify(manifestBody(version)));
    assert.equal(decoded.schemaVersion, version, `schema ${version} must decode as itself`);
    assert.equal(decoded.repository, "acme/consumer");
  }
  assert.throws(
    () => decodeManifest(JSON.stringify(manifestBody(MANIFEST_SCHEMA_VERSION + 1))),
    /unsupported or malformed manifest header/u,
  );
});

test("codecs: the managed variable tiers are monotone, not pinned to the current version", () => {
  // The gate this locks is `>= BACKEND_MIN_SCHEMA_VERSION`, not
  // `=== MANIFEST_SCHEMA_VERSION`. Today those two are indistinguishable —
  // BACKEND_MIN_SCHEMA_VERSION *is* the current version — so a decode sweep over
  // schemas 1..current cannot tell them apart, and the equality form would sit
  // there passing until the next bump silently dropped both backend descriptors
  // out of the managed set for every schema-5 manifest in the fleet.
  //
  // Probing one version above the current one is what separates them: an
  // introduced-at gate keeps returning the tier, an equality gate stops.
  const configuration = { ...DEFAULT_CONFIG, routeMode: "copilot" };
  const current = Object.keys(variableValuesForSchema(configuration, MANIFEST_SCHEMA_VERSION));
  const beyond = Object.keys(variableValuesForSchema(configuration, MANIFEST_SCHEMA_VERSION + 1));
  assert.deepEqual(beyond.sort(), current.sort());

  // And each tier is a superset of the one below it, which is the same property
  // stated across the whole ladder rather than at its top edge only.
  for (let version = 2; version <= MANIFEST_SCHEMA_VERSION; version += 1) {
    const lower = Object.keys(variableValuesForSchema(configuration, version - 1));
    const upper = new Set(Object.keys(variableValuesForSchema(configuration, version)));
    for (const name of lower) {
      assert.ok(upper.has(name), `schema ${version} must still manage ${name}`);
    }
  }
});

test("codecs: schema-2 provenance stays validated after the schema-3 bump", () => {
  // Gating provenance on `=== MANIFEST_SCHEMA_VERSION` would make every one of
  // these pass silently while the fleet's schema-2 manifests go unchecked.
  const missingCommit = manifestBody(2);
  delete missingCommit.source.commit;
  assert.throws(
    () => decodeManifest(JSON.stringify(missingCommit)),
    /source commit must be a 40-character hex commit/u,
  );

  const badTag = manifestBody(2);
  badTag.source.tag = "0.1.0";
  assert.throws(
    () => decodeManifest(JSON.stringify(badTag)),
    /source tag must be a v<semver> release tag or null/u,
  );

  const releasedWithoutTag = manifestBody(2);
  releasedWithoutTag.source.tag = null;
  assert.throws(
    () => decodeManifest(JSON.stringify(releasedWithoutTag)),
    /a released manifest must record a release tag/u,
  );

  // The same invariants at schema 3, so the widened condition covers both.
  const missingCommitV3 = manifestBody(3);
  delete missingCommitV3.source.commit;
  assert.throws(
    () => decodeManifest(JSON.stringify(missingCommitV3)),
    /source commit must be a 40-character hex commit/u,
  );
});

test("codecs: schema-3 validates the descriptor and durableWorkflow blocks by exact equality", () => {
  for (const field of ["descriptor", "durableWorkflow"]) {
    const missing = manifestBody(3);
    delete missing[field];
    assert.throws(
      () => decodeManifest(JSON.stringify(missing)),
      new RegExp(`${field} ownership is malformed`, "u"),
      `${field} must be required at schema 3`,
    );

    const wrongPath = manifestBody(3);
    wrongPath[field] = { ...wrongPath[field], path: ".github/workflows/elsewhere.yml" };
    assert.throws(
      () => decodeManifest(JSON.stringify(wrongPath)),
      new RegExp(`${field} ownership is malformed`, "u"),
    );

    const wrongSource = manifestBody(3);
    wrongSource[field] = { ...wrongSource[field], source: "examples/somewhere-else.yml" };
    assert.throws(
      () => decodeManifest(JSON.stringify(wrongSource)),
      new RegExp(`${field} ownership is malformed`, "u"),
    );

    const badHash = manifestBody(3);
    badHash[field] = { ...badHash[field], sha256: "not-a-hash" };
    assert.throws(
      () => decodeManifest(JSON.stringify(badHash)),
      new RegExp(`${field} ownership is malformed`, "u"),
    );
  }

  // A schema-2 manifest carrying the blocks is still a schema-2 manifest: the
  // blocks are not validated, and `check` reports the migration instead.
  const early = manifestBody(2);
  early.descriptor = { path: "wrong", source: "wrong", sha256: "wrong" };
  assert.equal(decodeManifest(JSON.stringify(early)).schemaVersion, 2);
});

test("codecs: the durable template declares the workflow name and path the descriptor does", async () => {
  // Two files with no compile-time link: GitHub derives the workflow metadata
  // name from the template's own `name:` field, and the probe rejects a
  // mismatch against the descriptor as `workflow-name-mismatch`. Assert against
  // the parsed descriptor, never a repeated literal — a test that restates the
  // string passes when both sides drift together.
  const repositoryRoot = new URL("../", import.meta.url);
  const descriptor = JSON.parse(
    await readFile(new URL(DESCRIPTOR_SOURCE_PATH, repositoryRoot), "utf8"),
  );
  const template = await readFile(new URL(DURABLE_TEMPLATE_PATH, repositoryRoot), "utf8");
  // Compare the logical YAML value, not the raw bytes: `name: "SD routed
  // review"` is valid YAML that GitHub resolves to the same workflow name, so
  // capturing the quotes would fail this test on a change the probe accepts.
  const declaredName = template
    .match(/^name:[ \t]*(.+?)[ \t]*$/mu)?.[1]
    ?.replace(/^(["'])(.*)\1$/u, "$2");

  assert.equal(declaredName, descriptor.workflow.name);
  assert.equal(DURABLE_WORKFLOW_PATH, descriptor.workflow.path);
});

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

test("codecs: decodeManifest round-trips a schema-3 manifest and rejects a foreign label", () => {
  const configuration = { ...DEFAULT_CONFIG, routeMode: "copilot" };
  const manifest = createManifest({
    state: "active",
    repository: "acme/consumer",
    sources: MANAGED_SOURCE_BODIES,
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
  // Enumerated from the managed table rather than written out, so a variable
  // joining it extends this assertion instead of failing it with a literal that
  // says nothing about which variable appeared.
  assert.deepEqual(kinds, [
    ...ROUTING_LABELS.map(() => "create-label"),
    "set-secret",
    ...Object.keys(variableValues(DEFAULT_CONFIG)).map(() => "set-variable"),
  ]);
  assert.deepEqual(
    actions.filter((action) => action.kind === "set-variable").map(({ name }) => name).sort(),
    Object.keys(variableValues(DEFAULT_CONFIG)).sort(),
  );
  assert.equal(resources.secret.owned, true);
  assert.ok(Object.values(resources.variables).every((entry) => entry.owned === true));
});

test("plan: planResources preserves matching unowned resources and rejects an unowned conflict", () => {
  const existing = snapshot({
    variables: variableValues(DEFAULT_CONFIG),
    secrets: [SECRET_NAME],
    labels: ROUTING_LABELS.map(({ name }) => name),
  });
  const { actions, resources } = planResources(DEFAULT_CONFIG, existing, null, false);
  assert.deepEqual(actions, []);
  assert.equal(resources.secret.owned, false);
  const conflicting = snapshot({
    variables: { ...variableValues(DEFAULT_CONFIG), PR_AGENT_MODEL_PROVIDER: "different" },
    secrets: [SECRET_NAME],
  });
  assert.throws(() => planResources(DEFAULT_CONFIG, conflicting, null, false), /already exists with a different unowned value/u);

  // The same rejection for a derived variable a repository already set by hand,
  // which is the pilot's shape: a descriptor naming a model the configuration
  // does not. Without this the synthesized value would silently overwrite it.
  const conflictingBackend = snapshot({
    variables: {
      ...variableValues(DEFAULT_CONFIG),
      SD_REVIEW_CHEAP_BACKEND_V1: JSON.stringify({ id: "pr-agent", model: "openrouter/other/model" }),
    },
    secrets: [SECRET_NAME],
  });
  assert.throws(
    () => planResources(DEFAULT_CONFIG, conflictingBackend, null, false),
    /SD_REVIEW_CHEAP_BACKEND_V1 already exists with a different unowned value/u,
  );
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
    sources: MANAGED_SOURCE_BODIES,
    configuration: DEFAULT_CONFIG,
    resources: { variables: {}, secret: { name: SECRET_NAME, owned: true }, labels: [] },
    release: { commit: "a".repeat(40), tag: "v2.0.0", released: true },
  });
  assert.equal(manifest.source.released, true);
  assert.equal(manifest.source.tag, "v2.0.0");
  assert.equal(manifest.workflow.sha256, sha256Hex(MANAGED_SOURCE_BODIES.workflow));
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
  const configuration = { ...DEFAULT_CONFIG, routeMode: "copilot" };
  const manifest = createManifest({
    state: "active",
    repository: "acme/consumer",
    sources: MANAGED_SOURCE_BODIES,
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
  await writeFile(path.join(root, WORKFLOW_PATH), MANAGED_SOURCE_BODIES.workflow, "utf8");
  await writeFile(path.join(root, MANIFEST_PATH), manifestJson(manifest), "utf8");
  const state = await loadLocalState(guard, root);
  assert.equal(state.manifest.repository, "acme/consumer");
  assert.equal(state.workflow, MANAGED_SOURCE_BODIES.workflow);
});

test("codecs: sameConfiguration compares managed fields, not key order", () => {
  // The failure this guards: check compares the recorded configuration against
  // the resolved one, and comparing serialized objects would report every
  // install as drifted against itself the moment a field is built in a
  // different position on the two sides.
  const recorded = { provider: "openrouter", cheapModel: "a", deepModel: "b", routeMode: "copilot" };
  const resolved = { routeMode: "copilot", deepModel: "b", provider: "openrouter", cheapModel: "a" };
  assert.equal(sameConfiguration(recorded, resolved), true);
  assert.notEqual(JSON.stringify(recorded), JSON.stringify(resolved), "the orders really do differ");
  assert.equal(sameConfiguration(recorded, { ...recorded, routeMode: "none" }), false);
  // A pre-schema-4 configuration carries no route mode, and must not compare
  // equal to a migrated one that does.
  const { routeMode, ...preMigration } = recorded;
  assert.equal(sameConfiguration(recorded, preMigration), false);
  assert.equal(sameConfiguration(preMigration, { ...preMigration }), true);
  // Unmanaged keys are outside the comparison by construction, not by accident.
  assert.equal(sameConfiguration(recorded, { ...recorded, unmanaged: "ignored" }), true);
});
