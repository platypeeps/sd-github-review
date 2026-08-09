// Leaf module for the consumer installer: constants, patterns, and the pure
// codecs for manifests, configuration, GitHub remotes, source-provenance
// overrides, template recognition, and the CLI argument grammar. It imports no
// other local installer module so the decomposition keeps one downhill
// dependency direction (transport/persistence/plan -> codecs -> orchestrator).
import { createHash } from "node:crypto";

export const MANIFEST_PATH = ".github/sd-github-review.json";
export const WORKFLOW_PATH = ".github/workflows/ai-review-router.yml";
export const TEMPLATE_PATH = "examples/pr-agent-router.yml";
// The durable on-demand lane is an *additional* managed resource, never a
// replacement for the event-driven one above: repointing WORKFLOW_PATH would
// drop automatic on-PR review from every existing consumer and stop every live
// manifest from decoding (workflow.path and source.template are exact-equality
// checks below).
export const DURABLE_WORKFLOW_PATH = ".github/workflows/sd-review.yml";
export const DURABLE_TEMPLATE_PATH = "examples/sd-review.yml";
// The descriptor's source and destination deliberately differ. This repository
// publishes its reference copy under contract/; config/ is the only path setup
// discovery probes in a consumer, so publishing there would make this
// repository classify itself as an installed consumer.
export const DESCRIPTOR_SOURCE_PATH = "contract/routed-review-setup-v1.json";
export const DESCRIPTOR_PATH = "config/routed-review-setup-v1.json";
// The single source of truth for the file resources the installer copies into a
// consumer. Every downstream list — the schema-3 block validation below, the
// durable guards in plan.mjs, the `released: true` cleanliness set in
// transport.mjs, and both source reading and convergence in the orchestrator —
// derives from this table rather than repeating it. Adding a fourth resource is
// then one entry plus its manifest wiring, not six edits that silently pass
// when one is missed.
//
// `field` keys the loaded local state, the manifest block, and the read source;
// `destination` is the consumer path holding the bytes; `source` is the path in
// this repository they are copied from. The event-driven workflow is durable:
// false because it predates the durable lane: its manifest block is `workflow`
// (schema 1) rather than one of the schema-3 blocks, so it is covered by its own
// guards and is not part of the durable pair.
export const MANAGED_RESOURCES = Object.freeze([
  Object.freeze({
    field: "workflow",
    destination: WORKFLOW_PATH,
    source: TEMPLATE_PATH,
    durable: false,
  }),
  Object.freeze({
    field: "descriptor",
    destination: DESCRIPTOR_PATH,
    source: DESCRIPTOR_SOURCE_PATH,
    durable: true,
  }),
  Object.freeze({
    field: "durableWorkflow",
    destination: DURABLE_WORKFLOW_PATH,
    source: DURABLE_TEMPLATE_PATH,
    durable: true,
  }),
]);

// The schema-3 subset: the resources whose ownership a schema-3 manifest records
// in a block of its own.
export const DURABLE_MANAGED_RESOURCES = Object.freeze(
  MANAGED_RESOURCES.filter((resource) => resource.durable),
);

export const SECRET_NAME = "PR_AGENT_MODEL_API_KEY";
export const DEFAULT_CONFIG = Object.freeze({
  provider: "openrouter",
  cheapModel: "openrouter/qwen/qwen3-coder-30b-a3b-instruct",
  deepModel: "openrouter/moonshotai/kimi-k2.6",
});

export const ROUTING_LABELS = Object.freeze([
  Object.freeze({
    name: "review:cheap",
    color: "0e8a16",
    description: "Route to the routine AI reviewer",
  }),
  Object.freeze({
    name: "review:deep",
    color: "5319e7",
    description: "Route to the deeper AI reviewer",
  }),
  Object.freeze({
    name: "review:copilot",
    color: "1d76db",
    description: "Route to GitHub Copilot code review",
  }),
  Object.freeze({
    name: "review:none",
    color: "b60205",
    description: "Disable AI review for this pull request",
  }),
  Object.freeze({
    name: "review:auto",
    color: "fbca04",
    description: "Use automatic AI review routing",
  }),
]);

