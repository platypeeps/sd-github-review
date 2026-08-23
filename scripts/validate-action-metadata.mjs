import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import {
  PERMISSION_LEVELS,
  SEMANTIC_PAYLOAD_INPUTS,
  contractInputNames,
  contractOutputNames,
  globallyRequiredInputs,
  durableOperations,
  operationNames,
  unionPermissions,
} from "../src/operation-contract.js";

const immutableActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/u;
const placeholderActionReference = /^[^/@\s]+\/[^/@\s]+(?:\/[^@\s]+)?@<[^<>\s]+>$/u;
const immutableDockerReference = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const firstPartyReference = /^([^/@\s]+\/[^/@\s]+)(?:\/[^@\s]+)?@([0-9a-f]{40})$/u;
const semverPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const releaseTagPattern =
  /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const setupDescriptorPath = "contract/routed-review-setup-v1.json";
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

// R-007: a shipped lane must not name a release tag.
//
// Nine lanes carried a `# v0.3.0` comment on the line above a `uses:` pin that
// was v0.4.0's commit. Neither existing check could see it:
// assertFirstPartyConsistency reads `uses:` *values* and never comment nodes,
// and assertProseCommitReferences filters to Markdown. So the label drifted for
// a full release cycle in the exact files consumers copy.
//
// The rule is the one these files already state: the SHA is the installation
// reference and the tag is only for discovery. A lane naming a tag is therefore
// always either redundant or wrong, and checking for absence needs no knowledge
// of which tag would have been correct — which is what makes it drift-proof.
function assertNoReleaseTagLabels(source, filePath) {
  const named = [];
  for (const [index, line] of source.split("\n").entries()) {
    for (const [, tag] of line.matchAll(/\b(v[0-9]+\.[0-9]+\.[0-9]+)\b/gu)) {
      named.push(`${filePath}:${index + 1}: ${tag}`);
    }
  }
  if (named.length) {
    throw new Error(
      `shipped lane names a release tag; pin references must name only the SHA:\n  ${named.join("\n  ")}\n` +
        "the tag is for discovery, the SHA is the installation reference",
    );
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
  // R2: the scalar contractMajor says which contract this release speaks; the
  // array says which it can serve. A consumer pinned to an older major has no
  // way to learn compatibility from a scalar alone.
  const supported = descriptor.supportedContractMajors;
  if (!Array.isArray(supported) || supported.length === 0) {
    throw new Error(
      `${descriptorPath}: supportedContractMajors must be a non-empty array of contract majors`,
    );
  }
  for (const major of supported) {
    if (!knownContractMajors.has(major)) {
      throw new Error(
        `${descriptorPath}: supportedContractMajors contains unknown contract ${JSON.stringify(major)} ` +
          `(known: ${[...knownContractMajors].join(", ")})`,
      );
    }
  }
  if (!supported.includes(descriptor.contractMajor)) {
    throw new Error(
      `${descriptorPath}: supportedContractMajors must include contractMajor ${descriptor.contractMajor}`,
    );
  }
  const match = firstPartyReference.exec(descriptor.actionReference ?? "");
  if (!match) {
    throw new Error(`${descriptorPath}: actionReference must pin owner/repo@<40-character SHA>`);
  }
  return {
    descriptorPath,
    actionOwnerRepo: match[1],
    actionSha: match[2],
    contractMajor: descriptor.contractMajor,
    supportedContractMajors: [...supported],
  };
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

// A-010: action.yml inputs/outputs must equal the operation-contract union, and
// no input may be globally required unless every operation requires it. This is
// the mechanical alignment the contract exists to guarantee.
function assertActionContract(action, actionPath) {
  const metadataInputs = Object.keys(action.inputs).sort();
  const metadataOutputs = Object.keys(action.outputs).sort();
  const contractInputs = contractInputNames();
  const contractOutputs = contractOutputNames();
  const diff = (a, b) => a.filter((name) => !b.includes(name));
  const inputExtra = diff(metadataInputs, contractInputs);
  const inputMissing = diff(contractInputs, metadataInputs);
  const outputExtra = diff(metadataOutputs, contractOutputs);
  const outputMissing = diff(contractOutputs, metadataOutputs);
  if (inputExtra.length) {
    throw new Error(`${actionPath}: inputs [${inputExtra.join(", ")}] are used by no operation`);
  }
  if (inputMissing.length) {
    throw new Error(`${actionPath}: contract inputs [${inputMissing.join(", ")}] are missing from action.yml`);
  }
  if (outputExtra.length) {
    throw new Error(`${actionPath}: outputs [${outputExtra.join(", ")}] are emitted by no operation`);
  }
  if (outputMissing.length) {
    throw new Error(`${actionPath}: contract outputs [${outputMissing.join(", ")}] are missing from action.yml`);
  }
  const allowedRequired = new Set(globallyRequiredInputs());
  for (const [name, spec] of Object.entries(action.inputs)) {
    if (spec && spec.required === true && !allowedRequired.has(name)) {
      throw new Error(
        `${actionPath}: input "${name}" is globally required but not every operation requires it`,
      );
    }
  }
  // The acknowledge forbidden-input check treats a non-empty semantic payload
  // input as a caller override; that only holds while these inputs declare an
  // empty default. A non-empty default would inject into every job and make the
  // shipped acknowledge step reject unconditionally, so lock the defaults empty.
  for (const name of SEMANTIC_PAYLOAD_INPUTS) {
    const spec = action.inputs[name];
    if (spec && spec.default !== undefined && String(spec.default).trim() !== "") {
      throw new Error(
        `${actionPath}: semantic payload input "${name}" must declare an empty default`,
      );
    }
  }
}

// A-010: the setup descriptor's operation and permission promises must agree
// with the contract instead of drifting as an independent copy.
function assertSetupContract(config, descriptorPath) {
  const supported = config.supportedOperations;
  if (!Array.isArray(supported) || supported.length === 0) {
    throw new Error(`${descriptorPath}: supportedOperations must be a non-empty array`);
  }
  for (const name of supported) {
    if (!durableOperations.includes(name)) {
      throw new Error(`${descriptorPath}: supportedOperations includes non-durable "${name}"`);
    }
  }
  const expected = unionPermissions(supported);
  const declared = config.requiredPermissions ?? {};
  const scopes = new Set([...Object.keys(expected), ...Object.keys(declared)]);
  for (const scope of scopes) {
    if (declared[scope] !== expected[scope]) {
      throw new Error(
        `${descriptorPath}: requiredPermissions.${scope} is ${declared[scope] ?? "unset"} but the ` +
          `contract union over supportedOperations needs ${expected[scope] ?? "none"}`,
      );
    }
  }
}

function referencesThisAction(reference, actionOwnerRepo) {
  if (reference.startsWith("./")) return true;
  return (
    reference.startsWith(`${actionOwnerRepo}@`) || reference.startsWith(`${actionOwnerRepo}/`)
  );
}

// Operations a job runs, derived from every step invoking this action. A literal
// `operation` binds one operation; a `${{ }}` expression binds the union over
// the workflow-reachable dispatch operations (supportedOperations); an absent
// input defaults to standalone.
function jobOperations(job, actionOwnerRepo, supportedOperations) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const operations = new Set();
  for (const step of steps) {
    if (typeof step?.uses !== "string" || !referencesThisAction(step.uses, actionOwnerRepo)) {
      continue;
    }
    const raw = step.with?.operation;
    if (raw === undefined || raw === null || raw === "") {
      operations.add("standalone");
    } else if (typeof raw === "string" && raw.includes("${{")) {
      for (const name of supportedOperations) operations.add(name);
    } else {
      const name = String(raw).trim().toLowerCase();
      if (!operationNames.includes(name)) {
        throw new Error(`operation "${raw}" is not a known operation`);
      }
      operations.add(name);
    }
  }
  return operations;
}

function permissionMap(permissions) {
  if (permissions === undefined || permissions === null) return null; // inherit
  if (typeof permissions === "string") {
    if (permissions === "write-all") return { __all: "write" };
    if (permissions === "read-all") return { __all: "read" };
    return {}; // "none" or anything else grants nothing scoped
  }
  // Null-prototype: a workflow is untrusted YAML, and a scope literally named
  // `__proto__` would otherwise be swallowed by assignment rather than stored.
  const out = Object.create(null);
  for (const [scope, level] of Object.entries(permissions)) out[scope] = level;
  return out;
}

// Own-property lookup, not `PERMISSION_LEVELS[level]`. `PERMISSION_LEVELS` is a
// frozen object literal, so it still inherits from `Object.prototype`: a level
// of `toString` reads back as a *function*, which `?? 0` does not replace and
// which turns every downstream comparison into NaN -- silently false. The level
// comes from a workflow file, so it is exactly the kind of value that must not
// be looked up through a prototype chain.
function permissionRank(level) {
  return Object.hasOwn(PERMISSION_LEVELS, level) ? PERMISSION_LEVELS[level] : 0;
}

function grantedLevel(effective, scope) {
  const levels = [effective.__all, effective[scope]].map(permissionRank);
  return Math.max(...levels, 0);
}

// A-010 lower-bound: every job that runs this Action must grant at least the
// union of its operations' contract permissions. No upper bound — jobs hold
// extra permissions for comment/side-effect and non-Action steps. Jobs with no
// step invoking this Action (isolated adapter containers) are out of scope.
function assertJobPermissions(doc, filePath, actionOwnerRepo, supportedOperations) {
  const workflowLevel = permissionMap(doc.permissions);
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    const operations = jobOperations(job, actionOwnerRepo, supportedOperations);
    if (operations.size === 0) continue;
    const required = unionPermissions([...operations]);
    const effective = permissionMap(job.permissions) ?? workflowLevel ?? {};
    for (const [scope, level] of Object.entries(required)) {
      if (grantedLevel(effective, scope) < permissionRank(level)) {
        throw new Error(
          `${filePath}: job "${jobName}" runs [${[...operations].join(", ")}] needing ` +
            `${scope}:${level} but grants ${scope}:${effective.__all ?? effective[scope] ?? "none"}`,
        );
      }
    }
  }
}

