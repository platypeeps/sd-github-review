// Orchestration for the consumer installer lifecycle (A-009). This module wires
// the pure codecs, the transport/`gh` seam, local persistence, and pure
// planning into the install/update/adopt/check/uninstall flows, and remains the
// single public module: it re-exports every symbol the CLI entrypoint and the
// test suite import so the decomposition is behavior-preserving.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  DESCRIPTOR_PATH,
  DESCRIPTOR_SOURCE_PATH,
  DURABLE_TEMPLATE_PATH,
  DURABLE_WORKFLOW_PATH,
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
  atomicWriteIfChanged,
  loadLocalState,
  makePathGuard,
  removeOptional,
} from "./consumer-installer/persistence.mjs";
import {
  DURABLE_RESOURCES,
  assertDurableResourcesCanBeManaged,
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
  DESCRIPTOR_PATH,
  DESCRIPTOR_SOURCE_PATH,
  DURABLE_TEMPLATE_PATH,
  DURABLE_WORKFLOW_PATH,
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

// Every source artifact the installer copies into a consumer, keyed the way the
// loaded local state and the manifest blocks are keyed.
async function readManagedSources(sourceRoot) {
  const [workflow, durableWorkflow, descriptor] = await Promise.all([
    readFile(path.join(sourceRoot, TEMPLATE_PATH), "utf8"),
    readFile(path.join(sourceRoot, DURABLE_TEMPLATE_PATH), "utf8"),
    readFile(path.join(sourceRoot, DESCRIPTOR_SOURCE_PATH), "utf8"),
  ]);
  return { workflow, durableWorkflow, descriptor };
}

// D4. A converged run writes nothing at all, which is strictly narrower than
// "the recorded hashes match disk": installOrUpdate also derives the resolved
// configuration, the planned remote actions, and the source release identity
// before it writes, and a change in any of those must still mutate a consumer
// whose files are byte-identical. Condition 2 is what buys that — the manifest
// that *would* be written is compared whole, so provider/model changes and
// source-commit advances fall out of it without predicates of their own.
function isConverged(local, activeManifest, actions) {
  if (!local.manifest || local.manifest.state !== "active") return false;
  if (local.manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) return false;
  if (actions.length > 0) return false;
  if (JSON.stringify(activeManifest) !== JSON.stringify(local.manifest)) return false;
  for (const [content, recorded] of [
    [local.workflow, local.manifest.workflow.sha256],
    [local.descriptor, local.manifest.descriptor.sha256],
    [local.durableWorkflow, local.manifest.durableWorkflow.sha256],
  ]) {
    if (content === null || sha256(content) !== recorded) return false;
  }
  return true;
}

async function installOrUpdate(command, options, dependencies) {
  const sourceRoot = dependencies.sourceRoot ?? path.resolve(import.meta.dirname, "..");
  const sources = await readManagedSources(sourceRoot);
  const templateSource = sources.workflow;
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
  assertDurableResourcesCanBeManaged(local, sources);
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
    descriptorSha: sha256(sources.descriptor),
    durableTemplateSha: sha256(sources.durableWorkflow),
    configuration,
    resources,
    release,
  });
  const activeManifest = { ...pendingManifest, state: "active" };
  const converged = isConverged(local, activeManifest, actions);
  const actionDescriptions = converged
    ? []
    : [
        `write ${MANIFEST_PATH} with pending state`,
        `write ${WORKFLOW_PATH}`,
        `write ${DESCRIPTOR_PATH}`,
        `write ${DURABLE_WORKFLOW_PATH}`,
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
  if (options.dryRun || converged) return report;

  await atomicWrite(guard, local.manifestFile, manifestJson(pendingManifest));
  // Write each managed file only when its bytes would change, so a run that is
  // not fully converged still leaves the already-matching files — including a
  // hand-placed copy this run is adopting (D3b) — untouched on disk.
  await atomicWriteIfChanged(guard, local.workflowFile, templateSource);
  await atomicWriteIfChanged(guard, local.descriptorFile, sources.descriptor);
  await atomicWriteIfChanged(guard, local.durableWorkflowFile, sources.durableWorkflow);
  await applyRemoteActions(github, target.repository, actions, options);
  await atomicWrite(guard, local.manifestFile, manifestJson(activeManifest));
  return report;
}

