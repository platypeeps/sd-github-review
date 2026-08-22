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
// The accepted values of REVIEW_ROUTE_MODE. This set is not independent: the
// installed event-driven lane gates on exactly the same values in its own
// `case` statement (examples/pr-agent-router.yml), and a variable this
// installer writes but that lane rejects is worse than an unmanaged one. A test
// extracts the lane's pattern and asserts set equality, so the two cannot drift
// apart in one direction only.
export const ROUTE_MODES = Object.freeze(["auto", "cheap", "deep", "copilot", "none"]);
const ROUTE_MODE_SET = new Set(ROUTE_MODES);
// The route modes that reach no PR-Agent provider and so do not need
// PR_AGENT_MODEL_API_KEY present to install. Both installed lanes bind the
// secret only inside `vars.PR_AGENT_MODEL_PROVIDER == '<name>'` guards that
// fall through to '' (examples/sd-review.yml, examples/pr-agent-router.yml), so
// under these modes the credential is never read.
//
// This is an allow-list of the safe modes rather than a list of the strict
// ones, which is what keeps the unknown cases strict: a pre-schema-4 manifest
// carries no recorded route mode, and a future mode added to ROUTE_MODES
// without a decision here still requires the secret. Relaxing by default would
// move the failure from install time to review time, which is the silent
// failure the durable lane exists to remove.
//
// `auto` is deliberately absent. It names no provider up front, but src/router.js
// resolves it at review time and can lower it to cheap or deep, both PR-Agent
// routes.
const PROVIDER_SECRET_OPTIONAL_ROUTE_MODES = new Set(["copilot", "none"]);

// True when installing or checking under `routeMode` requires the PR-Agent
// provider credential. Unknown and undefined modes return true.
export function routeModeNeedsProviderSecret(routeMode) {
  return !PROVIDER_SECRET_OPTIONAL_ROUTE_MODES.has(routeMode);
}
// The backend descriptor the durable lane reads from SD_REVIEW_<ROUTE>_BACKEND_V1.
// Its shape must satisfy the action's `decodeBackend` (src/protocol.js) and be
// `kind: external`, since selectedBackend rejects anything else for a
// `{route}-backend` input.
//
// `model` is the configured model verbatim, not `${provider}/${model}`.
// validateConfiguration already requires every model but an openai one to carry
// its own `<provider>/` prefix, so concatenating would double it.
//
// `reviewAuthors` is load-bearing rather than cosmetic: it is how the action
// decides which review comments count as this backend's findings. The installed
// PR-Agent job runs with `GITHUB__USER_TOKEN: ${{ github.token }}`, so it posts
// as the Actions bot. Verified against real PR-Agent comments in the pilot
// rather than assumed.
function backendDescriptor({ model, costTier, qualityTier }) {
  return {
    id: "pr-agent",
    label: "PR-Agent",
    kind: "external",
    model,
    costTier,
    qualityTier,
    capabilities: ["review", "conversation-comments"],
    reviewAuthors: ["github-actions[bot]"],
    checkNames: [],
    findingChannels: ["conversation-comment"],
    supportsRerequest: true,
    limitations: ["Inline comments depend on adapter configuration"],
  };
}

