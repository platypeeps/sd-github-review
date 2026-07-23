import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

const immutableActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/u;
const immutableDockerReference = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const execFileAsync = promisify(execFile);
const localPlatformRoots = new Set([
  ".agent",
  ".agents",
  ".claude",
  ".codebuddy",
  ".codex",
  ".cursor",
  ".devin",
  ".factory",
  ".gemini",
  ".gito",
  ".kiro",
  ".kilocode",
  ".opencode",
  ".pi",
  ".qoder",
  ".reasonix",
  ".trae",
  ".zcode",
]);
const localPlatformDirectories = new Set([
  ".cache",
  "cache",
  "logs",
  "sessions",
  "tmp",
]);

function normalizeRepositoryPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function prohibitedPublishedMetadataReason(filePath) {
  const normalized = normalizeRepositoryPath(filePath);
  if (
    normalized === ".env" ||
    (/^\.env\./u.test(normalized) && !/^\.env\.(?:ci|example|test)$/u.test(normalized))
  ) {
    return "local environment files must not be published";
  }

  if (
    /^\.trellis\/(?:\.developer|\.current-task|\.ralph-state\.json|\.agent-log|\.session-id|\.template-hashes\.json)$/u.test(
      normalized,
    )
  ) {
    return "Trellis developer or runtime identity is local-only";
  }
  if (/^\.trellis\/(?:\.runtime|\.cache|\.agents|worktrees)(?:\/|$)/u.test(normalized)) {
    return "Trellis runtime, cache, agent, and worktree state is local-only";
  }
  if (/^\.trellis\/\.backup-[^/]*(?:\/|$)/u.test(normalized)) {
    return "Trellis update backups are local-only";
  }
  if (
    /^\.trellis\/(?:.*\/)?(?:\.plan-log|[^/]+\.(?:new|pyc|tmp))$/u.test(normalized) ||
    /^\.trellis\/(?:.*\/)?__pycache__(?:\/|$)/u.test(normalized)
  ) {
    return "Trellis temporary and interpreter artifacts are local-only";
  }
  if (
    normalized.startsWith(".trellis/workspace/") &&
    !/^\.trellis\/workspace\/(?:index\.md|[^/]+\/(?:index\.md|journal-[1-9][0-9]*\.md))$/u.test(
      normalized,
    )
  ) {
    return "Trellis workspace publication is limited to developer indexes and journals";
  }

  const segments = normalized.split("/");
  if (localPlatformRoots.has(segments[0])) {
    const platformSegments = segments.slice(1);
    const localName = platformSegments.find(
      (segment) =>
        localPlatformDirectories.has(segment) ||
        segment.includes(".local.") ||
        segment.endsWith(".log"),
    );
    if (localName) return `AI-tool local state segment ${localName} must not be published`;
    if (
      segments[0] === ".opencode" &&
      platformSegments.some((segment) => segment === "node_modules" || segment === "state")
    ) {
      return "OpenCode dependency and state directories are local-only";
    }
  }

  if (
    /^\.github\/copilot\/(?:.*\/)?(?:\.cache|cache|logs|sessions|tmp)(?:\/|$)/u.test(
      normalized,
    )
  ) {
    return "GitHub Copilot local state is not a shared repository adapter";
  }
  return null;
}

async function trackedRepositoryPaths(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean).map(normalizeRepositoryPath);
  } catch (error) {
    const detail =
      typeof error.stderr === "string" && error.stderr.trim()
        ? error.stderr.trim()
        : error.message;
    throw new Error(
      `${repositoryRoot}: could not inspect tracked public metadata with git ls-files: ${detail}`,
    );
  }
}

async function validatePublishedMetadata(repositoryRoot) {
  const trackedPaths = await trackedRepositoryPaths(repositoryRoot);
  const prohibited = trackedPaths
    .map((filePath) => ({ filePath, reason: prohibitedPublishedMetadataReason(filePath) }))
    .filter(({ reason }) => reason);
  if (prohibited.length > 0) {
    const details = prohibited
      .map(({ filePath, reason }) => `- ${filePath}: ${reason}`)
      .join("\n");
    throw new Error(
      `${repositoryRoot}: prohibited local/session metadata is tracked:\n${details}\n` +
        "Untrack these paths or revise docs/PUBLIC_METADATA_POLICY.md deliberately.",
    );
  }
  return trackedPaths.length;
}

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

function validateUsesReferences(document, filePath, { requireActionSha }) {
  for (const { reference, location } of collectUses(document)) {
    if (reference.startsWith("./")) continue;
    if (reference.startsWith("docker://")) {
      if (!immutableDockerReference.test(reference)) {
        throw new Error(
          `${filePath}: ${location} must pin Docker image ${reference} to a sha256 digest`,
        );
      }
      continue;
    }
    if (requireActionSha && !immutableActionReference.test(reference)) {
      throw new Error(
        `${filePath}: ${location} must pin third-party action ${reference} to a 40-character commit SHA`,
      );
    }
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
  if (action.runs.using !== "node24") {
    throw new Error(`${actionPath}: runs.using must be node24`);
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
    validateUsesReferences(workflow, workflowPath, { requireActionSha: true });
  }

  const examplesDirectory = path.join(repositoryRoot, "examples");
  const exampleNames = (await readdir(examplesDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  for (const name of exampleNames) {
    const examplePath = path.join(examplesDirectory, name);
    const example = parseYaml(await readFile(examplePath, "utf8"), examplePath);
    assertObject(example, examplePath, "document");
    assertObject(example.on, examplePath, "on");
    assertObject(example.jobs, examplePath, "jobs");
    validateUsesReferences(example, examplePath, { requireActionSha: false });
  }

  const trackedPathCount = await validatePublishedMetadata(repositoryRoot);

  return {
    actionPath,
    workflowCount: workflowNames.length,
    exampleCount: exampleNames.length,
    trackedPathCount,
  };
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  validateMetadata()
    .then(({ workflowCount, exampleCount, trackedPathCount }) =>
      console.log(
        `Validated action.yml, ${workflowCount} workflow(s), ${exampleCount} example(s), and ${trackedPathCount} tracked public path(s).`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