export const SUPPORTED_PROVIDERS = Object.freeze([
  "openai",
  "gemini",
  "openrouter",
  "anthropic",
  "cohere",
  "replicate",
  "groq",
  "sambanova",
  "xai",
  "deepseek",
  "deepinfra",
  "mistral",
  "codestral",
]);
const SUPPORTED_PROVIDER_SET = new Set(SUPPORTED_PROVIDERS);
const CONFIG_VARIABLES = Object.freeze({
  PR_AGENT_MODEL_PROVIDER: "provider",
  CHEAP_REVIEW_MODEL: "cheapModel",
  DEEP_REVIEW_MODEL: "deepModel",
});
export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LIFECYCLE_STATES = new Set(["pending", "active", "uninstalling"]);
const MAX_MODEL_LENGTH = 256;

// Consumer-manifest schema version. Bumped 1 -> 2 to record source provenance
// (commit, tag, released) on the source template, then 2 -> 3 to record the two
// resources the durable lane adds: the setup discovery descriptor and the
// durable workflow. Distinct from the action contract descriptor's own
// schemaVersion in config/routed-review-setup-v1.json.
//
// Required fields per version, so the decoder can be read against the matrix:
//
//   | version | workflow + source | provenance | descriptor + durableWorkflow |
//   | 1       | required          | absent     | absent                       |
//   | 2       | required          | required   | absent                       |
//   | 3       | required          | required   | required                     |
export const MANIFEST_SCHEMA_VERSION = 3;
const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = new Set([1, 2, 3]);
// Provenance became mandatory at schema 2 and stays mandatory afterwards.
// Gating it on `=== MANIFEST_SCHEMA_VERSION` would silently stop validating
// source.commit/tag/released on every schema-2 manifest the fleet is running.
const PROVENANCE_MIN_SCHEMA_VERSION = 2;
// The durable lane's two managed resources became mandatory at schema 3.
const DURABLE_MIN_SCHEMA_VERSION = 3;
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
export const RELEASE_TAG_PATTERN =
  /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

// A-019 adoption registry. Versioned repository data, not a contextual guess:
// the exact SHA-256 of every historical `examples/pr-agent-router.yml` a
// consumer may have copied manually per SETUP-PR-AGENT.md. `adopt` recognizes
// only these hashes (plus the current template, matched dynamically) and then
// converges the workflow to the current source. When the shipped template
// changes, add the superseded release's hash here so its manual installs stay
// adoptable. Hashes are exact bytes; there is no fuzzy/semantic matching.
export const HISTORICAL_TEMPLATE_HASHES = Object.freeze([
  Object.freeze({
    tag: "v0.1.0",
    sha256: "fb372116ae1853da92865ddf03c79dd93dcc174ac0f7979eda3eefdcf336bc18",
  }),
  // v0.2.0 and v0.3.0 ship byte-identical templates, so this one entry covers
  // both; it is labeled with the earlier release that introduced the bytes.
  // Superseded by the v0.3.0 pin advance.
  Object.freeze({
    tag: "v0.2.0",
    sha256: "79ee12926723d0b073fdd33241b08047faa9e75ea4243db797be15ade73e3b6f",
  }),
]);

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeRepository(value, field = "GitHub repository") {
  if (typeof value !== "string" || !REPOSITORY_PATTERN.test(value)) {
    throw new Error(`${field} must use the OWNER/REPO form`);
  }
  return value;
}

