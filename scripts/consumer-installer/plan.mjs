// Pure lifecycle planning for the consumer installer: resource action planning,
// manifest construction, action descriptions, managed-state assertions, and
// source-override resolution. Every function here depends only on decoded
// snapshots and options — no filesystem, `gh`, git, or environment access — so
// it imports only the codecs leaf.
import {
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  ROUTING_LABELS,
  SECRET_NAME,
  TEMPLATE_PATH,
  WORKFLOW_PATH,
  sameRepository,
  sha256,
  variableValues,
} from "./codecs.mjs";

export function assertManifestRepository(manifest, repository) {
  if (manifest && !sameRepository(manifest.repository, repository)) {
    throw new Error(
      `${MANIFEST_PATH} manages ${manifest.repository}, not ${repository}`,
    );
  }
}

export function assertWorkflowCanBeManaged(command, local, templateSource) {
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
    // A-013: the modification guard protects a completed (active) install from
    // clobbering operator edits. A pending manifest is mid-transaction (a prior
    // install/update/adopt was interrupted); installOrUpdate rewrites the
    // workflow unconditionally, so a pending workflow-hash mismatch is expected
    // interrupted state, not operator drift, and must resume rather than throw.
    local.manifest.state !== "pending" &&
    sha256(local.workflow) !== local.manifest.workflow.sha256
  ) {
    throw new Error(
      `${WORKFLOW_PATH} was modified after installation; preserve or reconcile it manually before update`,
    );
  }
}

export function planResources(configuration, snapshot, existingManifest, setSecretRequested) {
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

export function createManifest({ state, repository, templateSha, configuration, resources, release }) {
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

export function publicAction(action) {
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

export function sourceOverride(options, env) {
  const tag = overrideInput(options.sourceTag, env.SD_SOURCE_TAG, "SD_SOURCE_TAG");
  const commit = overrideInput(options.sourceCommit, env.SD_SOURCE_COMMIT, "SD_SOURCE_COMMIT");
  return tag || commit ? { tag: tag ?? null, commit: commit ?? null } : undefined;
}
