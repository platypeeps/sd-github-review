// Regression coverage for the CI/local parity gate (A-017). Proves the shipped
// `check:full` package script mirrors every CI package gate, that the validator
// flags drift and a missing `check:full`, and that a removed package script
// makes the local gate itself fail (a skipped gate is not success).

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { evaluateParity } from "../scripts/validate-ci-parity.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(relative) {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function checkFullCommand() {
  const pkg = JSON.parse(readRepo("package.json"));
  return pkg.scripts["check:full"];
}

test("shipped check:full mirrors every CI package gate", () => {
  const result = evaluateParity({
    ciText: readRepo(".github/workflows/ci.yml"),
    checkFullCommand: checkFullCommand(),
  });
  assert.equal(result.checkFull, true, "package.json must define check:full");
  assert.deepEqual(result.missing, [], `check:full is missing CI gates: ${result.missing.join(", ")}`);
  assert.ok(result.ok);
  // The gates the audit and CI care about are actually present.
  for (const gate of ["test", "test:coverage", "check", "validate:metadata"]) {
    assert.ok(result.ciGates.includes(gate), `CI should run ${gate}`);
    assert.ok(result.localGates.includes(gate), `check:full should run ${gate}`);
  }
});

test("validator reports drift when CI runs a gate check:full omits", () => {
  const ciText = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: npm test",
    "      - run: npm run check",
    "      - run: npm run validate:metadata",
  ].join("\n");
  const result = evaluateParity({
    ciText,
    checkFullCommand: "npm test && npm run check",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["validate:metadata"]);
});

test("validator fails closed when check:full is absent", () => {
  const result = evaluateParity({
    ciText: "      - run: npm test\n",
    checkFullCommand: null,
  });
  assert.equal(result.checkFull, false);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["test"]);
});

test("npm ci is not treated as a package gate; npm test aliases the test script", () => {
  const result = evaluateParity({
    ciText: "      - run: npm ci\n      - run: npm test\n",
    checkFullCommand: "npm test",
  });
  assert.deepEqual(result.ciGates, ["test"]);
  assert.equal(result.ok, true);
});

test("removing a package script the CI runner references makes check:full fail", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ci-parity-fixture-"));
  try {
    // check:full chains two gates; the second script is intentionally absent,
    // so `npm run` exits nonzero — the local gate fails rather than warns.
    const pkg = {
      name: "ci-parity-fixture",
      private: true,
      scripts: {
        "gate-a": "node -e \"process.exit(0)\"",
        "check:full": "npm run gate-a && npm run gate-b",
      },
    };
    await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
    await assert.rejects(
      execFileAsync("npm", ["run", "check:full"], { cwd: dir }),
      (error) => {
        assert.notEqual(error.code, 0);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