export function sameRepository(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

export function validateConfiguration(configuration) {
  const provider = configuration.provider;
  if (!SUPPORTED_PROVIDER_SET.has(provider)) {
    throw new Error(
      `provider must be one of: ${[...SUPPORTED_PROVIDERS].sort().join(", ")}`,
    );
  }
  for (const [field, model] of [
    ["cheap model", configuration.cheapModel],
    ["deep model", configuration.deepModel],
  ]) {
    if (typeof model !== "string" || model.length === 0) {
      throw new Error(`${field} must be nonempty`);
    }
    if (model.length > MAX_MODEL_LENGTH || /\s/u.test(model)) {
      throw new Error(`${field} must be at most ${MAX_MODEL_LENGTH} characters with no whitespace`);
    }
    if (provider !== "openai" && !model.startsWith(`${provider}/`)) {
      throw new Error(`${field} must use the ${provider}/<model-id> form`);
    }
  }
  return {
    provider,
    cheapModel: configuration.cheapModel,
    deepModel: configuration.deepModel,
  };
}

function assertOwnedResource(value, field) {
  if (!isObject(value) || typeof value.owned !== "boolean") {
    throw new Error(`${field} must record an owned boolean`);
  }
}

export function decodeManifest(source, filePath = MANIFEST_PATH) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${filePath}: manifest is not valid JSON`);
  }
  if (
    !isObject(value) ||
    !SUPPORTED_MANIFEST_SCHEMA_VERSIONS.has(value.schemaVersion) ||
    value.tool !== "sd-github-review"
  ) {
    throw new Error(`${filePath}: unsupported or malformed manifest header`);
  }
  if (!LIFECYCLE_STATES.has(value.state)) {
    throw new Error(`${filePath}: state must be pending, active, or uninstalling`);
  }
  normalizeRepository(value.repository, `${filePath}: repository`);
  if (
    !isObject(value.workflow) ||
    value.workflow.path !== WORKFLOW_PATH ||
    !SHA256_PATTERN.test(value.workflow.sha256 ?? "")
  ) {
    throw new Error(`${filePath}: workflow ownership is malformed`);
  }
  if (
    !isObject(value.source) ||
    value.source.template !== TEMPLATE_PATH ||
    !SHA256_PATTERN.test(value.source.sha256 ?? "")
  ) {
    throw new Error(`${filePath}: source template metadata is malformed`);
  }
  if (value.source.sha256 !== value.workflow.sha256) {
    throw new Error(`${filePath}: source and workflow hashes must match`);
  }
  if (value.schemaVersion >= PROVENANCE_MIN_SCHEMA_VERSION) {
    // Schema-2 provenance invariants. No separate provenance-source field: the
    // (released, tag) pair alone encodes the source unambiguously.
    if (!COMMIT_PATTERN.test(value.source.commit ?? "")) {
      throw new Error(`${filePath}: source commit must be a 40-character hex commit`);
    }
    if (value.source.tag !== null && !RELEASE_TAG_PATTERN.test(value.source.tag ?? "")) {
      throw new Error(`${filePath}: source tag must be a v<semver> release tag or null`);
    }
    if (typeof value.source.released !== "boolean") {
      throw new Error(`${filePath}: source released must be a boolean`);
    }
    if (value.source.released && value.source.tag === null) {
      throw new Error(`${filePath}: a released manifest must record a release tag`);
    }
  }
  if (value.schemaVersion >= DURABLE_MIN_SCHEMA_VERSION) {
    // Schema-3 durable-lane invariants, held to the same exact-equality and
    // SHA256_PATTERN rigor the workflow block gets above. Each block records
    // the consumer destination path, the installed bytes, and the source path
    // it was copied from, so `check` can report drift and stale sources and
    // `uninstall` knows exactly what it owns.
    for (const { field, destination, source } of DURABLE_MANAGED_RESOURCES) {
      const block = value[field];
      if (
        !isObject(block) ||
        block.path !== destination ||
        block.source !== source ||
        !SHA256_PATTERN.test(block.sha256 ?? "")
      ) {
        throw new Error(`${filePath}: ${field} ownership is malformed`);
      }
    }
  }
  // A schema-1 manifest decodes as a pre-provenance install and a schema-2 one
  // as a pre-durable install (value.schemaVersion is left as read); check
  // surfaces the migration and update rewrites it to the current schema.
  value.configuration = validateConfiguration(value.configuration ?? {});
  if (!isObject(value.resources) || !isObject(value.resources.variables)) {
    throw new Error(`${filePath}: resource ownership is malformed`);
  }
  const variableNames = Object.keys(value.resources.variables).sort();
  const expectedVariableNames = Object.keys(CONFIG_VARIABLES).sort();
  if (JSON.stringify(variableNames) !== JSON.stringify(expectedVariableNames)) {
    throw new Error(`${filePath}: variable ownership must contain only managed variables`);
  }
  for (const name of Object.keys(CONFIG_VARIABLES)) {
    const entry = value.resources.variables[name];
    assertOwnedResource(entry, `${filePath}: variable ${name}`);
    if (entry.value !== value.configuration[CONFIG_VARIABLES[name]]) {
      throw new Error(`${filePath}: variable ${name} must match the recorded configuration`);
    }
  }
  assertOwnedResource(value.resources.secret, `${filePath}: secret`);
  if (value.resources.secret.name !== SECRET_NAME) {
    throw new Error(`${filePath}: secret ownership is malformed`);
  }
  if (!Array.isArray(value.resources.labels)) {
    throw new Error(`${filePath}: label ownership must be an array`);
  }
  const labelNames = new Set();
  const managedLabelNames = new Set(ROUTING_LABELS.map(({ name }) => name));
  for (const label of value.resources.labels) {
    assertOwnedResource(label, `${filePath}: label`);
    if (
      typeof label.name !== "string" ||
      labelNames.has(label.name) ||
      !managedLabelNames.has(label.name)
    ) {
      throw new Error(`${filePath}: label ownership is malformed`);
    }
    labelNames.add(label.name);
  }
  for (const { name } of ROUTING_LABELS) {
    if (!labelNames.has(name)) {
      throw new Error(`${filePath}: label ownership is missing ${name}`);
    }
  }
  if (labelNames.size !== managedLabelNames.size) {
    throw new Error(`${filePath}: label ownership must contain only managed labels`);
  }
  return value;
}

export function manifestJson(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function variableValues(configuration) {
  return Object.fromEntries(
    Object.entries(CONFIG_VARIABLES).map(([name, field]) => [name, configuration[field]]),
  );
}

export function resolveConfiguration(options, existingManifest) {
  const existing = existingManifest?.configuration ?? DEFAULT_CONFIG;
  return validateConfiguration({
    provider: options.provider ?? existing.provider,
    cheapModel: options.cheapModel ?? existing.cheapModel,
    deepModel: options.deepModel ?? existing.deepModel,
  });
}

export function parseGitHubRemote(remote) {
  const trimmed = remote.trim().replace(/\/$/u, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/iu,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/iu,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/iu,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

export function resolveOverride({ tag, commit }) {
  if (!COMMIT_PATTERN.test(commit ?? "")) {
    throw new Error("--source-commit must be a 40-character hex commit");
  }
  // Both parts are required: a commit-only override would record (false, null),
  // indistinguishable from a dev checkout and breaking the (released, tag)
  // encoding. A declared .git-less artifact must carry its v<semver> tag.
  if (tag === null || tag === undefined || !RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error("--source-tag must be a v<semver> release tag");
  }
  // A .git-less artifact cannot verify bytes against a commit offline, so a
  // declared release always records released:false.
  return { commit, tag, released: false };
}

// Recognize an existing manual workflow by exact bytes. The current template
// (matched dynamically against templateSha) and every allow-listed historical
// hash are adoptable; anything else is unknown drift. Returns a bounded label
// for reporting, never the workflow content.
export function recognizeTemplate(workflowSha, templateSha, historical) {
  if (workflowSha === templateSha) return { label: "current source" };
  const match = historical.find((entry) => entry.sha256 === workflowSha);
  return match ? { label: match.tag } : null;
}

export function formatReport(report) {
  if (report.command === "check") {
    if (report.ok) return `Installation is healthy for ${report.repository}.`;
    return [
      `Installation drift detected for ${report.repository}:`,
      ...report.issues.map((issue) => `- ${issue}`),
    ].join("\n");
  }
  if (report.actions.length === 0) {
    return `${report.command}: nothing to do for ${report.repository}.`;
  }
  const heading = report.dryRun
    ? `${report.command} dry run for ${report.repository}:`
    : `${report.command} complete for ${report.repository}:`;
  return [heading, ...report.actions.map((action) => `- ${action}`)].join("\n");
}

export const HELP = `Usage:
  node scripts/install-consumer.mjs <install|update|adopt|check|uninstall> [options]

Common options:
  --target PATH          Consumer checkout (default: current directory)
  --github OWNER/REPO    GitHub repository; must match a GitHub origin when present
  --dry-run              Show changes without mutating files or GitHub
  --json                 Emit machine-readable output

Adopt (bring a manually installed workflow under management):
  Recognizes a current or allow-listed historical ai-review-router.yml,
  converges it to the current source, and records ownership. Accepts the
  install configuration/secret/source options below. Requires confirmation:
  --yes                  Confirm non-interactive adoption

Install/update/check configuration:
  --provider NAME        Single-key PR-Agent provider
  --cheap-model ID       Model for the cheap route
  --deep-model ID        Model for the deep route

Install/update/adopt secret input:
  --set-secret           Prompt through gh secret set
  --secret-stdin         Read the secret from standard input

Install/update/adopt source provenance (.git-less release artifact only):
  --source-tag vX.Y.Z    Declared release tag (records released:false)
  --source-commit SHA    Declared 40-hex source commit
                         (also SD_SOURCE_TAG / SD_SOURCE_COMMIT)

Uninstall options:
  --yes                  Confirm non-interactive uninstall
  --remove-secret        Also delete PR_AGENT_MODEL_API_KEY
  --remove-labels        Also delete labels created by this installer
`;

export function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const command = argv[0];
  if (!["install", "update", "adopt", "check", "uninstall"].includes(command)) {
    throw new Error(`first argument must be install, update, adopt, check, or uninstall`);
  }
  const options = { command };
  const values = new Map([
    ["--target", "target"],
    ["--github", "repository"],
    ["--provider", "provider"],
    ["--cheap-model", "cheapModel"],
    ["--deep-model", "deepModel"],
    ["--source-tag", "sourceTag"],
    ["--source-commit", "sourceCommit"],
  ]);
  const flags = new Map([
    ["--dry-run", "dryRun"],
    ["--json", "json"],
    ["--yes", "yes"],
    ["--remove-secret", "removeSecret"],
    ["--remove-labels", "removeLabels"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (values.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[values.get(argument)] = value;
      index += 1;
    } else if (flags.has(argument)) {
      options[flags.get(argument)] = true;
    } else if (argument === "--set-secret") {
      if (options.secretMode) throw new Error("choose only one secret input mode");
      options.secretMode = "interactive";
    } else if (argument === "--secret-stdin") {
      if (options.secretMode) throw new Error("choose only one secret input mode");
      options.secretMode = "stdin";
    } else {
      throw new Error(`unknown option ${argument}`);
    }
  }
  if (command === "uninstall" && (options.provider || options.cheapModel || options.deepModel)) {
    throw new Error("uninstall does not accept provider or model options");
  }
  if (!["install", "update", "adopt"].includes(command) && options.secretMode) {
    throw new Error(`${command} does not accept secret input`);
  }
  // --yes confirms a non-interactive uninstall or adopt; the destructive
  // cleanup flags remain uninstall-only.
  if (command !== "uninstall" && (options.removeSecret || options.removeLabels)) {
    throw new Error(`${command} does not accept uninstall cleanup options`);
  }
  if (!["uninstall", "adopt"].includes(command) && options.yes) {
    throw new Error(`${command} does not accept --yes`);
  }
  if (!["install", "update", "adopt"].includes(command) && (options.sourceTag || options.sourceCommit)) {
    throw new Error(`${command} does not accept source provenance overrides`);
  }
  return options;
}
