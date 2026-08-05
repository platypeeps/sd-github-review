// Transport layer for the consumer installer: bounded subprocess execution,
// secret-safe error mapping, the `gh` CLI seam, and the installer's own source
// git/provenance resolution. It imports only the codecs leaf so the downhill
// dependency direction stays intact.
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  COMMIT_PATTERN,
  RELEASE_TAG_PATTERN,
  SECRET_NAME,
  TEMPLATE_PATH,
  resolveOverride,
} from "./codecs.mjs";

const execFileAsync = promisify(execFile);

// Bounded wall-clock deadlines for the installer's own subprocesses, so a hung
// network call or a credential helper waiting on a prompt cannot stall the
// installer forever. `gh` subprocesses reach the network (repo/label/secret
// APIs), so they get the larger bound; local `git` metadata reads get the
// smaller one. Both are positive and fixed here, never derived from input.
export const GH_COMMAND_TIMEOUT_MS = 120_000;
export const GIT_COMMAND_TIMEOUT_MS = 30_000;

function redact(value, secret) {
  if (!secret || typeof value !== "string") return value;
  return value.replaceAll(secret, "[redacted]");
}

function commandFailure(command, args, result, secret) {
  const stderr = redact(result.stderr?.trim(), secret);
  const detail = stderr || `exit status ${result.status ?? "unknown"}`;
  // Redact the args too: a secret can be passed via options.secret, and the
  // nonzero-exit path must not leak it when the timeout/startup paths do not.
  const redactedArgs = args.map((arg) => redact(arg, secret)).join(" ");
  return new Error(`${command} ${redactedArgs} failed: ${detail}`);
}

function commandTimeout(command, args, timeoutMs, secret, readOnly) {
  // Name the command and its (secret-redacted) args, never stdin, and match the
  // recovery guidance to the command's effect. A killed mutating subprocess
  // (variable/secret/label set or delete) may have partially applied a remote
  // change, so the operator reconciles state; a read-only query (the repo,
  // variable, secret, and label list calls behind inspect()) has no side effect
  // to reconcile, so a plain retry is safe.
  const redactedArgs = args.map((arg) => redact(arg, secret)).join(" ");
  const guidance = readOnly
    ? "the read was interrupted — retry once GitHub is responsive"
    : "verify no partial change was applied before retrying";
  return new Error(
    `${command} ${redactedArgs} timed out after ${timeoutMs}ms; ${guidance}`,
  );
}

// Shared interpretation of a spawnSync-shaped result. Both the synchronous
// runCommand and the asynchronous runCommandAsync route through this so the
// timeout wording, secret redaction, and failure mapping cannot diverge.
function interpretCommandResult(command, args, result, options, timeoutMs) {
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw commandTimeout(command, args, timeoutMs, options.secret, options.readOnly);
    }
    throw new Error(`${command} could not start: ${redact(result.error.message, options.secret)}`);
  }
  if (result.status !== 0) {
    throw commandFailure(command, args, result, options.secret);
  }
  return result.stdout ?? "";
}

