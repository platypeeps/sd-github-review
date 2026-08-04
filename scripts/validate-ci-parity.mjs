#!/usr/bin/env node
// CI/local parity gate (A-017). The prescribed local full-check for this
// repository runs through the `check:full` package script (see
// scripts/sd-ai-command-pack-review-full-check.sh, which prefers a
// repository-owned `check:full` over the generic pack fallback). This validator
// keeps that local gate honest: every npm package gate the CI workflow runs
// must also run in `check:full`, so a green local gate means the same gates CI
// enforces actually executed.
//
// It fails — not warns — when `check:full` is missing or when CI runs a package
// gate that `check:full` does not, because a skipped gate is not success.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `npm ci` installs dependencies; it is not a package script gate and never
// belongs in the parity inventory.
const NON_GATE_NPM_SUBCOMMANDS = new Set(["ci", "install", "i", "clean-install"]);

// Extract the set of npm package-script gates named in a block of shell text.
// Recognizes `npm run <name>` and the `npm test` alias for the `test` script.
// Comment lines (leading `#`) are ignored so documentation cannot spoof a gate.
function extractGates(text) {
  const gates = new Set();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const runRe = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;
    let match;
    while ((match = runRe.exec(line)) !== null) gates.add(match[1]);
    const bareRe = /\bnpm\s+([A-Za-z0-9:_-]+)/g;
    while ((match = bareRe.exec(line)) !== null) {
      const sub = match[1];
      if (sub === "run") continue;
      if (NON_GATE_NPM_SUBCOMMANDS.has(sub)) continue;
      // `npm test` / `npm t` are aliases for the `test` script.
      if (sub === "test" || sub === "t") gates.add("test");
    }
  }
  return gates;
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${filePath}: ${error.message}`);
  }
}

function loadCheckFullCommand(packagePath) {
  const raw = readText(packagePath);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse ${packagePath} as JSON: ${error.message}`);
  }
  const scripts =
    payload && typeof payload === "object" && payload.scripts && typeof payload.scripts === "object"
      ? payload.scripts
      : {};
  const command = scripts["check:full"];
  if (typeof command !== "string" || command.trim() === "") return null;
  return command;
}

function parseArgs(argv) {
  const options = {
    ci: path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
    package: path.join(REPO_ROOT, "package.json"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ci-file") {
      options.ci = argv[(index += 1)];
    } else if (arg === "--package-file") {
      options.package = argv[(index += 1)];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (options.ci === undefined || options.package === undefined) {
      throw new Error(`missing value for ${arg}`);
    }
  }
  return options;
}

// Pure core so tests can exercise parity without spawning a process.
// Returns { ok, checkFull, ciGates, localGates, missing }.
export function evaluateParity({ ciText, checkFullCommand }) {
  const ciGates = extractGates(ciText);
  if (checkFullCommand === null || checkFullCommand === undefined) {
    return {
      ok: false,
      checkFull: false,
      ciGates: [...ciGates].sort(),
      localGates: [],
      missing: [...ciGates].sort(),
    };
  }
  const localGates = extractGates(checkFullCommand);
  const missing = [...ciGates].filter((gate) => !localGates.has(gate)).sort();
  return {
    ok: missing.length === 0,
    checkFull: true,
    ciGates: [...ciGates].sort(),
    localGates: [...localGates].sort(),
    missing,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`validate-ci-parity: ${error.message}`);
    process.exit(2);
  }

  let ciText;
  let checkFullCommand;
  try {
    ciText = readText(options.ci);
    checkFullCommand = loadCheckFullCommand(options.package);
  } catch (error) {
    console.error(`validate-ci-parity: ${error.message}`);
    process.exit(2);
  }

  const result = evaluateParity({ ciText, checkFullCommand });

  if (!result.checkFull) {
    console.error(
      "validate-ci-parity: package.json defines no non-empty `check:full` script; " +
        "the local gate cannot mirror CI. CI package gates: " +
        (result.ciGates.length ? result.ciGates.join(", ") : "(none found)"),
    );
    process.exit(1);
  }

  if (!result.ok) {
    console.error(
      "validate-ci-parity: `check:full` is missing CI package gate(s): " +
        result.missing.join(", "),
    );
    console.error(`  CI gates:    ${result.ciGates.join(", ") || "(none)"}`);
    console.error(`  check:full:  ${result.localGates.join(", ") || "(none)"}`);
    process.exit(1);
  }

  console.log(
    `validate-ci-parity: OK — check:full runs all ${result.ciGates.length} CI package gate(s): ` +
      result.ciGates.join(", "),
  );
}

// Run main() only when invoked directly as the entry script. pathToFileURL
// normalizes the entry path (absolute, URL-encoded, Windows drive letters) so
// the comparison is not a fragile string concat — a mismatch here would silently
// turn the parity gate into a no-op, which is exactly what it exists to prevent.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
