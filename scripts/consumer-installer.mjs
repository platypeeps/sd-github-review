import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_PATH = ".github/sd-github-review.json";
export const WORKFLOW_PATH = ".github/workflows/ai-review-router.yml";
export const TEMPLATE_PATH = "examples/pr-agent-router.yml";
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
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LIFECYCLE_STATES = new Set(["pending", "active", "uninstalling"]);
const MAX_MODEL_LENGTH = 256;

// Consumer-manifest schema version. Bumped 1 -> 2 to record source provenance
// (commit, tag, released) on the source template. Distinct from the action
// contract descriptor's schemaVersion in config/routed-review-setup-v1.json.
export const MANIFEST_SCHEMA_VERSION = 2;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_TAG_PATTERN =
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
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redact(value, secret) {
  if (!secret || typeof value !== "string") return value;
  return value.replaceAll(secret, "[redacted]");
}

function commandFailure(command, args, result, secret) {
  const stderr = redact(result.stderr?.trim(), secret);
  const detail = stderr || `exit status ${result.status ?? "unknown"}`;
  return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    input: options.input,
    stdio: options.inherit ? "inherit" : undefined,
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${redact(result.error.message, options.secret)}`);
  }
  if (result.status !== 0) {
    throw commandFailure(command, args, result, options.secret);
  }
  return result.stdout ?? "";
}

function runJson(command, args) {
  const output = runCommand(command, args);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${command} ${args.join(" ")} returned invalid JSON`);
  }
}

export class GitHubCli {
  async inspect(repository) {
    const repo = runJson("gh", ["repo", "view", repository, "--json", "nameWithOwner"]);
    const variables = runJson("gh", [
      "variable",
      "list",
      "--repo",
      repository,
      "--json",
      "name,value",
    ]);
    const secrets = runJson("gh", [
      "secret",
      "list",
      "--repo",
      repository,
      "--json",
      "name",
    ]);
    const labels = runJson("gh", [
      "label",
      "list",
      "--repo",
      repository,
      "--limit",
      "1000",
      "--json",
      "name,color,description",
    ]);
    return {
      repository: repo.nameWithOwner,
      variables: new Map(variables.map(({ name, value }) => [name, value])),
      secrets: new Set(secrets.map(({ name }) => name)),
      labels: new Map(labels.map((label) => [label.name, label])),
    };
  }

  async setVariable(repository, name, value) {
    runCommand("gh", ["variable", "set", name, "--repo", repository, "--body", value]);
  }

  async deleteVariable(repository, name) {
    runCommand("gh", ["variable", "delete", name, "--repo", repository]);
  }

  async createLabel(repository, label) {
    runCommand("gh", [
      "label",
      "create",
      label.name,
      "--repo",
      repository,
      "--color",
      label.color,
      "--description",
      label.description,
    ]);
  }

  async deleteLabel(repository, name) {
    runCommand("gh", ["label", "delete", name, "--repo", repository, "--yes"]);
  }

  async setSecret(repository, { interactive = false, value } = {}) {
    const args = ["secret", "set", SECRET_NAME, "--repo", repository];
    if (interactive) {
      runCommand("gh", args, { inherit: true });
      return;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("secret input must be nonempty");
    }
    runCommand("gh", args, { input: value, secret: value });
  }

  async deleteSecret(repository) {
    runCommand("gh", ["secret", "delete", SECRET_NAME, "--repo", repository]);
  }
}

