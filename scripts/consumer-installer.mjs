// Orchestration for the consumer installer lifecycle (A-009). This module wires
// the pure codecs, the transport/`gh` seam, local persistence, and pure
// planning into the install/update/adopt/check/uninstall flows, and remains the
// single public module: it re-exports every symbol the CLI entrypoint and the
// test suite import so the decomposition is behavior-preserving.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  HELP,
  HISTORICAL_TEMPLATE_HASHES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  ROUTING_LABELS,
  SECRET_NAME,
  SUPPORTED_PROVIDERS,
  TEMPLATE_PATH,
  WORKFLOW_PATH,
  decodeManifest,
  formatReport,
  manifestJson,
  normalizeRepository,
  parseArguments,
  parseGitHubRemote,
  recognizeTemplate,
  resolveConfiguration,
  sameRepository,
  sha256,
  validateConfiguration,
  variableValues,
} from "./consumer-installer/codecs.mjs";
import {
  GH_COMMAND_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  GitHubCli,
  gitOutput,
  makeSourceGit,
  readSourceVersion,
  resolveSourceRelease,
} from "./consumer-installer/transport.mjs";
import {
  atomicWrite,
  loadLocalState,
  makePathGuard,
  removeOptional,
} from "./consumer-installer/persistence.mjs";
import {
  assertManifestRepository,
  assertWorkflowCanBeManaged,
  createManifest,
  planResources,
  publicAction,
  sourceOverride,
} from "./consumer-installer/plan.mjs";

// Re-export the stable public surface so existing importers
// (scripts/install-consumer.mjs and the test suite) keep working unchanged.
export {
  DEFAULT_CONFIG,
  GH_COMMAND_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  GitHubCli,
  HELP,
  HISTORICAL_TEMPLATE_HASHES,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  ROUTING_LABELS,
  SECRET_NAME,
  SUPPORTED_PROVIDERS,
  TEMPLATE_PATH,
  WORKFLOW_PATH,
  decodeManifest,
  formatReport,
  makeSourceGit,
  parseArguments,
  parseGitHubRemote,
  resolveSourceRelease,
  validateConfiguration,
};

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