// A-019: adopt a manually installed workflow into installer ownership. Explicit
// only — never inferred during install/update. Recognizes an allow-listed
// historical or current template, plans ownership without claiming pre-existing
// unowned GitHub resources, requires confirmation, then writes pending -> active
// exactly like install so check/update/rollback/uninstall work afterward.
async function adoptInstallation(options, dependencies) {
  const sourceRoot = dependencies.sourceRoot ?? path.resolve(import.meta.dirname, "..");
  const sources = await readManagedSources(sourceRoot);
  const templateSource = sources.workflow;
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
  // adopt promises the result behaves exactly like install afterwards, so it
  // owes the durable resources the same collision guard install gives them: a
  // pre-existing file whose bytes differ from the source is refused before any
  // mutation rather than silently overwritten.
  assertDurableResourcesCanBeManaged(local, sources);
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
    descriptorSha: sha256(sources.descriptor),
    durableTemplateSha: sha256(sources.durableWorkflow),
    configuration,
    resources,
    release,
  });
  const actionDescriptions = [
    `write ${MANIFEST_PATH} with pending state`,
    refreshWorkflow
      ? `refresh ${WORKFLOW_PATH} from adopted ${recognized.label} to current source`
      : `record ${WORKFLOW_PATH} ownership`,
    `write ${DESCRIPTOR_PATH}`,
    `write ${DURABLE_WORKFLOW_PATH}`,
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
  await atomicWriteIfChanged(guard, local.workflowFile, templateSource);
  await atomicWriteIfChanged(guard, local.descriptorFile, sources.descriptor);
  await atomicWriteIfChanged(guard, local.durableWorkflowFile, sources.durableWorkflow);
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
  const sources = await readManagedSources(sourceRoot);
  const templateSource = sources.workflow;
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
  // The durable resources, once the manifest records them. Each gets the same
  // pair of signals the event-driven workflow gets: local drift against the
  // recorded hash, and a newer source than the one that was installed.
  for (const { field, destination } of DURABLE_RESOURCES) {
    const recorded = local.manifest?.[field];
    if (!recorded) continue;
    const content = local[field];
    if (content === null) {
      issues.push(`${destination} is missing`);
    } else if (sha256(content) !== recorded.sha256) {
      issues.push(`${destination} differs from its managed hash`);
    }
    if (recorded.sha256 !== sha256(sources[field])) {
      issues.push(`a newer source ${recorded.source} is available; run update`);
    }
  }
  if (local.manifest) {
    if (local.manifest.schemaVersion < 2) {
      issues.push("manifest predates provenance tracking; run update to record provenance");
    } else if (local.manifest.schemaVersion < MANIFEST_SCHEMA_VERSION) {
      issues.push(
        "manifest predates the durable review lane; run update to install the descriptor and sd-review.yml",
      );
    }
    if (release && local.manifest.schemaVersion >= 2) {
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
    for (const [content, destination] of [
      [local.workflow, WORKFLOW_PATH],
      [local.descriptor, DESCRIPTOR_PATH],
      [local.durableWorkflow, DURABLE_WORKFLOW_PATH],
    ]) {
      if (content !== null) {
        throw new Error(`${destination} exists without ${MANIFEST_PATH}; refusing to remove it`);
      }
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
  for (const { field, destination } of DURABLE_RESOURCES) {
    const recorded = local.manifest[field];
    const content = local[field];
    if (recorded && content !== null && sha256(content) !== recorded.sha256) {
      throw new Error(`${destination} was modified; refusing to remove operator changes`);
    }
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
  const removals = [`remove ${WORKFLOW_PATH}`];
  for (const { field, destination } of DURABLE_RESOURCES) {
    // A schema-1/2 installation never had these files; only remove what the
    // manifest records as owned.
    if (local.manifest[field]) removals.push(`remove ${destination}`);
  }
  const actionDescriptions = [
    `write ${MANIFEST_PATH} with uninstalling state`,
    ...actions.map(publicAction),
    ...removals,
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
  if (local.manifest.descriptor) await removeOptional(guard, local.descriptorFile);
  if (local.manifest.durableWorkflow) await removeOptional(guard, local.durableWorkflowFile);
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
