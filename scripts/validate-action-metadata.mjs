import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

const immutableActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/u;

function parseYaml(source, filePath) {
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJS();
}

function collectUses(value, locations = [], location = "root") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectUses(entry, locations, `${location}[${index}]`));
    return locations;
  }
  if (!value || typeof value !== "object") return locations;
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (key === "uses" && typeof child === "string") {
      locations.push({ reference: child, location: childLocation });
    }
    collectUses(child, locations, childLocation);
  }
  return locations;
}

function assertObject(value, filePath, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath}: ${key} must be a mapping`);
  }
}

export async function validateMetadata(repositoryRoot = process.cwd()) {
  const actionPath = path.join(repositoryRoot, "action.yml");
  const action = parseYaml(await readFile(actionPath, "utf8"), actionPath);
  assertObject(action, actionPath, "document");
  if (typeof action.name !== "string" || typeof action.description !== "string") {
    throw new Error(`${actionPath}: name and description are required strings`);
  }
  assertObject(action.inputs, actionPath, "inputs");
  assertObject(action.outputs, actionPath, "outputs");
  assertObject(action.runs, actionPath, "runs");
  if (action.runs.using !== "node20") {
    throw new Error(`${actionPath}: runs.using must be node20`);
  }
  if (typeof action.runs.main !== "string") {
    throw new Error(`${actionPath}: runs.main must name the JavaScript entrypoint`);
  }
  await readFile(path.join(repositoryRoot, action.runs.main), "utf8");

  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  if (workflowNames.length === 0) {
    throw new Error(`${workflowDirectory}: at least one workflow is required`);
  }

  for (const name of workflowNames) {
    const workflowPath = path.join(workflowDirectory, name);
    const workflow = parseYaml(await readFile(workflowPath, "utf8"), workflowPath);
    assertObject(workflow, workflowPath, "document");
    assertObject(workflow.on, workflowPath, "on");
    assertObject(workflow.jobs, workflowPath, "jobs");
    for (const { reference, location } of collectUses(workflow)) {
      const exempt = reference.startsWith("./") || reference.startsWith("docker://");
      if (!exempt && !immutableActionReference.test(reference)) {
        throw new Error(
          `${workflowPath}: ${location} must pin third-party action ${reference} to a 40-character commit SHA`,
        );
      }
    }
  }

  return { actionPath, workflowCount: workflowNames.length };
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  validateMetadata()
    .then(({ workflowCount }) => console.log(`Validated action.yml and ${workflowCount} workflow(s).`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
