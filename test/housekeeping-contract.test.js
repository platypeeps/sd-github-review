// The installed pack's housekeeping contract, seen from this consumer. Under a
// thin install the script is not in this tree: it lives wherever the machine
// keeps the pack, so the resolver -- not a path -- says where to run it from,
// and these tests skip on a machine with no install rather than assert about a
// script nobody shipped there.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT_RESOLVER = path.join(
  REPO_ROOT,
  ".sd-ai-command-pack",
  "bin",
  "sd-ai-command-pack-review-layout.py",
);
const HOUSEKEEPING_NAME = "sd-ai-command-pack-housekeeping.sh";

function installedHousekeeping() {
  try {
    const stdout = execFileSync("python3", [LAYOUT_RESOLVER, "--resolve", HOUSEKEEPING_NAME], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = JSON.parse(stdout);
    return typeof resolved?.path === "string" && resolved.path !== "" ? resolved.path : null;
  } catch {
    return null;
  }
}

const HOUSEKEEPING = installedHousekeeping();
const NO_PACK = HOUSEKEEPING === null ? "no resolvable sd-ai-command-pack install on this machine" : false;

test("installed housekeeping refuses merge without finish-work handoff", { skip: NO_PACK }, () => {
  const result = spawnSync("bash", [HOUSEKEEPING, "--self-test"], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test: green executed checks merge: ok/);
  assert.match(result.stdout, /self-test: all scenarios passed/);
});

test("receipt-based housekeeping rejects the retired head-only option", { skip: NO_PACK }, (t) => {
  const selfTest = spawnSync("bash", [HOUSEKEEPING, "--self-test"], { encoding: "utf8" });

  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  if (!selfTest.stdout.includes("finish-work receipt required: ok")) {
    t.skip("installed command pack predates the receipt contract");
    return;
  }

  const result = spawnSync(
    "bash",
    [HOUSEKEEPING, "--finish-work-head", "not-a-commit", "--self-test"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option: --finish-work-head/);
});