// A-023 upper bound: the descriptor's own lane must grant *exactly* what
// `requiredPermissions` declares -- no more, no less.
//
// `assertJobPermissions` above is deliberately a lower bound, and its comment
// used to justify the missing upper bound as "jobs hold extra permissions for
// comment/side-effect and non-Action steps". That justification was wrong. It
// was believed because the conversation-comment and label endpoints are
// `/issues/...` REST paths, so `issues: write` looked required; on a pull
// request those paths are governed by `pull-requests: write`, because the
// prefix reflects GitHub modelling pull requests as issues in the REST layout
// rather than the scope that authorizes them. Every lane carried a dead
// `issues: write`, and SETUP-PR-AGENT.md instructed operators to grant it to a
// job that runs a third-party container. Probed and removed in 0.6.1.
//
// Scoped to the descriptor's own lane, resolved from its `workflow.path`, and
// not to every lane: `requiredPermissions` documents what a consumer must
// provision for *that* workflow. Folding the event-driven router and the
// generic durable example into the union would force the descriptor to describe
// workflows a consumer may never install.
//
// The `pr-agent` job is included, unlike in the lower-bound gate, and that is
// the point: it is where an over-grant to a third-party container would live.
function laneGrantUnion(doc) {
  const workflowLevel = permissionMap(doc.permissions) ?? {};
  const union = Object.create(null);
  for (const job of Object.values(doc.jobs ?? {})) {
    const effective = permissionMap(job.permissions) ?? workflowLevel;
    for (const [scope, level] of Object.entries(effective)) {
      const rank = permissionRank(level);
      if (rank === 0) continue;
      if (rank > permissionRank(union[scope])) union[scope] = level;
    }
  }
  return union;
}

