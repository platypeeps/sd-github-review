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
  assert.match(result.stdout, /self-test: finish-work head required: ok/);
  assert.match(result.stdout, /self-test: stale finish-work head refuses: ok/);
  assert.match(result.stdout, /self-test: green executed checks merge: ok/);
});

test("installed housekeeping rejects a malformed finish-work head", () => {
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
  assert.match(result.stderr, /must be a full 40-character commit OID/);
});