// The managed repository variables, keyed by variable name. Every downstream
// behaviour derives from this table: `variableValues` feeds the install/update
// plan and the `check` drift loop, and the manifest's recorded variable block
// drives `uninstall`. Keeping the two entry kinds in one table rather than
// adding a second list beside it is what keeps `install`, `update`, `check`, and
// `uninstall` reading the same set — a parallel list drifts from this one.
//
// Two entry kinds:
//   { field }            the variable carries a configuration field verbatim
//   { derive, model }    the variable carries a value synthesized from the
//                        configuration; `model` names the configuration field
//                        the synthesized descriptor's `model` must equal, which
//                        is what the decoder checks in place of an equality it
//                        cannot assert (see decodeManifest).
//
// The set is version-scoped, because names joined over time: a manifest written
// before REVIEW_ROUTE_MODE joined at schema 4 records three variables, one
// written before the two backend descriptors joined at schema 5 records four,
// and both must keep decoding.
const LEGACY_CONFIG_VARIABLES = Object.freeze({
  PR_AGENT_MODEL_PROVIDER: Object.freeze({ field: "provider" }),
  CHEAP_REVIEW_MODEL: Object.freeze({ field: "cheapModel" }),
  DEEP_REVIEW_MODEL: Object.freeze({ field: "deepModel" }),
});
const ROUTE_MODE_CONFIG_VARIABLES = Object.freeze({
  ...LEGACY_CONFIG_VARIABLES,
  REVIEW_ROUTE_MODE: Object.freeze({ field: "routeMode" }),
});
const CONFIG_VARIABLES = Object.freeze({
  ...ROUTE_MODE_CONFIG_VARIABLES,
  SD_REVIEW_CHEAP_BACKEND_V1: Object.freeze({
    model: "cheapModel",
    derive: (configuration) =>
      backendDescriptor({
        model: configuration.cheapModel,
        costTier: "low",
        qualityTier: "standard",
      }),
  }),
  SD_REVIEW_DEEP_BACKEND_V1: Object.freeze({
    model: "deepModel",
    derive: (configuration) =>
      backendDescriptor({
        model: configuration.deepModel,
        costTier: "medium",
        qualityTier: "advanced",
      }),
  }),
});
export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LIFECYCLE_STATES = new Set(["pending", "active", "uninstalling"]);
const MAX_MODEL_LENGTH = 256;

// Consumer-manifest schema version. Bumped 1 -> 2 to record source provenance
// (commit, tag, released) on the source template, then 2 -> 3 to record the two
// resources the durable lane adds: the setup discovery descriptor and the
// durable workflow, then 3 -> 4 to bring REVIEW_ROUTE_MODE under management,
// then 4 -> 5 to bring the two durable backend descriptors under management.
// Distinct from the action contract descriptor's own schemaVersion in
// config/routed-review-setup-v1.json.
//
// Required fields per version, so the decoder can be read against the matrix:
//
//   | version | workflow + source | provenance | descriptor + durableWorkflow | REVIEW_ROUTE_MODE | SD_REVIEW_*_BACKEND_V1 |
//   | 1       | required          | absent     | absent                       | absent            | absent                 |
//   | 2       | required          | required   | absent                       | absent            | absent                 |
//   | 3       | required          | required   | required                     | absent            | absent                 |
//   | 4       | required          | required   | required                     | required          | absent                 |
//   | 5       | required          | required   | required                     | required          | required               |
export const MANIFEST_SCHEMA_VERSION = 5;
const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = new Set([1, 2, 3, 4, 5]);
// Provenance became mandatory at schema 2 and stays mandatory afterwards.
// Gating it on `=== MANIFEST_SCHEMA_VERSION` would silently stop validating
// source.commit/tag/released on every schema-2 manifest the fleet is running.
export const PROVENANCE_MIN_SCHEMA_VERSION = 2;
// The durable lane's two managed resources became mandatory at schema 3.
export const DURABLE_MIN_SCHEMA_VERSION = 3;
// Route-mode ownership became mandatory at schema 4. Same rule as the two tiers
// above: gate on the version the requirement was introduced at, never on
// equality with MANIFEST_SCHEMA_VERSION, or bumping the constant narrows an
// existing tier instead of adding one.
export const ROUTE_MODE_MIN_SCHEMA_VERSION = 4;
// The two durable backend descriptors became mandatory at schema 5. Same rule
// again: gate on the version the requirement was introduced at.
export const BACKEND_MIN_SCHEMA_VERSION = 5;

// The managed variable set a manifest at the given schema version is expected to
// record. Callers reading a manifest must use this rather than CONFIG_VARIABLES
// directly, or every pre-schema-5 manifest in the fleet fails to decode.
function configVariablesForSchema(schemaVersion) {
  if (schemaVersion >= BACKEND_MIN_SCHEMA_VERSION) return CONFIG_VARIABLES;
  if (schemaVersion >= ROUTE_MODE_MIN_SCHEMA_VERSION) return ROUTE_MODE_CONFIG_VARIABLES;
  return LEGACY_CONFIG_VARIABLES;
}