// `permissionMap` collapses the `write-all`/`read-all` shorthand to a single
// `__all` key rather than enumerating scopes, so a blanket grant is real but
// noncanonical evidence: `granted.issues` stays undefined while the token in
// fact holds `issues: write`. Neither gate may compare that key by name --
// both route it through `grantedLevel`, which is the one place that knows
// `__all` covers every scope.
function blanketGrant(granted) {
  return granted.__all === undefined ? null : granted.__all;
}

export function assertDescriptorLaneGrants(doc, filePath, requiredPermissions) {
  const granted = laneGrantUnion(doc);
  const declared = requiredPermissions ?? {};
  const offenders = [];
  const blanket = blanketGrant(granted);
  if (blanket !== null) {
    offenders.push(
      `the lane grants ${blanket}-all, a blanket grant over every scope, which can never ` +
        "equal an enumerated descriptor -- name the scopes the jobs actually need",
    );
  }
  for (const scope of new Set([...Object.keys(granted), ...Object.keys(declared)])) {
    if (scope === "__all") continue;
    if (granted[scope] === declared[scope]) continue;
    offenders.push(
      declared[scope] === undefined
        ? `${scope}: lane grants ${granted[scope]} but the descriptor declares none`
        : granted[scope] === undefined
          ? `${scope}: the descriptor declares ${declared[scope]} but no job grants it`
          : `${scope}: lane grants ${granted[scope]} but the descriptor declares ${declared[scope]}`,
    );
  }
  if (offenders.length) {
    throw new Error(
      `${filePath}: lane permissions and the setup descriptor's requiredPermissions must match ` +
        `exactly, because a consumer provisions permissions from the descriptor:\n  ` +
        offenders.sort().join("\n  "),
    );
  }
}

// A-023 companion sweep. Enumerated from `laneDocuments()` so a lane added later
// is covered without an edit here -- the same shape as the review-floor sweeps.
// Separate from the equality gate above, which only sees the descriptor's lane:
// this one reaches the router and generic examples, where the dead grant also
// lived and where the docs told operators to add it.
// A job with no `permissions:` anywhere above it does not run with an empty
// token. GitHub falls back to the repository or organization default
// `GITHUB_TOKEN` permissions, which the lane does not control and which may
// well include `issues: write`. Reading that as "grants nothing" is the sweep's
// worst failure mode: it reports clean on precisely the lane whose scopes are
// unknown. Fail closed instead -- every shipped lane declares permissions at
// the workflow level today, so this costs nothing until someone omits one.
function undeclaredPermissionJobs(doc) {
  if (permissionMap(doc.permissions) !== null) return [];
  return Object.entries(doc.jobs ?? {})
    .filter(([, job]) => permissionMap(job?.permissions) === null)
    .map(([jobName]) => jobName);
}

// The only scalars GitHub accepts. `permissionMap` maps every other string to
// an empty grant, which is the same fail-open shape as the absent case above:
// a lane whose declaration cannot be understood is reported as granting
// nothing. Nobody knows what such a lane's token holds, so it must not pass.
const PERMISSION_SCALARS = new Set(["read-all", "write-all"]);

