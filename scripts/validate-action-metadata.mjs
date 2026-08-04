import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

const immutableActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/u;
const placeholderActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@<[^<>\s]+>$/u;
const immutableDockerReference = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const firstPartyReference = /^([^/@\s]+\/[^/@\s]+)(?:\/[^@\s]+)?@([0-9a-f]{40})$/u;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const releaseTagPattern = /^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const setupDescriptorPath = "config/routed-review-setup-v1.json";
// Contract majors this release can compatibly serve. Drift beyond this set is a
// classification the release gate must reject rather than silently ship.
const knownContractMajors = new Set([1]);
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

function validateUsesReferences(
  document,
  filePath,
  { allowActionPlaceholder = false },
) {
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
    const allowedPlaceholder =
      allowActionPlaceholder && placeholderActionReference.test(reference);
    if (!immutableActionReference.test(reference) && !allowedPlaceholder) {
      throw new Error(
        `${filePath}: ${location} must pin third-party action ${reference} to a 40-character commit SHA`,
      );
    }
  }
}

function collectFirstPartyPins(document, filePath, actionOwnerRepo, pins) {
  for (const { reference, location } of collectUses(document)) {
    const match = firstPartyReference.exec(reference);
    if (match && match[1] === actionOwnerRepo) {
      pins.push({ filePath, location, sha: match[2] });
    }
  }
}

async function readSetupDescriptor(repositoryRoot) {
  const descriptorPath = path.join(repositoryRoot, setupDescriptorPath);
  let descriptor;
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  } catch {
    throw new Error(`${descriptorPath}: setup descriptor is missing or invalid JSON`);
  }
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error(`${descriptorPath}: setup descriptor must be an object`);
  }
  if (!knownContractMajors.has(descriptor.contractMajor)) {
    throw new Error(
      `${descriptorPath}: contractMajor must be a known contract (${[...knownContractMajors].join(", ")})`,
    );
  }
  const match = firstPartyReference.exec(descriptor.actionReference ?? "");
  if (!match) {
    throw new Error(`${descriptorPath}: actionReference must pin owner/repo@<40-character SHA>`);
  }
  return { descriptorPath, actionOwnerRepo: match[1], actionSha: match[2] };
}

function assertFirstPartyConsistency(pins, { descriptorPath, actionOwnerRepo, actionSha }) {
  for (const { filePath, location, sha } of pins) {
    if (sha !== actionSha) {
      throw new Error(
        `${filePath}: ${location} pins ${actionOwnerRepo}@${sha} but ${descriptorPath} declares @${actionSha}; ` +
          "first-party references must be mutually consistent",
      );
    }
  }
}

async function readPackageVersion(repositoryRoot) {
  const packagePath = path.join(repositoryRoot, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(packagePath, "utf8"));
  } catch {
    throw new Error(`${packagePath}: package.json is missing or invalid JSON`);
  }
  if (typeof manifest.version !== "string" || !semverPattern.test(manifest.version)) {
    throw new Error(`${packagePath}: version must be valid semver`);
  }
  return manifest.version;
}

async function defaultTagExists(repositoryRoot, tag) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "tag", "--list", tag], {
    encoding: "utf8",
  });
  return stdout.split("\n").map((line) => line.trim()).includes(tag);
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

  const descriptor = await readSetupDescriptor(repositoryRoot);
  const firstPartyPins = [];

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
    validateUsesReferences(workflow, workflowPath, {});
    collectFirstPartyPins(workflow, workflowPath, descriptor.actionOwnerRepo, firstPartyPins);
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
    validateUsesReferences(example, examplePath, { allowActionPlaceholder: true });
    collectFirstPartyPins(example, examplePath, descriptor.actionOwnerRepo, firstPartyPins);
  }

  assertFirstPartyConsistency(firstPartyPins, descriptor);
  const version = await readPackageVersion(repositoryRoot);

  const trackedPathCount = await validatePublishedMetadata(repositoryRoot);

  return {
    actionPath,
    workflowCount: workflowNames.length,
    exampleCount: exampleNames.length,
    trackedPathCount,
    version,
    contractMajor: descriptor.contractMajor,
  };
}

// Opt-in release-hygiene gate for the operator at release time. It layers a
// tag/version contract on top of the always-on validateMetadata checks. It does
// NOT assert example pins equal the release commit (a commit cannot embed its
// own SHA — an infeasible fixed point). Without a releaseTag it runs the
// always-on checks only; nothing is silently skipped.
export async function validateReleaseConsistency({
  repositoryRoot = process.cwd(),
  releaseTag,
  gitImpl,
} = {}) {
  const base = await validateMetadata(repositoryRoot);
  if (releaseTag === undefined || releaseTag === null) {
    return { ...base, releaseTag: null, releaseChecked: false };
  }
  if (typeof releaseTag !== "string" || !releaseTagPattern.test(releaseTag)) {
    throw new Error(`release tag ${releaseTag} must be a v<semver> tag`);
  }
  if (releaseTag !== `v${base.version}`) {
    throw new Error(
      `release tag ${releaseTag} must equal v${base.version} from package.json`,
    );
  }
  const tagExists = gitImpl?.tagExists ?? defaultTagExists;
  if (await tagExists(repositoryRoot, releaseTag)) {
    throw new Error(`release tag ${releaseTag} already exists; choose an unused version`);
  }
  return { ...base, releaseTag, releaseChecked: true };
}

function parseReleaseTag(argv, env) {
  const flagIndex = argv.indexOf("--release-tag");
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--release-tag requires a v<semver> value");
    }
    return value;
  }
  return env.SD_RELEASE_TAG ?? null;
}

async function runCli() {
  const releaseTag = parseReleaseTag(process.argv.slice(2), process.env);
  return releaseTag
    ? validateReleaseConsistency({ releaseTag }).then((result) => {
        console.log(
          `Validated release ${result.releaseTag}: action.yml, ${result.workflowCount} workflow(s), ` +
            `${result.exampleCount} example(s), and ${result.trackedPathCount} tracked public path(s).`,
        );
      })
    : validateMetadata().then(({ workflowCount, exampleCount, trackedPathCount }) => {
        console.log(
          `Validated action.yml, ${workflowCount} workflow(s), ${exampleCount} example(s), and ${trackedPathCount} tracked public path(s).`,
        );
      });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