function parseCommandJson(command, args, output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${command} ${args.join(" ")} returned invalid JSON`);
  }
}

function runCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const timeoutMs = options.timeoutMs ?? GH_COMMAND_TIMEOUT_MS;
  const result = spawnImpl(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    input: options.input,
    stdio: options.inherit ? "inherit" : undefined,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  return interpretCommandResult(command, args, result, options, timeoutMs);
}

// execFile represents a timeout in two ways across Node versions: a string code
// "ETIMEDOUT", or a killSignal-kill (killed + signal === killSignal) with NO
// error code. execFile ALSO kills the child with killSignal on a maxBuffer
// overflow, but that rejection carries a string code
// ("ERR_CHILD_PROCESS_STDIO_MAXBUFFER"); requiring the code to be absent keeps a
// maxBuffer (or any other coded kill) from being misreported as a timeout.
function isTimeoutKill(error, killSignal) {
  if (error.code === "ETIMEDOUT") return true;
  return Boolean(error.killed) && error.signal === killSignal && error.code == null;
}

// Asynchronous sibling of runCommand for independent read-only queries that can
// overlap. It maps execFile's rejection into the same spawnSync-shaped result
// interpretCommandResult understands. Not used for mutations, which stay on the
// ordered synchronous path.
async function runCommandAsync(command, args, options = {}) {
  const execImpl = options.execImpl ?? execFileAsync;
  const timeoutMs = options.timeoutMs ?? GH_COMMAND_TIMEOUT_MS;
  let result;
  try {
    const { stdout } = await execImpl(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      env: process.env,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    result = { error: null, status: 0, stdout, stderr: "" };
  } catch (error) {
    if (isTimeoutKill(error, "SIGTERM")) {
      result = {
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        status: null,
        stdout: "",
        stderr: error.stderr ?? "",
      };
    } else if (typeof error.code === "number") {
      result = { error: null, status: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    } else {
      result = { error, status: null, stdout: "", stderr: "" };
    }
  }
  return interpretCommandResult(command, args, result, options, timeoutMs);
}

export class GitHubCli {
  // spawnImpl/timeoutMs are injectable so fake-child-process tests can drive the
  // timeout, redaction, and recovery-guidance paths without a real subprocess.
  // execImpl is the async execFile seam used only by the concurrent read path
  // (inspect); spawnImpl remains the synchronous seam for all mutations, so
  // installation state transitions stay ordered. Both are injectable for tests.
  constructor({ spawnImpl = spawnSync, execImpl = execFileAsync, timeoutMs = GH_COMMAND_TIMEOUT_MS } = {}) {
    this.spawnImpl = spawnImpl;
    this.execImpl = execImpl;
    this.timeoutMs = timeoutMs;
  }

  run(command, args, options = {}) {
    return runCommand(command, args, {
      ...options,
      spawnImpl: this.spawnImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  runJson(command, args) {
    // runJson only wraps read-only list/view queries, so a timeout gets the
    // plain-retry guidance rather than the mutation reconciliation wording.
    const output = this.run(command, args, { readOnly: true });
    return parseCommandJson(command, args, output);
  }

  // Asynchronous read used by inspect so its independent queries can overlap.
  async #runJsonAsync(command, args) {
    const output = await runCommandAsync(command, args, {
      readOnly: true,
      execImpl: this.execImpl,
      timeoutMs: this.timeoutMs,
    });
    return parseCommandJson(command, args, output);
  }

  async inspect(repository) {
    // Four independent, read-only queries — a fixed, bounded fan-out with no
    // cross-dependency, so they run concurrently rather than summing round trips.
    const [repo, variables, secrets, labels] = await Promise.all([
      this.#runJsonAsync("gh", ["repo", "view", repository, "--json", "nameWithOwner"]),
      this.#runJsonAsync("gh", ["variable", "list", "--repo", repository, "--json", "name,value"]),
      this.#runJsonAsync("gh", ["secret", "list", "--repo", repository, "--json", "name"]),
      this.#runJsonAsync("gh", [
        "label",
        "list",
        "--repo",
        repository,
        "--limit",
        "1000",
        "--json",
        "name,color,description",
      ]),
    ]);
    return {
      repository: repo.nameWithOwner,
      variables: new Map(variables.map(({ name, value }) => [name, value])),
      secrets: new Set(secrets.map(({ name }) => name)),
      labels: new Map(labels.map((label) => [label.name, label])),
    };
  }

  async setVariable(repository, name, value) {
    this.run("gh", ["variable", "set", name, "--repo", repository, "--body", value]);
  }

  async deleteVariable(repository, name) {
    this.run("gh", ["variable", "delete", name, "--repo", repository]);
  }

  async createLabel(repository, label) {
    this.run("gh", [
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
    this.run("gh", ["label", "delete", name, "--repo", repository, "--yes"]);
  }

  async setSecret(repository, { interactive = false, value } = {}) {
    const args = ["secret", "set", SECRET_NAME, "--repo", repository];
    if (interactive) {
      this.run("gh", args, { inherit: true });
      return;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("secret input must be nonempty");
    }
    this.run("gh", args, { input: value, secret: value });
  }

  async deleteSecret(repository) {
    this.run("gh", ["secret", "delete", SECRET_NAME, "--repo", repository]);
  }
}

export function gitOutput(target, args, execImpl = execFileSync, timeoutMs = GIT_COMMAND_TIMEOUT_MS) {
  try {
    return execImpl("git", ["-C", target, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    }).trim();
  } catch (error) {
    if (error && error.code === "ETIMEDOUT") {
      // Every gitOutput call is a read-only metadata query, so a timeout has no
      // side effect to reconcile; the safe recovery is simply to retry.
      throw new Error(
        `${target}: git ${args.join(" ")} timed out after ${timeoutMs}ms; ` +
          "the read was interrupted — retry once the source checkout is responsive",
      );
    }
    const detail = typeof error.stderr === "string" && error.stderr.trim()
      ? error.stderr.trim()
      : error.message;
    throw new Error(`${target}: git ${args.join(" ")} failed: ${detail}`);
  }
}

// Git seam for the installer's own source root, mirroring gitOutput. Injected in
// tests via dependencies.gitImpl so provenance resolution is deterministic;
// execImpl is a narrower seam so a fake-child test can drive gitOutput's own
// bounded-timeout path directly.
export function makeSourceGit(sourceRoot, execImpl = execFileSync) {
  return {
    head() {
      return gitOutput(sourceRoot, ["rev-parse", "HEAD"], execImpl);
    },
    exactTag() {
      try {
        return gitOutput(sourceRoot, ["describe", "--tags", "--exact-match", "HEAD"], execImpl);
      } catch {
        return null;
      }
    },
    templateDirty() {
      return gitOutput(sourceRoot, ["status", "--porcelain", "--", TEMPLATE_PATH], execImpl).length > 0;
    },
  };
}

export async function readSourceVersion(sourceRoot) {
  let raw;
  try {
    raw = await readFile(path.join(sourceRoot, "package.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
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