function gitOutput(target, args) {
  try {
    return execFileSync("git", ["-C", target, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = typeof error.stderr === "string" && error.stderr.trim()
      ? error.stderr.trim()
      : error.message;
    throw new Error(`${target}: git ${args.join(" ")} failed: ${detail}`);
  }
}

// Git seam for the installer's own source root, mirroring gitOutput. Injected in
// tests via dependencies.gitImpl so provenance resolution is deterministic.
function makeSourceGit(sourceRoot) {
  return {
    head() {
      return gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
    },
    exactTag() {
      try {
        return gitOutput(sourceRoot, ["describe", "--tags", "--exact-match", "HEAD"]);
      } catch {
        return null;
      }
    },
    templateDirty() {
      return gitOutput(sourceRoot, ["status", "--porcelain", "--", TEMPLATE_PATH]).length > 0;
    },
  };
}

async function readSourceVersion(sourceRoot) {
  const raw = await readOptional(path.join(sourceRoot, "package.json"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function resolveOverride({ tag, commit }) {
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

// Resolve the installer's own source release identity from its source root.
// released:true is the single bytes-verified path: an exact v<version> tag on
// HEAD with a clean template working tree. Any other git state records
// (false, null); an operator override records the declared (false, v-tag).
export function resolveSourceRelease({ sourceRoot, gitImpl, version, override }) {
  if (override && (override.commit || override.tag)) {
    return resolveOverride(override);
  }
  const git = gitImpl ?? makeSourceGit(sourceRoot);
  let commit;
  try {
    commit = git.head();
  } catch {
    throw new Error(
      "installer source has no git identity; run from a cloned release tag or pass --source-tag/--source-commit",
    );
  }
  if (!COMMIT_PATTERN.test(commit ?? "")) {
    throw new Error("installer source HEAD is not a 40-character hex commit");
  }
  const exactTag = git.exactTag();
  if (
    exactTag &&
    version &&
    exactTag === `v${version}` &&
    RELEASE_TAG_PATTERN.test(exactTag) &&
    !git.templateDirty()
  ) {
    return { commit, tag: exactTag, released: true };
  }
  return { commit, tag: null, released: false };
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

async function pathExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A-005 containment guard. Every managed read, write, rename, and removal must
// stay beneath the canonical consumer worktree without following a
// repository-controlled symlink ancestor. Errors are bounded to the managed
// path relative to the root; they never embed a symlink target, the escaping
// destination, or any other unrelated host path.
const CONTAINMENT_MESSAGE = "refusing to follow a symlinked or escaping installer path";

function containmentError(relativeParts, reason = CONTAINMENT_MESSAGE) {
  return new Error(`${relativeParts.join(path.sep)}: ${reason}`);
}

function managedRelativeParts(root, targetPath) {
  const relative = path.relative(root, targetPath);
  if (
    relative === "" ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    // Bounded: report only the intended leaf name, never the root or an
    // escaping absolute destination.
    throw new Error(`${path.basename(targetPath)}: ${CONTAINMENT_MESSAGE}`);
  }
  return relative.split(path.sep);
}

async function inspectComponent(componentPath, lstatImpl) {
  try {
    return await lstatImpl(componentPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Inspect every existing ancestor from the canonical root down to targetPath
// with lstat (never stat) so a symlink component is rejected instead of
// followed. A missing component ends the walk: nothing beyond it can exist.
async function assertContainedPath(root, targetPath, lstatImpl) {
  const relativeParts = managedRelativeParts(root, path.resolve(targetPath));
  let current = root;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    const stats = await inspectComponent(current, lstatImpl);
    if (stats === null) return;
    const traversed = relativeParts.slice(0, index + 1);
    if (stats.isSymbolicLink()) {
      throw containmentError(traversed);
    }
    if (index === relativeParts.length - 1) {
      if (!stats.isFile()) {
        throw containmentError(traversed, "managed path is not a regular file");
      }
    } else if (!stats.isDirectory()) {
      throw containmentError(traversed, "managed ancestor is not a directory");
    }
  }
}

// Create every missing directory from the canonical root down to dirPath one
// component at a time. A recursive mkdir would follow a symlink swapped into an
// ancestor and create directories outside the root; creating a single component
// at a time under an lstat-verified real-directory parent keeps every mkdir
// contained. A component that already exists as a symlink or non-directory is
// rejected, and a component swapped to a symlink between its check and creation
// makes the non-recursive mkdir fail with EEXIST rather than follow it.
async function assertContainedDir(root, dirPath, lstatImpl) {
  const resolved = path.resolve(dirPath);
  if (resolved === root) return;
  const relativeParts = managedRelativeParts(root, resolved);
  let current = root;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    const stats = await inspectComponent(current, lstatImpl);
    const traversed = relativeParts.slice(0, index + 1);
    if (stats === null) {
      await mkdir(current);
    } else if (stats.isSymbolicLink()) {
      throw containmentError(traversed);
    } else if (!stats.isDirectory()) {
      throw containmentError(traversed, "managed ancestor is not a directory");
    }
  }
}

function makePathGuard(root, lstatImpl = lstat) {
  const canonicalRoot = path.resolve(root);
  return {
    root: canonicalRoot,
    assert(targetPath) {
      return assertContainedPath(canonicalRoot, targetPath, lstatImpl);
    },
    mkdirWithin(targetPath) {
      return assertContainedDir(
        canonicalRoot,
        path.dirname(path.resolve(targetPath)),
        lstatImpl,
      );
    },
  };
}

async function atomicWrite(guard, filePath, content) {
  // Create the destination directory one component at a time, rejecting a
  // symlinked ancestor before creating any child beneath it; a recursive mkdir
  // would follow a swapped-in symlink and create directories outside the root.
  // Create the destination directory one component at a time, rejecting a
  // symlinked ancestor before creating any child beneath it; a recursive mkdir
  // would follow a swapped-in symlink and create directories outside the root.
  await guard.mkdirWithin(filePath);
  // Re-check containment after the directory exists and immediately before the
  // temp write, so the write is protected symmetrically with the rename below:
  // a symlink swapped into an ancestor is caught before any bytes are written.
  await guard.assert(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
    // Re-check containment immediately before the rename to narrow the
    // time-of-check/time-of-use window on the destination ancestors.
    await guard.assert(filePath);
    await rename(temporaryPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the temp file on any failure. The temp name
    // carries an unpredictable random suffix, so an ancestor swapped to a
    // symlink cannot steer this unlink onto an attacker-named external file:
    // it either removes the real temp file or fails ENOENT through the swap.
    // The pre-write `wx` write and the pre-write/pre-rename containment
    // asserts are what prevent writing *through* a swap; this cleanup only
    // targets the unpredictable temp path and never a caller-supplied one.
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function removeOptional(guard, filePath) {
  // Re-check containment immediately before the removal for the same reason.
  await guard.assert(filePath);
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function normalizeRepository(value, field = "GitHub repository") {
  if (typeof value !== "string" || !REPOSITORY_PATTERN.test(value)) {
    throw new Error(`${field} must use the OWNER/REPO form`);
  }
  return value;
}

function sameRepository(left, right) {
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
    (value.schemaVersion !== 1 && value.schemaVersion !== MANIFEST_SCHEMA_VERSION) ||
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
  if (value.schemaVersion === MANIFEST_SCHEMA_VERSION) {
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
  // A schema-1 manifest decodes as a pre-provenance install (value.schemaVersion
  // stays 1); check surfaces the migration and update rewrites it to schema 2.
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

function manifestJson(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function variableValues(configuration) {
  return Object.fromEntries(
    Object.entries(CONFIG_VARIABLES).map(([name, field]) => [name, configuration[field]]),
  );
}

function resolveConfiguration(options, existingManifest) {
  const existing = existingManifest?.configuration ?? DEFAULT_CONFIG;
  return validateConfiguration({
    provider: options.provider ?? existing.provider,
    cheapModel: options.cheapModel ?? existing.cheapModel,
    deepModel: options.deepModel ?? existing.deepModel,
  });
}

async function resolveTarget(options, github) {
  const targetInput = path.resolve(options.target ?? process.cwd());
  const root = gitOutput(targetInput, ["rev-parse", "--show-toplevel"]);
  let originRepository = null;
  try {
    originRepository = parseGitHubRemote(gitOutput(root, ["remote", "get-url", "origin"]));
  } catch {
    if (!options.repository) {
      throw new Error(
        `${root}: no readable GitHub origin; configure origin or pass --github OWNER/REPO`,
      );
    }
  }
  const requestedRepository = options.repository
    ? normalizeRepository(options.repository)
    : originRepository;
  if (!requestedRepository) {
    throw new Error(`${root}: origin is not a supported GitHub remote; pass --github OWNER/REPO`);
  }
  if (originRepository && !sameRepository(originRepository, requestedRepository)) {
    throw new Error(
      `--github ${requestedRepository} does not match origin ${originRepository}`,
    );
  }
  const snapshot = await github.inspect(requestedRepository);
  const canonicalRepository = normalizeRepository(snapshot.repository, "GitHub response repository");
  if (!sameRepository(canonicalRepository, requestedRepository)) {
    throw new Error(
      `GitHub resolved ${requestedRepository} as unexpected repository ${canonicalRepository}`,
    );
  }
  return { root, repository: canonicalRepository, snapshot };
}

async function loadLocalState(guard, root) {
  const manifestFile = path.join(root, MANIFEST_PATH);
  const workflowFile = path.join(root, WORKFLOW_PATH);
  await guard.assert(manifestFile);
  await guard.assert(workflowFile);
  const manifestSource = await readOptional(manifestFile);
  return {
    manifestFile,
    workflowFile,
    manifest: manifestSource === null ? null : decodeManifest(manifestSource, manifestFile),
    workflow: await readOptional(workflowFile),
  };
}

function assertManifestRepository(manifest, repository) {
  if (manifest && !sameRepository(manifest.repository, repository)) {
    throw new Error(
      `${MANIFEST_PATH} manages ${manifest.repository}, not ${repository}`,
    );
  }
}

function assertWorkflowCanBeManaged(command, local, templateSource) {
  if (!local.manifest) {
    if (command === "update") {
      throw new Error(`update requires ${MANIFEST_PATH}; run install first`);
    }
    if (local.workflow !== null && local.workflow !== templateSource) {
      throw new Error(`${WORKFLOW_PATH} exists and is not managed by sd-github-review`);
    }
    return;
  }
  if (local.manifest.state === "uninstalling") {
    throw new Error("an uninstall is incomplete; rerun uninstall before installing or updating");
  }
  if (
    local.workflow === null &&
    local.manifest.state !== "pending"
  ) {
    throw new Error(`${WORKFLOW_PATH} is missing from an active managed installation`);
  }
  if (
    local.workflow !== null &&
    sha256(local.workflow) !== local.manifest.workflow.sha256
  ) {
    throw new Error(
      `${WORKFLOW_PATH} was modified after installation; preserve or reconcile it manually before update`,
    );
  }
}

function planResources(configuration, snapshot, existingManifest, setSecretRequested) {
  const actions = [];
  const variables = {};
  for (const [name, desiredValue] of Object.entries(variableValues(configuration))) {
    const prior = existingManifest?.resources.variables[name];
    const currentValue = snapshot.variables.get(name);
    let owned = prior?.owned ?? currentValue === undefined;
    if (currentValue === undefined) {
      owned = true;
      actions.push({ kind: "set-variable", name, value: desiredValue });
    } else if (currentValue !== desiredValue) {
      if (!prior?.owned) {
        throw new Error(
          `GitHub variable ${name} already exists with a different unowned value; reconcile it manually`,
        );
      }
      actions.push({ kind: "set-variable", name, value: desiredValue });
    }
    variables[name] = { value: desiredValue, owned };
  }

  const labels = ROUTING_LABELS.map((label) => {
    const prior = existingManifest?.resources.labels.find(({ name }) => name === label.name);
    const exists = snapshot.labels.has(label.name);
    if (!exists) actions.push({ kind: "create-label", label });
    return { name: label.name, owned: exists ? (prior?.owned ?? false) : true };
  });

  const secretExists = snapshot.secrets.has(SECRET_NAME);
  const priorSecret = existingManifest?.resources.secret;
  if (!secretExists && !setSecretRequested) {
    throw new Error(
      `${SECRET_NAME} is missing; rerun with --set-secret or pipe it to --secret-stdin`,
    );
  }
  if (setSecretRequested) actions.push({ kind: "set-secret" });
  const secret = {
    name: SECRET_NAME,
    owned: secretExists ? (priorSecret?.owned ?? false) : true,
  };
  return { actions, resources: { variables, secret, labels } };
}

function createManifest({ state, repository, templateSha, configuration, resources, release }) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    tool: "sd-github-review",
    state,
    repository,
    workflow: { path: WORKFLOW_PATH, sha256: templateSha },
    source: {
      template: TEMPLATE_PATH,
      sha256: templateSha,
      commit: release.commit,
      tag: release.tag,
      released: release.released,
    },
    configuration,
    resources,
  };
}

function publicAction(action) {
  switch (action.kind) {
    case "set-variable":
      return `set GitHub variable ${action.name}`;
    case "create-label":
      return `create GitHub label ${action.label.name}`;
    case "set-secret":
      return `set GitHub secret ${SECRET_NAME}`;
    case "delete-variable":
      return `delete GitHub variable ${action.name}`;
    case "delete-label":
      return `delete GitHub label ${action.name}`;
    case "delete-secret":
      return `delete GitHub secret ${SECRET_NAME}`;
    default:
      throw new Error(`unsupported lifecycle action ${action.kind}`);
  }
}

async function applyRemoteActions(github, repository, actions, options) {
  for (const action of actions) {
    switch (action.kind) {
      case "set-variable":
        await github.setVariable(repository, action.name, action.value);
        break;
      case "create-label":
        await github.createLabel(repository, action.label);
        break;
      case "set-secret":
        await github.setSecret(repository, {
          interactive: options.secretMode === "interactive",
          value: options.secretInput,
        });
        break;
      case "delete-variable":
        await github.deleteVariable(repository, action.name);
        break;
      case "delete-label":
        await github.deleteLabel(repository, action.name);
        break;
      case "delete-secret":
        await github.deleteSecret(repository);
        break;
      default:
        throw new Error(`unsupported lifecycle action ${action.kind}`);
    }
  }
}

function overrideInput(optionValue, envValue, envName) {
  if (optionValue !== undefined && optionValue !== null) {
    return optionValue;
  }
  if (envValue !== undefined && envValue !== null) {
    // An explicitly-set-but-empty env var must not silently skip the declared
    // provenance path; mirror parseReleaseTag's empty-env handling.
    if (envValue === "") {
      throw new Error(`${envName} is set but empty; provide a value or unset it`);
    }
    return envValue;
  }
  return undefined;
}

function sourceOverride(options, env) {
  const tag = overrideInput(options.sourceTag, env.SD_SOURCE_TAG, "SD_SOURCE_TAG");
  const commit = overrideInput(options.sourceCommit, env.SD_SOURCE_COMMIT, "SD_SOURCE_COMMIT");
  return tag || commit ? { tag: tag ?? null, commit: commit ?? null } : undefined;
}

async function installOrUpdate(command, options, dependencies) {
  const sourceRoot = dependencies.sourceRoot ?? path.resolve(import.meta.dirname, "..");
  const templateSource = await readFile(path.join(sourceRoot, TEMPLATE_PATH), "utf8");
  const templateSha = sha256(templateSource);
  const version = await readSourceVersion(sourceRoot);
  const release = resolveSourceRelease({
    sourceRoot,
    gitImpl: dependencies.gitImpl,
    version,
    override: sourceOverride(options, dependencies.env ?? process.env),
  });
  const github = dependencies.github ?? new GitHubCli();
  const target = await resolveTarget(options, github);
  const guard = makePathGuard(target.root, dependencies.lstat);
  const local = await loadLocalState(guard, target.root);
  assertManifestRepository(local.manifest, target.repository);
  assertWorkflowCanBeManaged(command, local, templateSource);
  const configuration = resolveConfiguration(options, local.manifest);
  const setSecretRequested = options.secretMode === "interactive" || options.secretMode === "stdin";
  const { actions, resources } = planResources(
    configuration,
    target.snapshot,
    local.manifest,
    setSecretRequested,
  );
  const pendingManifest = createManifest({
    state: "pending",
    repository: target.repository,
    templateSha,
    configuration,
    resources,
    release,
  });
  const actionDescriptions = [
    `write ${MANIFEST_PATH} with pending state`,
    `write ${WORKFLOW_PATH}`,
    ...actions.map(publicAction),
    `write ${MANIFEST_PATH} with active state`,
  ];
  const report = {
    command,
    ok: true,
    dryRun: Boolean(options.dryRun),
    repository: target.repository,
    target: target.root,
    configuration,
    actions: actionDescriptions,
  };
  if (options.dryRun) return report;

  await atomicWrite(guard, local.manifestFile, manifestJson(pendingManifest));
  await atomicWrite(guard, local.workflowFile, templateSource);
  await applyRemoteActions(github, target.repository, actions, options);
  await atomicWrite(
    guard,
    local.manifestFile,
    manifestJson({ ...pendingManifest, state: "active" }),
  );
  return report;
}

// Recognize an existing manual workflow by exact bytes. The current template
// (matched dynamically against templateSha) and every allow-listed historical
// hash are adoptable; anything else is unknown drift. Returns a bounded label
// for reporting, never the workflow content.
function recognizeTemplate(workflowSha, templateSha, historical) {
  if (workflowSha === templateSha) return { label: "current source" };
  const match = historical.find((entry) => entry.sha256 === workflowSha);
  return match ? { label: match.tag } : null;
}

// A-019: adopt a manually installed workflow into installer ownership. Explicit
// only — never inferred during install/update. Recognizes an allow-listed
// historical or current template, plans ownership without claiming pre-existing
// unowned GitHub resources, requires confirmation, then writes pending -> active
// exactly like install so check/update/rollback/uninstall work afterward.
async function adoptInstallation(options, dependencies) {
  const sourceRoot = dependencies.sourceRoot ?? path.resolve(import.meta.dirname, "..");
  const templateSource = await readFile(path.join(sourceRoot, TEMPLATE_PATH), "utf8");
  const templateSha = sha256(templateSource);
  const version = await readSourceVersion(sourceRoot);
  const release = resolveSourceRelease({
    sourceRoot,
    gitImpl: dependencies.gitImpl,
    version,
    override: sourceOverride(options, dependencies.env ?? process.env),
  });
  const github = dependencies.github ?? new GitHubCli();
  const target = await resolveTarget(options, github);
  const guard = makePathGuard(target.root, dependencies.lstat);
  const local = await loadLocalState(guard, target.root);
  if (local.manifest) {
    throw new Error(
      `${MANIFEST_PATH} already manages this installation; use update instead of adopt`,
    );
  }
  if (local.workflow === null) {
    throw new Error(
      `${WORKFLOW_PATH} not found; nothing to adopt. Run install to create a managed installation`,
    );
  }
  const historical = dependencies.historicalTemplates ?? HISTORICAL_TEMPLATE_HASHES;
  const recognized = recognizeTemplate(sha256(local.workflow), templateSha, historical);
  if (!recognized) {
    // Bounded reconciliation guidance: never embed the unrecognized content.
    throw new Error(
      `${WORKFLOW_PATH} is not a recognized sd-github-review template; ` +
        "back up and remove it, then run install to reconcile it manually",
    );
  }
  const refreshWorkflow = recognized.label !== "current source";
  const configuration = resolveConfiguration(options, null);
  const setSecretRequested = options.secretMode === "interactive" || options.secretMode === "stdin";
  const { actions, resources } = planResources(
    configuration,
    target.snapshot,
    null,
    setSecretRequested,
  );
  const pendingManifest = createManifest({
    state: "pending",
    repository: target.repository,
    templateSha,
    configuration,
    resources,
    release,
  });
  const actionDescriptions = [
    `write ${MANIFEST_PATH} with pending state`,
    refreshWorkflow
      ? `refresh ${WORKFLOW_PATH} from adopted ${recognized.label} to current source`
      : `record ${WORKFLOW_PATH} ownership`,
    ...actions.map(publicAction),
    `write ${MANIFEST_PATH} with active state`,
  ];
  const report = {
    command: "adopt",
    ok: true,
    dryRun: Boolean(options.dryRun),
    repository: target.repository,
    target: target.root,
    configuration,
    adoptedFrom: recognized.label,
    actions: actionDescriptions,
  };
  if (options.dryRun) return report;

  if (!options.yes) {
    const confirm = dependencies.confirm;
    if (!confirm || !(await confirm(target.repository))) {
      throw new Error("adopt cancelled; pass --yes for non-interactive confirmation");
    }
  }

  await atomicWrite(guard, local.manifestFile, manifestJson(pendingManifest));
  // Converge the workflow to the current source. For a current-template adoption
  // these bytes already match; for a historical one this refreshes it in place.
  await atomicWrite(guard, local.workflowFile, templateSource);
  await applyRemoteActions(github, target.repository, actions, options);
  await atomicWrite(
    guard,
    local.manifestFile,
    manifestJson({ ...pendingManifest, state: "active" }),
  );
  return report;
}

async function checkInstallation(options, dependencies) {
  const sourceRoot = dependencies.sourceRoot ?? path.resolve(import.meta.dirname, "..");
  const templateSource = await readFile(path.join(sourceRoot, TEMPLATE_PATH), "utf8");
  const templateSha = sha256(templateSource);
  const version = await readSourceVersion(sourceRoot);
  let release = null;
  try {
    // check resolves provenance from the source root's own git identity only.
    // Operator overrides are an install/update-time declaration; honoring an
    // ambient SD_SOURCE_* env here would make read-only check nondeterministic.
    release = resolveSourceRelease({
      sourceRoot,
      gitImpl: dependencies.gitImpl,
      version,
    });
  } catch {
    // Source identity is unresolvable here; provenance drift is reported only
    // when a release identity is available. The byte-hash drift check below is
    // independent and still applies.
    release = null;
  }
  const github = dependencies.github ?? new GitHubCli();
  const target = await resolveTarget(options, github);
  const guard = makePathGuard(target.root, dependencies.lstat);
  const local = await loadLocalState(guard, target.root);
  const issues = [];
  if (!local.manifest) {
    issues.push(`${MANIFEST_PATH} is missing`);
  } else {
    if (!sameRepository(local.manifest.repository, target.repository)) {
      issues.push(`${MANIFEST_PATH} records ${local.manifest.repository}`);
    }
    if (local.manifest.state !== "active") {
      issues.push(`installation state is ${local.manifest.state}`);
    }
  }
  if (local.workflow === null) {
    issues.push(`${WORKFLOW_PATH} is missing`);
  } else if (local.manifest && sha256(local.workflow) !== local.manifest.workflow.sha256) {
    issues.push(`${WORKFLOW_PATH} differs from its managed hash`);
  }
  if (local.manifest && local.manifest.source.sha256 !== templateSha) {
    issues.push("a newer source workflow is available; run update");
  }
  if (local.manifest) {
    if (local.manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
      issues.push("manifest predates provenance tracking; run update to record provenance");
    } else if (release) {
      if (local.manifest.source.commit !== release.commit) {
        issues.push("a newer source commit is available; run update");
      } else if (
        local.manifest.source.released &&
        local.manifest.source.tag !== release.tag
      ) {
        issues.push("recorded release provenance no longer matches the source; run update");
      }
    }
  }

  const configuration = resolveConfiguration(options, local.manifest);
  if (
    local.manifest &&
    JSON.stringify(local.manifest.configuration) !== JSON.stringify(configuration)
  ) {
    issues.push("manifest configuration does not match the requested configuration");
  }
  for (const [name, desiredValue] of Object.entries(variableValues(configuration))) {
    const actualValue = target.snapshot.variables.get(name);
    if (actualValue === undefined) issues.push(`GitHub variable ${name} is missing`);
    else if (actualValue !== desiredValue) issues.push(`GitHub variable ${name} has drifted`);
  }
  if (!target.snapshot.secrets.has(SECRET_NAME)) {
    issues.push(`GitHub secret ${SECRET_NAME} is missing`);
  }
  for (const { name } of ROUTING_LABELS) {
    if (!target.snapshot.labels.has(name)) issues.push(`GitHub label ${name} is missing`);
  }
  return {
    command: "check",
    ok: issues.length === 0,
    dryRun: true,
    repository: target.repository,
    target: target.root,
    configuration,
    issues,
    actions: [],
  };
}

async function uninstall(options, dependencies) {
  const github = dependencies.github ?? new GitHubCli();
  const target = await resolveTarget(options, github);
  const guard = makePathGuard(target.root, dependencies.lstat);
  const local = await loadLocalState(guard, target.root);
  if (!local.manifest) {
    if (local.workflow !== null) {
      throw new Error(`${WORKFLOW_PATH} exists without ${MANIFEST_PATH}; refusing to remove it`);
    }
    return {
      command: "uninstall",
      ok: true,
      dryRun: Boolean(options.dryRun),
      repository: target.repository,
      target: target.root,
      actions: [],
    };
  }
  assertManifestRepository(local.manifest, target.repository);
  if (
    local.workflow !== null &&
    sha256(local.workflow) !== local.manifest.workflow.sha256
  ) {
    throw new Error(`${WORKFLOW_PATH} was modified; refusing to remove operator changes`);
  }
  if (!options.dryRun && !options.yes) {
    const confirm = dependencies.confirm;
    if (!confirm || !(await confirm(target.repository))) {
      throw new Error("uninstall cancelled; pass --yes for non-interactive confirmation");
    }
  }

  const actions = [];
  for (const [name, resource] of Object.entries(local.manifest.resources.variables)) {
    if (resource.owned && target.snapshot.variables.has(name)) {
      actions.push({ kind: "delete-variable", name });
    }
  }
  if (options.removeSecret && target.snapshot.secrets.has(SECRET_NAME)) {
    actions.push({ kind: "delete-secret" });
  }
  if (options.removeLabels) {
    for (const label of local.manifest.resources.labels) {
      if (label.owned && target.snapshot.labels.has(label.name)) {
        actions.push({ kind: "delete-label", name: label.name });
      }
    }
  }
  const actionDescriptions = [
    `write ${MANIFEST_PATH} with uninstalling state`,
    ...actions.map(publicAction),
    `remove ${WORKFLOW_PATH}`,
    `remove ${MANIFEST_PATH}`,
  ];
  const report = {
    command: "uninstall",
    ok: true,
    dryRun: Boolean(options.dryRun),
    repository: target.repository,
    target: target.root,
    actions: actionDescriptions,
  };
  if (options.dryRun) return report;

  await atomicWrite(
    guard,
    local.manifestFile,
    manifestJson({ ...local.manifest, state: "uninstalling" }),
  );
  await applyRemoteActions(github, target.repository, actions, options);
  await removeOptional(guard, local.workflowFile);
  await removeOptional(guard, local.manifestFile);
  return report;
}

export async function runConsumerInstaller(options, dependencies = {}) {
  if (!options || typeof options.command !== "string") {
    throw new Error("a lifecycle command is required");
  }
  if (options.secretMode && !["interactive", "stdin"].includes(options.secretMode)) {
    throw new Error("secret mode must be interactive or stdin");
  }
  switch (options.command) {
    case "install":
    case "update":
      return installOrUpdate(options.command, options, dependencies);
    case "adopt":
      return adoptInstallation(options, dependencies);
    case "check":
      if (options.secretMode) throw new Error("check does not accept secret input");
      return checkInstallation(options, dependencies);
    case "uninstall":
      if (options.secretMode) throw new Error("uninstall does not accept secret input");
      return uninstall(options, dependencies);
    default:
      throw new Error(`unsupported lifecycle command ${options.command}`);
  }
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

Install/update secret input:
  --set-secret           Prompt through gh secret set
  --secret-stdin         Read the secret from standard input

Install/update source provenance (.git-less release artifact only):
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

export async function hasManagedFiles(target) {
  const root = path.resolve(target);
  return {
    manifest: await pathExists(path.join(root, MANIFEST_PATH)),
    workflow: await pathExists(path.join(root, WORKFLOW_PATH)),
  };
}
