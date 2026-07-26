import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("installed housekeeping refuses merge without finish-work handoff", () => {
  const result = spawnSync(
    "bash",
    ["scripts/sd-ai-command-pack-housekeeping.sh", "--self-test"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test: green executed checks merge: ok/);
  assert.match(result.stdout, /self-test: all scenarios passed/);
});

test("receipt-based housekeeping rejects the retired head-only option", (t) => {
  const selfTest = spawnSync(
    "bash",
    ["scripts/sd-ai-command-pack-housekeeping.sh", "--self-test"],
    { encoding: "utf8" },
  );

  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  if (!selfTest.stdout.includes("finish-work receipt required: ok")) {
    t.skip("installed command pack predates the receipt contract");
    return;
  }

  const result = spawnSync(
    "bash",
    [
      "scripts/sd-ai-command-pack-housekeeping.sh",
      "--finish-work-head",
      "not-a-commit",
      "--self-test",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option: --finish-work-head/);
});
