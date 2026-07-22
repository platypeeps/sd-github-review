import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateMetadata } from "../scripts/validate-action-metadata.mjs";

test("validates the repository action metadata, pinned workflows, and examples", async () => {
  const result = await validateMetadata(path.resolve(import.meta.dirname, ".."));
  assert.equal(result.workflowCount, 1);
  assert.equal(result.exampleCount, 3);
});

test("rejects floating third-party Action references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-metadata-"));
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, "index.js"), "", "utf8");
  await writeFile(
    path.join(root, "action.yml"),
    [
      "name: Fixture",
      "description: Fixture action",
      "inputs: {}",
      "outputs: {}",
      "runs:",
      "  using: node24",
      "  main: index.js",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on:",
      "  push:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    validateMetadata(root),
    /must pin third-party action actions\/checkout@v4 to a 40-character commit SHA/u,
  );
});
