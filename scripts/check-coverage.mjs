#!/usr/bin/env node
// Coverage gate for the shipped runtime (A-006). Runs the test suite with
// Node's built-in coverage restricted to product code, then enforces a
// conservative GLOBAL floor plus per-file floors for the critical process
// boundaries. Floors sit a few points below current coverage: high enough to
// catch a real regression, low enough not to flake on incidental line moves.
//
// The interactive TTY paths in install-consumer.mjs (the uninstall
// confirmation prompt and the interactive secret readline) are deliberately
// NOT demanded at a high branch floor — they are side-effecting terminal
// boundaries that must not be faked to inflate a number.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Coverage is measured only for shipped product code; test files, fixtures, and
// dev tooling are excluded so the numbers reflect what consumers actually run.
const INCLUDES = ["src/**", "scripts/consumer-installer.mjs", "scripts/install-consumer.mjs"];

// [lines, branches, functions] minimum percentages.
const GLOBAL_FLOOR = { lines: 88, branches: 77, functions: 88 };
const FILE_FLOORS = {
  "src/index.js": { lines: 95, branches: 82, functions: 88 },
  "scripts/consumer-installer.mjs": { lines: 82, branches: 73, functions: 85 },
  "scripts/install-consumer.mjs": { lines: 70, branches: 45, functions: 60 },
};

function runCoverage() {
  const args = ["--test", "--experimental-test-coverage"];
  for (const include of INCLUDES) args.push(`--test-coverage-include=${include}`);
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

// Parse the spec reporter's coverage table. Rows look like:
//   ℹ  index.js | 99.37 | 87.64 | 90.91 | 64-65
//   ℹ all files | 91.35 | 81.24 | 92.69 |
// The leaf file name is the last path segment the reporter prints; match each
// critical file by its basename and the global row by the "all files" label.
function parseCoverage(output) {
  const rows = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/^ℹ\s?/u, "").trim();
    const match = /^(.*?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/u.exec(line);
    if (!match) continue;
    const [, label, lines, branches, functions] = match;
    rows.push({
      label: label.trim(),
      lines: Number(lines),
      branches: Number(branches),
      functions: Number(functions),
    });
  }
  return rows;
}

function findRow(rows, predicate, description) {
  const row = rows.find(predicate);
  if (!row) throw new Error(`coverage row not found for ${description}`);
  return row;
}

function checkFloor(name, row, floor, failures) {
  for (const metric of ["lines", "branches", "functions"]) {
    if (row[metric] < floor[metric]) {
      failures.push(`${name}: ${metric} ${row[metric].toFixed(2)}% < floor ${floor[metric]}%`);
    }
  }
}

function main() {
  const result = runCoverage();
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    console.error("check-coverage: the test run failed; fix tests before enforcing floors");
    process.exit(result.status ?? 1);
  }
  const rows = parseCoverage(output);
  const failures = [];

  const global = findRow(rows, (row) => row.label === "all files", "the global summary");
  checkFloor("all files", global, GLOBAL_FLOOR, failures);

  for (const [file, floor] of Object.entries(FILE_FLOORS)) {
    const base = path.basename(file);
    const row = findRow(rows, (r) => r.label === base || r.label.endsWith(base), file);
    checkFloor(file, row, floor, failures);
  }

  if (failures.length > 0) {
    process.stdout.write(output);
    console.error("\ncheck-coverage: coverage floors not met:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `check-coverage: OK (global ${global.lines.toFixed(2)}% lines / ` +
      `${global.branches.toFixed(2)}% branches / ${global.functions.toFixed(2)}% funcs)`,
  );
}

main();