function invalidPermissionDeclaration(doc) {
  const declarations = [
    ["the workflow", doc.permissions],
    ...Object.entries(doc.jobs ?? {}).map(([name, job]) => [`job "${name}"`, job?.permissions]),
  ];
  for (const [where, value] of declarations) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (!PERMISSION_SCALARS.has(value)) {
        return (
          `${where} sets permissions to the scalar "${value}", which GitHub does not accept ` +
          "-- the only valid scalars are read-all and write-all, and {} means none"
        );
      }
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return (
        `${where} sets permissions to ${Array.isArray(value) ? "a list" : typeof value}, ` +
        "which GitHub does not accept -- it must be a scalar or a map of scopes"
      );
    }
    // Map entries need the same treatment as the scalar above, and for the same
    // reason: `laneGrantUnion` ranks an unrecognized level through
    // `permissionRank` and drops it, so `issues: wirte` passes
    // the sweep as though it granted nothing while GitHub would reject the
    // workflow outright. A typo must not be the way past this gate.
    for (const [scope, level] of Object.entries(value)) {
      if (!Object.hasOwn(PERMISSION_LEVELS, level)) {
        return (
          `${where} sets ${scope} to "${level}", which GitHub does not accept -- a map entry ` +
          "must be none, read, or write"
        );
      }
    }
  }
  return null;
}

export function assertNoDeadIssuesGrant(lanes) {
  const offenders = [];
  for (const [filePath, doc] of lanes) {
    const invalid = invalidPermissionDeclaration(doc ?? {});
    if (invalid !== null) {
      offenders.push(`${filePath}: ${invalid}`);
      continue;
    }
    const undeclared = undeclaredPermissionJobs(doc ?? {});
    if (undeclared.length) {
      offenders.push(
        `${filePath}: job(s) ${undeclared.join(", ")} declare no permissions and neither does ` +
          "the workflow, so the token falls back to the repository default, which this lane " +
          "does not control and may include issues:write",
      );
      continue;
    }
    const granted = laneGrantUnion(doc ?? {});
    // Through `grantedLevel`, not `granted.issues`: a `write-all` lane grants
    // the scope without ever naming it.
    if (grantedLevel(granted, "issues") === 0) continue;
    const blanket = blanketGrant(granted);
    offenders.push(
      granted.issues !== undefined
        ? `${filePath}: issues:${granted.issues}`
        : `${filePath}: ${blanket}-all, which covers issues:${blanket}`,
    );
  }
  if (offenders.length) {
    throw new Error(
      "every shipped lane must declare its permissions, and none may grant the issues scope " +
        "-- nothing in this action or in PR-Agent needs it, and on a pull request " +
        "pull-requests:write already covers the /issues/... REST paths:\n  " +
        offenders.join("\n  "),
    );
  }
}

// R-008: GitHub evaluates `${{ }}` in action.yml when it *loads* the action,
// including inside `description` prose -- a delimited example is evaluated, not
// quoted. The contexts an action definition may reference are a strict subset of
// a workflow's, and `vars` is not among them, so documenting the very wiring the
// route-policy input requires made the 0.5.0 candidate fail to load with
// "Unrecognized named-value: 'vars'" before a single line of src/ ran. That
// failure mode is total and fleet-wide: no consumer can dispatch at all.
//
// Only `runs:` can legitimately carry an expression, and only for a composite
// action; this one is `using: node24`, so the legitimate count today is zero.
// The walk is structural rather than line-based so a future composite `runs:`
// keeps its expressions without loosening the rule anywhere else. Workflows are
// deliberately not covered -- `vars` is available there, which is why the
// shipped lanes carry the delimited form this file must not.
export function assertNoActionExpressions(action, actionPath) {
  const offenders = [];
  const walk = (node, trail) => {
    if (typeof node === "string") {
      if (node.includes("${{")) offenders.push(trail.join("."));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...trail, index]));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, [...trail, key]);
    }
  };
  for (const [key, value] of Object.entries(action ?? {})) {
    if (key === "runs") continue;
    walk(value, [key]);
  }
  if (offenders.length) {
    throw new Error(
      `${actionPath}: expression delimiters outside runs: ${offenders.join(", ")}\n` +
        "GitHub evaluates these when it loads the action, and an action definition cannot " +
        "reference vars; a bad one fails the load for every consumer at once. " +
        "Write the expression body without its surrounding delimiters.",
    );
  }
}

