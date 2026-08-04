// Reusable fixtures for exercising the *shipped* process entrypoints as real
// subprocesses (A-006). Unlike the in-process unit tests, these run
// `node <entrypoint>` with an injected filesystem, environment, and PATH so the
// composition roots — argument parsing, env reads, exit status, redaction, and
// the `gh`/git boundaries — are covered end to end. Everything here is
// hermetic: temporary directories, a fake `gh` on PATH, and locally
// git-initialised repositories. No real repository, network, secret, or user
// directory is ever touched.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

// A GitHub API URL that can never resolve to a real network host, so a test
// that unexpectedly builds a client fails loudly instead of reaching GitHub.
export const UNROUTABLE_API_URL = "http://127.0.0.1:0/unroutable";

export async function makeTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `sd-review-${prefix}-`));
}

// Run one of the repository's shipped entrypoints as a subprocess. The child
// receives ONLY the environment provided plus PATH; inherited GITHUB_* and
// INPUT_* variables from the surrounding CI job never leak in.
export function runEntrypoint(relativeScript, args = [], { env = {}, input, extraPath = [] } = {}) {
  const pathParts = [...extraPath, process.env.PATH ?? ""].filter(Boolean);
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, relativeScript), ...args], {
    cwd: REPO_ROOT,
    env: { PATH: pathParts.join(path.delimiter), ...env },
    input,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Materialise a fake `gh` executable in a temporary bin directory and return
// the directory (to prepend to PATH), the path of its call log, and helpers to
// read the recorded calls. The fake answers the exact read commands
// `GitHubCli.inspect` issues and accepts every mutation with exit 0, recording
// one JSON line per invocation. Preconfigured secrets/labels/variables let a
// test model an already-partly-installed target.
// `failOn` is a `[group, action]` pair (e.g. ["secret", "set"]); when the fake
// receives that command it reads its stdin, echoes it to stderr, and exits 1 —
// letting a test prove the installer redacts a secret that surfaces in a failed
// command's error output.
export async function makeFakeGh({ secrets = [], labels = [], variables = {}, failOn = null } = {}) {
  const binDir = await makeTempDir("bin");
  const logPath = path.join(binDir, "gh-calls.log");
  const state = { secrets, labels, variables, failOn };
  // A `.cjs` implementation is unambiguously CommonJS regardless of the repo's
  // package.json `type`; a tiny POSIX shell shim named exactly `gh` is what
  // PATH resolution finds and it execs the implementation with node.
  const implPath = path.join(binDir, "gh-impl.cjs");
  const impl = `#!/usr/bin/env node
"use strict";
const { appendFileSync } = require("node:fs");
const argv = process.argv.slice(2);
appendFileSync(process.env.GH_FAKE_LOG, JSON.stringify(argv) + "\\n");
const state = ${JSON.stringify(state)};
const group = argv[0];
const action = argv[1];
function emit(value) { process.stdout.write(JSON.stringify(value)); }
if (state.failOn && group === state.failOn[0] && action === state.failOn[1]) {
  let stdin = "";
  try { stdin = require("node:fs").readFileSync(0, "utf8"); } catch (_error) { stdin = ""; }
  process.stderr.write("gh " + group + " " + action + " failed: " + stdin);
  process.exit(1);
}
if (action === "view" && group === "repo") {
  emit({ nameWithOwner: argv[2] });
} else if (action === "list") {
  if (group === "variable") emit(Object.entries(state.variables).map((entry) => ({ name: entry[0], value: entry[1] })));
  else if (group === "secret") emit(state.secrets.map((name) => ({ name })));
  else if (group === "label") emit(state.labels);
  else emit([]);
}
// Every mutation (set/delete/create) and the interactive secret path succeed.
process.exit(0);
`;
  writeFileSync(implPath, impl, "utf8");
  chmodSync(implPath, 0o755);
  const ghPath = path.join(binDir, "gh");
  const shim = `#!/bin/sh\nexec "${process.execPath}" "${implPath}" "$@"\n`;
  writeFileSync(ghPath, shim, "utf8");
  chmodSync(ghPath, 0o755);
  return {
    binDir,
    logPath,
    async calls() {
      const raw = await readFile(logPath, "utf8").catch(() => "");
      return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    },
  };
}

function git(target, args) {
  execFileSync("git", ["-C", target, ...args], { stdio: "ignore" });
}

// A throwaway git checkout with an `origin` pointing at a GitHub URL. The
// remote is config only — nothing contacts it — so `parseGitHubRemote` can
// derive OWNER/REPO exactly as it would for a real consumer checkout.
export async function makeGitTarget(repository = "acme/consumer") {
  const root = await makeTempDir("target");
  git(root, ["init", "-b", "main"]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", `https://github.com/${repository}.git`], {
    stdio: "ignore",
  });
  return root;
}

// Write a GitHub Actions event payload to a temp file and return its path.
export async function writeEventFile(event) {
  const dir = await makeTempDir("event");
  const eventPath = path.join(dir, "event.json");
  await writeFile(eventPath, `${JSON.stringify(event)}\n`, "utf8");
  return eventPath;
}

// Parse a GITHUB_OUTPUT file written with the heredoc delimiter format
// `name<<delim\nvalue\ndelim\n` into a plain object.
export function parseGithubOutput(contents) {
  const outputs = {};
  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([^<]+)<<(.+)$/u.exec(lines[index]);
    if (!match) continue;
    const [, name, delimiter] = match;
    const valueLines = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      valueLines.push(lines[index]);
      index += 1;
    }
    outputs[name] = valueLines.join("\n");
  }
  return outputs;
}