// Every variable name this tier manages, independent of any configuration.
// Deliberately not `Object.keys(variableValues(someConfig))`: that filters out
// names whose backing field the given configuration leaves unset, so a default
// configuration reports REVIEW_ROUTE_MODE as unmanaged when it is merely
// unpopulated. Callers asking "is this name under management" -- which is what
// decides whether `check` can see it and `uninstall` removes it -- want this.
export const MANAGED_VARIABLE_NAMES = Object.freeze(Object.keys(CONFIG_VARIABLES));
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
  // Superseded by the 0.5.0 pin advance. Missing for the whole v0.4.0 cycle,
  // which left anyone who copied that release's template un-adoptable: `adopt`
  // matches exact bytes against this list plus the current source, and v0.4.0's
  // bytes were in neither. A test derives the expected set from the release
  // tags, so the next release cannot repeat it silently.
  Object.freeze({
    tag: "v0.4.0",
    sha256: "eba0bb9e767b2302ea13c3dc999d977470721eee6ace71b9585a7da7305a28f7",
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

// `requireRouteMode` is the schema-4 tier expressed as an argument. A manifest
// below that tier carries no route mode and must still validate; a manifest at
// or above it, and every install/update/adopt run, must carry one.
export function validateConfiguration(configuration, { requireRouteMode = false } = {}) {
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
  const routeMode = configuration.routeMode;
  if (routeMode === undefined) {
    if (requireRouteMode) {
      throw new Error(
        `route mode is required; pass --route-mode with one of: ${ROUTE_MODES.join(", ")}`,
      );
    }
    return {
      provider,
      cheapModel: configuration.cheapModel,
      deepModel: configuration.deepModel,
    };
  }
  if (!ROUTE_MODE_SET.has(routeMode)) {
    throw new Error(`route mode must be one of: ${ROUTE_MODES.join(", ")}`);
  }
  return {
    provider,
    cheapModel: configuration.cheapModel,
    deepModel: configuration.deepModel,
    routeMode,
  };
}

// Where a route mode comes from, in precedence order: the operator's explicit
// flag, then what the manifest already records, then a value the repository
// already carries. The last case is the manual-install and adopt path, and
// `planResources` records such a variable unowned, so `uninstall` leaves it.
//
// Returns undefined when nothing resolves. That is fatal for install/update/
// adopt and merely absent for `check`, so the decision belongs to the caller.
export function resolveRouteMode({ optionValue, manifestValue, observedValue }) {
  if (optionValue !== undefined) {
    if (!ROUTE_MODE_SET.has(optionValue)) {
      throw new Error(`--route-mode must be one of: ${ROUTE_MODES.join(", ")}`);
    }
    return optionValue;
  }
  if (manifestValue !== undefined) return manifestValue;
  if (observedValue !== undefined) {
    if (!ROUTE_MODE_SET.has(observedValue)) {
      throw new Error(
        `GitHub variable REVIEW_ROUTE_MODE holds an unsupported value; set it to one of ${ROUTE_MODES.join(", ")} or pass --route-mode`,
      );
    }
    return observedValue;
  }
  return undefined;
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
  // Each pre-current schema decodes as the tier it was written at, with
  // value.schemaVersion left as read: schema 1 as a pre-provenance install,
  // schema 2 as a pre-durable one, and schema 3 as a pre-route-mode one. `check`
  // surfaces the migration and `update` rewrites it to the current schema.
  value.configuration = validateConfiguration(value.configuration ?? {}, {
    requireRouteMode: value.schemaVersion >= ROUTE_MODE_MIN_SCHEMA_VERSION,
  });
  if (!isObject(value.resources) || !isObject(value.resources.variables)) {
    throw new Error(`${filePath}: resource ownership is malformed`);
  }
  const managedVariables = configVariablesForSchema(value.schemaVersion);
  const variableNames = Object.keys(value.resources.variables).sort();
  const expectedVariableNames = Object.keys(managedVariables).sort();
  if (JSON.stringify(variableNames) !== JSON.stringify(expectedVariableNames)) {
    throw new Error(`${filePath}: variable ownership must contain only managed variables`);
  }
  for (const [name, expectation] of Object.entries(managedVariables)) {
    const entry = value.resources.variables[name];
    assertOwnedResource(entry, `${filePath}: variable ${name}`);
    if (expectation.field !== undefined) {
      if (entry.value !== value.configuration[expectation.field]) {
        throw new Error(`${filePath}: variable ${name} must match the recorded configuration`);
      }
      continue;
    }
    // A derived variable is deliberately NOT compared against a fresh synthesis.
    // Doing so would couple every stored manifest to the descriptor shape of the
    // installer version that reads it: change a capability or a limitation
    // string here and every schema-5 manifest in the fleet stops decoding —
    // which breaks `check` and `update`, the two commands you would use to
    // repair it. The `_V1` suffix is the mechanism for a breaking shape change;
    // a decoder error is not.
    //
    // What is asserted instead is the one relationship that must hold across
    // versions: the recorded descriptor names the recorded model. That catches a
    // manifest whose variable block disagrees with its own configuration, which
    // is what this check exists for.
    let descriptor;
    try {
      descriptor = JSON.parse(entry.value);
    } catch {
      descriptor = null;
    }
    if (!isObject(descriptor) || descriptor.model !== value.configuration[expectation.model]) {
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

// Configuration equality. `check` compares what the manifest recorded against
// what this run resolves, and comparing them with a literal JSON.stringify made
// the result depend on two return statements building their keys in the same
// sequence — so adding a field in the wrong position would have reported every
// install as drifted against itself.
//
// Compare the managed fields by name instead. The field list is CONFIG_VARIABLES'
// own values, so it cannot fall out of step with what is actually managed, and
// every managed field is a scalar — which makes key order, nesting, and value
// type non-questions rather than documented assumptions. A field absent on one
// side and present on the other still differs, which is what distinguishes a
// pre-schema-4 configuration from a migrated one.
//
// Derived entries contribute nothing here on purpose. They carry no independent
// configuration field — they are a function of `cheapModel` / `deepModel`, which
// are already compared — so listing them would compare the same fact twice.
const CONFIGURATION_FIELDS = Object.freeze(
  Object.values(CONFIG_VARIABLES)
    .map((expectation) => expectation.field)
    .filter((field) => field !== undefined),
);

export function sameConfiguration(left, right) {
  return CONFIGURATION_FIELDS.every((field) => (left?.[field] ?? null) === (right?.[field] ?? null));
}

export function manifestJson(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// The value a managed variable should hold for the given configuration, or
// undefined when the configuration does not carry what the entry needs.
// Both entry kinds resolve through here so that every caller — install/update
// planning, `check` drift, and the manifest decoder — computes the same value
// from the same place.
function variableValue(expectation, configuration) {
  if (expectation.field !== undefined) return configuration[expectation.field];
  if (configuration[expectation.model] === undefined) return undefined;
  return JSON.stringify(expectation.derive(configuration));
}

// The variables a manifest at the given schema version records, and their
// values. Reading a stored manifest means asking what its own tier manages, not
// what the current one does; `variableValues` below is this at the current tier.
// Keeping both on one implementation is what stops a caller from rebuilding the
// version-to-names mapping by hand and drifting from the table.
//
// Omitting fields the configuration does not carry is what lets a pre-schema-4
// manifest manage three variables instead of reporting REVIEW_ROUTE_MODE as
// missing on a repository where it is set by hand.
export function variableValuesForSchema(configuration, schemaVersion) {
  return Object.fromEntries(
    Object.entries(configVariablesForSchema(schemaVersion))
      .map(([name, expectation]) => [name, variableValue(expectation, configuration)])
      .filter(([, value]) => value !== undefined),
  );
}

export function variableValues(configuration) {
  return variableValuesForSchema(configuration, MANIFEST_SCHEMA_VERSION);
}

export function resolveConfiguration(options, existingManifest) {
  const existing = existingManifest?.configuration ?? DEFAULT_CONFIG;
  return validateConfiguration({
    provider: options.provider ?? existing.provider,
    cheapModel: options.cheapModel ?? existing.cheapModel,
    deepModel: options.deepModel ?? existing.deepModel,
    routeMode: options.routeMode ?? existing.routeMode,
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
  --route-mode MODE      auto, cheap, deep, copilot, or none. Required on a
                         fresh install: the lane refuses to guess a route
                         because auto can bill the provider key, and this
                         installer will not guess one on its behalf. An update
                         keeps the recorded mode, and an existing repository
                         variable is adopted unowned.

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
    ["--route-mode", "routeMode"],
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
  if (
    command === "uninstall" &&
    (options.provider || options.cheapModel || options.deepModel || options.routeMode)
  ) {
    throw new Error("uninstall does not accept provider, model, or route options");
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