export async function validateMetadata(repositoryRoot = process.cwd()) {
  const actionPath = path.join(repositoryRoot, "action.yml");
  const action = parseYaml(await readFile(actionPath, "utf8"), actionPath);
  assertObject(action, actionPath, "document");
  assertNoActionExpressions(action, actionPath);
  if (typeof action.name !== "string" || typeof action.description !== "string") {
    throw new Error(`${actionPath}: name and description are required strings`);
  }
  assertObject(action.inputs, actionPath, "inputs");
  assertObject(action.outputs, actionPath, "outputs");
  assertActionContract(action, actionPath);
  assertObject(action.runs, actionPath, "runs");
  if (action.runs.using !== "node24") {
    throw new Error(`${actionPath}: runs.using must be node24`);
  }
  if (typeof action.runs.main !== "string") {
    throw new Error(`${actionPath}: runs.main must name the JavaScript entrypoint`);
  }
  await readFile(path.join(repositoryRoot, action.runs.main), "utf8");

  const descriptor = await readSetupDescriptor(repositoryRoot);
  const setupConfig = JSON.parse(
    await readFile(path.join(repositoryRoot, setupDescriptorPath), "utf8"),
  );
  assertSetupContract(setupConfig, setupDescriptorPath);
  const supportedOperations = setupConfig.supportedOperations;
  const firstPartyPins = [];
  let descriptorLaneSeen = false;

  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  if (workflowNames.length === 0) {
    throw new Error(`${workflowDirectory}: at least one workflow is required`);
  }

  for (const name of workflowNames) {
    const workflowPath = path.join(workflowDirectory, name);
    const workflowSource = await readFile(workflowPath, "utf8");
    assertNoReleaseTagLabels(workflowSource, path.relative(repositoryRoot, workflowPath));
    const workflow = parseYaml(workflowSource, workflowPath);
    assertObject(workflow, workflowPath, "document");
    assertObject(workflow.on, workflowPath, "on");
    assertObject(workflow.jobs, workflowPath, "jobs");
    validateUsesReferences(workflow, workflowPath, {});
    assertJobPermissions(workflow, workflowPath, descriptor.actionOwnerRepo, supportedOperations);
    // A-023: the descriptor names one lane by path; that lane's grants must
    // equal requiredPermissions exactly. Resolved from the descriptor rather
    // than from a list here, so renaming the lane cannot silently skip the gate.
    // Normalized: `path.relative` uses the host separator, but the descriptor
    // stores repository-format `/` paths. Comparing them raw would never match
    // on Windows, and the guard below would then reject every valid checkout
    // with "matched nothing" -- the gate failing loudly for the wrong reason.
    const relativeWorkflowPath = normalizeRepositoryPath(
      path.relative(repositoryRoot, workflowPath),
    );
    if (relativeWorkflowPath === setupConfig.workflow?.path) {
      descriptorLaneSeen = true;
      assertDescriptorLaneGrants(
        workflow,
        relativeWorkflowPath,
        setupConfig.requiredPermissions,
      );
    }
    collectFirstPartyPins(workflow, workflowPath, descriptor.actionOwnerRepo, firstPartyPins);
  }
  // A path-matched gate that matches nothing does not fail -- it vanishes. If
  // the lane is renamed without updating the descriptor, or the field is
  // dropped entirely, the permission equality check above stops running and
  // every run stays green. Both shapes fail here, unconditionally: an earlier
  // draft exempted a descriptor declaring no lane at all so synthetic fixtures
  // could omit the field, which made deleting the field the cheapest way to
  // disable the gate. Fixtures declare a lane instead.
  if (typeof setupConfig.workflow?.path !== "string" || setupConfig.workflow.path === "") {
    throw new Error(
      `${setupDescriptorPath}: workflow.path must be a nonempty string naming the lane the ` +
        "permission gate anchors on; without it the gate silently does not run",
    );
  }
  if (!descriptorLaneSeen) {
    throw new Error(
      `${setupDescriptorPath}: workflow.path is "${setupConfig.workflow.path}" but no tracked ` +
        "workflow sits there, so the lane permission gate matched nothing and silently did not run",
    );
  }
  assertNoDeadIssuesGrant(await laneDocuments(repositoryRoot));

  const examplesDirectory = path.join(repositoryRoot, "examples");
  const exampleNames = (await readdir(examplesDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  for (const name of exampleNames) {
    const examplePath = path.join(examplesDirectory, name);
    const exampleSource = await readFile(examplePath, "utf8");
    assertNoReleaseTagLabels(exampleSource, path.relative(repositoryRoot, examplePath));
    const example = parseYaml(exampleSource, examplePath);
    assertObject(example, examplePath, "document");
    assertObject(example.on, examplePath, "on");
    assertObject(example.jobs, examplePath, "jobs");
    validateUsesReferences(example, examplePath, { allowActionPlaceholder: true });
    assertJobPermissions(example, examplePath, descriptor.actionOwnerRepo, supportedOperations);
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

// Final releases only. releaseTagPattern also admits prerelease and build
// metadata, which must not become a freshness target: a pin points at a
// shipped release, and the numeric compare below has no prerelease precedence
// rules to rank v1.0.0-rc.1 against v1.0.0.
const finalReleaseTagPattern = /^v[0-9]+\.[0-9]+\.[0-9]+$/u;

// Enumerate v<semver> release tags. Returns raw tag names; ordering is the
// caller's job, because git's own tag order is lexical and would rank v0.10.0
// below v0.9.0.
async function defaultListReleaseTags(repositoryRoot) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "tag", "--list", "v*"], {
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => finalReleaseTagPattern.test(line));
}

async function defaultResolveTagCommit(repositoryRoot, tag) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "rev-list", "-n1", tag],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

// Exit 1 is git's answer for "not an ancestor" and is the only nonzero exit that
// means false. Anything else — an unknown revision, a corrupt or shallow object
// store, git missing entirely — is rethrown. Collapsing those to false would let
// an unreadable repository report a fresh pin, which is the one direction this
// gate must never fail in.
async function defaultIsAncestor(repositoryRoot, ancestor, descendant) {
  try {
    await execFileAsync(
      "git",
      ["-C", repositoryRoot, "merge-base", "--is-ancestor", ancestor, descendant],
      { encoding: "utf8" },
    );
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

// Resolve <commit>:<path> to its tree or blob id. Deliberately lets a missing
// object reject: a pin whose tree cannot be read is unverifiable, not fresh.
async function defaultResolvePathObject(repositoryRoot, commit, targetPath) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "rev-parse", `${commit}:${targetPath}`],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

// The paths whose contents decide whether a pinned commit runs the same action
// as the release. Everything else a release touches — docs, examples, the pins
// themselves, Trellis records — cannot change what a consumer executes.
const ACTION_CODE_PATHS = Object.freeze(["src", "action.yml"]);

// Semver precedence over the numeric core. Release tags here are always
// v<major>.<minor>.<patch>, so a three-part numeric compare is total and no
// prerelease ordering is required.
function compareReleaseTags(left, right) {
  const parse = (tag) => tag.slice(1).split(".").map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

// R-003: the descriptor's pin must resolve to the current release, not merely
// to 40 hex characters. Without this, every first-party reference agreeing on a
// SHA that is several releases old passes cleanly — which is exactly how this
// repository shipped a v0.1.0 pin for the whole v0.2.0 cycle.
//
// This deliberately lives BESIDE validateMetadata rather than inside it. Twenty
// fixture call sites in test/metadata.test.js pass synthetic roots that are not
// git repositories; a tag lookup against those would throw on the repository
// probe instead of on staleness.
//
// Its one caller is the CLI entrypoint, which is what `npm run validate:metadata`
// runs and what CI gates on. It is NOT called from validateReleaseConsistency —
// see the comment at that call site for why.
//
// Zero tags is a hard failure, never a skip. A skip would make the gate a no-op
// under a default fetch-depth:1 checkout, which is the one environment where it
// has to bite.
export async function assertPinFreshness({
  repositoryRoot = process.cwd(),
  gitImpl,
} = {}) {
  const listReleaseTags = gitImpl?.listReleaseTags ?? defaultListReleaseTags;
  const resolveTagCommit = gitImpl?.resolveTagCommit ?? defaultResolveTagCommit;
  const isAncestor = gitImpl?.isAncestor ?? defaultIsAncestor;
  const resolvePathObject = gitImpl?.resolvePathObject ?? defaultResolvePathObject;
  const { descriptorPath, actionSha } = await readSetupDescriptor(repositoryRoot);

  // Re-filter rather than trust the lookup: an injected gitImpl is a test seam,
  // and compareReleaseTags has no precedence rule for a prerelease tag.
  const tags = (await listReleaseTags(repositoryRoot)).filter((tag) =>
    finalReleaseTagPattern.test(tag),
  );
  if (!tags.length) {
    throw new Error(
      `${descriptorPath}: no v<semver> release tag found; pin freshness cannot be ` +
        "verified (a shallow checkout without tags will report this — use fetch-depth: 0)",
    );
  }
  const latest = [...tags].sort(compareReleaseTags).at(-1);
  const latestCommit = await resolveTagCommit(repositoryRoot, latest);
  if (!/^[0-9a-f]{40}$/u.test(latestCommit)) {
    throw new Error(`${descriptorPath}: release tag ${latest} did not resolve to a commit`);
  }
  // This was equality: actionSha === latestCommit. No commit can satisfy that at
  // the moment it is tagged, because it would have to contain its own SHA — the
  // same infeasible fixed point validateReleaseConsistency disclaims below. The
  // consequence was structural rather than cosmetic: pins could only advance
  // AFTER the tag existed, so every tagged tree permanently carried the previous
  // release's pins, and a consumer installing from a tag ran a release behind.
  //
  // What a consumer depends on is not where the pin sits in the commit graph but
  // whether the code at the pin is the code the release ships. Comparing that
  // directly dissolves the fixed point: a tag placed on a pin-advance commit can
  // pin its own parent, whose action code is byte-identical.
  //
  // Ancestry-only formulations were tried first and all fail — see the task
  // 08-22-pin-freshness-lag design notes. They either deadlock the pin-advance
  // pull request, whose CI runs before the new tag exists, or widen the window
  // enough to re-admit the stale pin they were meant to reject.
  if (actionSha !== latestCommit) {
    // Which commit's action code the pin must reproduce. Post-tag that is the
    // release; pre-tag it is HEAD. See the pre-tag branch below for why.
    let referenceCommit = latestCommit;
    let referenceLabel = `current release ${latest} is ${latestCommit}`;
    if (!(await isAncestor(repositoryRoot, actionSha, latestCommit))) {
      // The pre-tag window. On the pull request that advances the pins, the new
      // pin is newer than the last release and the new tag does not exist yet,
      // so the pin is a descendant of the current release rather than an
      // ancestor. Accept it only while it is on the history being validated.
      if (!(await isAncestor(repositoryRoot, actionSha, "HEAD"))) {
        throw new Error(
          `${descriptorPath}: actionReference ${actionSha} is not contained in the current ` +
            `release ${latest} (${latestCommit}) and is not an ancestor of HEAD; ` +
            "advance every first-party pin together",
        );
      }
      // R-006: compare against HEAD, not the previous tag.
      //
      // This loop used to run against latestCommit in both windows, which
      // deadlocked every release that changes action code — that is, every
      // release except a pins-only one. The pin-advance pull request must move
      // the pin to the candidate, and the candidate's `src` differs from the
      // last release by construction, so the comparison could not succeed and
      // CI could never go green on the one commit the release procedure
      // requires. 0.4.1 shipped only because it was action-code neutral, which
      // made this loop vacuous; 0.5.0 is not, and reproduced the deadlock.
      //
      // Reordering does not help: tagging the candidate first re-creates the
      // v0.3.0/v0.4.0 lag that 0.4.1 exists to close.
      //
      // In this window the tree under validation *is* the release, so HEAD is
      // the correct authority for "the code this release ships". The property
      // the gate defends — consumers run the action code the release ships — is
      // unchanged, and a descendant pin whose action code differs from the
      // candidate still fails. The post-tag path is untouched, so a pin left on
      // an older release still fails against the tag.
      referenceCommit = "HEAD";
      referenceLabel = "candidate at HEAD";
    }
    for (const targetPath of ACTION_CODE_PATHS) {
      const pinnedObject = await resolvePathObject(repositoryRoot, actionSha, targetPath);
      const releasedObject = await resolvePathObject(repositoryRoot, referenceCommit, targetPath);
      if (pinnedObject !== releasedObject) {
        throw new Error(
          `${descriptorPath}: actionReference is stale — pinned to ${actionSha}, but the ` +
            `${referenceLabel} and ${targetPath} differs ` +
            `(${pinnedObject} vs ${releasedObject}); advance every first-party pin together`,
        );
      }
    }
  }
  await assertProseCommitReferences({
    repositoryRoot,
    actionSha,
    listDocuments: gitImpl?.listDocuments ?? defaultListDocuments,
    isCommit: gitImpl?.isCommit ?? defaultIsCommit,
  });
  return { releaseTag: latest, releaseCommit: latestCommit, actionSha };
}

// R-004: prose pins. assertFirstPartyConsistency reads `uses:` lines out of
// parsed YAML, so it is blind to the same SHA written into a Markdown sentence
// — and four published documents tell a consumer to "keep that exact pin"
// followed by a literal 40-character SHA. Nothing advanced those with the
// YAML pins, and nothing failed when they were left behind.
//
// The discriminator is `git cat-file -e <sha>^{commit}`, not a regex. This
// repository's docs legitimately contain 40-hex tokens that are not commits:
// DESIGN.md's protocol examples use `0000...0001` as a headSha and `aaaa...`
// as a scope digest. Those resolve to no object and are correctly ignored,
// while any real commit reference is either the current pin or stale by
// construction. A pattern narrow enough to skip the fixtures would have to
// guess at prose, and would drift the moment a doc reworded its sentence.
//
// `.trellis/` is excluded on purpose: archived task records are a historical
// account of what was true at the time, not instructions to a consumer.
// CHANGELOG.md is deliberately NOT excluded, even though it is also historical:
// a changelog is where upgrade instructions live, so a full SHA printed there
// is exactly as consumer-facing as one in a setup guide. Cite an old commit in
// the abbreviated form — that is the conventional notation for a historical
// reference, and the full 40-character form is the notation for a pin.
async function assertProseCommitReferences({
  repositoryRoot,
  actionSha,
  listDocuments,
  isCommit,
}) {
  const documents = await listDocuments(repositoryRoot);
  const stale = [];
  for (const filePath of documents) {
    const source = await readFile(path.join(repositoryRoot, filePath), "utf8");
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const [sha] of line.matchAll(/\b[0-9a-f]{40}\b/gu)) {
        if (sha === actionSha) continue;
        if (!(await isCommit(repositoryRoot, sha))) continue;
        stale.push(`${filePath}:${index + 1}: ${sha}`);
      }
    }
  }
  if (stale.length) {
    throw new Error(
      `prose commit reference is stale — the first-party pin is ${actionSha}, but ` +
        `${stale.length} Markdown reference(s) name a different commit of this ` +
        `repository:\n  ${stale.join("\n  ")}\n` +
        "advance prose SHAs with the YAML pins, in the same commit",
    );
  }
}

// The published Markdown set. A seam rather than a direct call because the
// twenty-odd assertPinFreshness fixtures write into bare temp directories that
// are not git repositories at all; `git ls-files` there fails on the repository
// probe rather than on anything this gate is about. Production reads the real
// tracked set, so a document cannot escape the gate by being unlisted.
async function defaultListDocuments(repositoryRoot) {
  return (await trackedRepositoryPaths(repositoryRoot)).filter(
    (filePath) => filePath.endsWith(".md") && !filePath.startsWith(".trellis/"),
  );
}

// True only for a SHA that names a commit object in this repository.
//
// `rev-parse --verify --quiet` rather than `cat-file -e`: peeling an absent
// object with `^{commit}` makes cat-file exit 128 with `fatal: Not a valid
// object name`, which is indistinguishable from a genuinely broken repository.
// `--quiet` is the documented "answer false instead of failing" form — it exits
// 1 with no output — so a nonzero exit other than 1, or git missing entirely,
// still propagates rather than reporting a clean document set.
async function defaultIsCommit(repositoryRoot, sha) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`],
      { encoding: "utf8" },
    );
    return stdout.trim().length === 40;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
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
  // Freshness is deliberately NOT asserted here, though design D2a proposed it.
  // This function's own tests pass synthetic non-git temp roots with a partial
  // injected gitImpl, so a tag probe throws on the repository rather than on
  // staleness — D2a's objection to putting the check inside validateMetadata,
  // one path further along than D2a looked. Wiring it here would have required
  // editing those fixtures to accommodate the check, which implement.md Step 2
  // forbids. The CLI entrypoint is what CI gates on and carries the check
  // unconditionally, so no path CI executes is left uncovered.
  return { ...base, releaseTag, releaseChecked: true };
}

// R-005: a lane may only pass inputs the action *at its pin* declares.
//
// assertFirstPartyConsistency proves every lane agrees on one SHA, and
// assertPinFreshness proves that SHA carries the release's action code. Neither
// looks at the `with:` block, so a lane can pass an input the pinned action has
// never heard of and every check stays green. That is not hypothetical: four
// lanes wired `route-policy`, `stranded-receipt-minutes`, and
// `fail-on-reconciliation` while pinned to a release declaring none of the
// three, which made a documented route policy silently inert.
//
// Deliberately release-time only, called from the CLI's --release-tag branch
// rather than from validateMetadata. During development the pin legitimately
// lags: the lanes reference the action being built while still pinned to the
// last release, and that window is exactly what the pin-advance-before-tag
// ordering exists to close. Failing CI throughout development would make the
// gate something to disable rather than something to satisfy. At the moment a
// release is cut the pin has advanced, and then the check must hold.
export async function assertPinnedInputsDeclared({
  repositoryRoot = process.cwd(),
  gitImpl,
} = {}) {
  const readPinnedAction = gitImpl?.readPinnedAction ?? defaultReadPinnedAction;
  const { actionOwnerRepo, actionSha } = await readSetupDescriptor(repositoryRoot);

  const pinnedAction = parseYaml(
    await readPinnedAction(repositoryRoot, actionSha),
    `${actionSha}:action.yml`,
  );
  const declared = new Set(Object.keys(pinnedAction?.inputs ?? {}));

  const undeclared = [];
  for (const [filePath, document] of await laneDocuments(repositoryRoot)) {
    for (const job of Object.values(document?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.uses !== "string") continue;
        if (!referencesThisAction(step.uses, actionOwnerRepo)) continue;
        for (const key of Object.keys(step.with ?? {})) {
          if (!declared.has(key)) undeclared.push(`${filePath}: ${key}`);
        }
      }
    }
  }
  if (undeclared.length) {
    throw new Error(
      `lane passes an input the pinned action does not declare — ${actionSha} declares ` +
        `${declared.size} input(s), and these are not among them:\n  ${undeclared.join("\n  ")}\n` +
        "advance every first-party pin to the release that declares them",
    );
  }
  return { actionSha, declaredCount: declared.size };
}

// Every shipped lane, parsed once: the tracked workflows plus the examples.
// Enumerated from the filesystem rather than listed, so a lane added later
// reaches this gate without an edit here.
async function laneDocuments(repositoryRoot) {
  const documents = [];
  for (const directory of [
    path.join(repositoryRoot, ".github", "workflows"),
    path.join(repositoryRoot, "examples"),
  ]) {
    let names;
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
      const filePath = path.join(directory, name);
      documents.push([
        path.relative(repositoryRoot, filePath),
        parseYaml(await readFile(filePath, "utf8"), filePath),
      ]);
    }
  }
  return documents;
}

async function defaultReadPinnedAction(repositoryRoot, sha) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "show", `${sha}:action.yml`],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

export function parseReleaseTag(argv, env) {
  const flagIndex = argv.indexOf("--release-tag");
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--release-tag requires a v<semver> value");
    }
    return value;
  }
  const envValue = env.SD_RELEASE_TAG;
  if (envValue !== undefined && envValue !== null) {
    // An explicitly-set-but-empty env var must not silently skip the gate.
    if (envValue === "") {
      throw new Error("SD_RELEASE_TAG is set but empty; provide a v<semver> tag or unset it");
    }
    return envValue;
  }
  return null;
}

async function runCli() {
  const releaseTag = parseReleaseTag(process.argv.slice(2), process.env);
  return releaseTag
    ? validateReleaseConsistency({ releaseTag }).then(async (result) => {
        const { declaredCount } = await assertPinnedInputsDeclared();
        console.log(
          `Validated release ${result.releaseTag}: action.yml, ${result.workflowCount} workflow(s), ` +
            `${result.exampleCount} example(s), ${result.trackedPathCount} tracked public path(s), ` +
            `and every lane input against the pinned action's ${declaredCount} declared input(s).`,
        );
      })
    : validateMetadata().then(async ({ workflowCount, exampleCount, trackedPathCount }) => {
        const { releaseTag } = await assertPinFreshness();
        console.log(
          `Validated action.yml, ${workflowCount} workflow(s), ${exampleCount} example(s), and ${trackedPathCount} tracked public path(s), ` +
            `pinned to the current release ${releaseTag}.`,
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
