// Regression coverage for the pre-start ready gate wired into `task.py start`.
// `.trellis/workflow.md` requires a real entry in both context manifests before
// a task starts; the enforcing check ships in the vendored command pack as
// `review-preflight.mjs seeded-task`, and `scripts/trellis-task-start-gate.py`
// is the repo-owned wiring. These tests pin the exit-code contract that makes
// the gate refuse a start rather than merely warn about one.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(REPO_ROOT, "scripts", "trellis-task-start-gate.py");
const PREFLIGHT_NAME = "sd-ai-command-pack-review-preflight.mjs";

const SEED_ROW = JSON.stringify({
  _example: 'Fill with {"file": "<path>", "reason": "<why>"}.',
});
const REAL_ROW = JSON.stringify({
  file: ".trellis/spec/backend/directory-structure.md",
  reason: "Repository layout rules this task must respect.",
});

// The gate resolves its repository root from its own location, so a copy of it
// alongside a copy of the (import-free) preflight makes a throwaway directory a
// complete environment. Fixtures therefore never land in the real tasks tree,
// where a crashed run would leave a task the backlog and preflight would see.
async function makeSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "trellis-gate-"));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  for (const script of [PREFLIGHT_NAME, "trellis-task-start-gate.py"]) {
    await writeFile(
      path.join(root, "scripts", script),
      await readFile(path.join(REPO_ROOT, "scripts", script), "utf8"),
      "utf8",
    );
  }
  return root;
}

async function runGate(taskDir, root = REPO_ROOT) {
  const gate = path.join(root, "scripts", "trellis-task-start-gate.py");
  // A sandbox root is not a git repository, so the preflight cannot resolve a
  // default branch from origin/HEAD; naming it keeps the verdict about the
  // manifests rather than about the sandbox.
  const env = { ...process.env, SD_AI_COMMAND_PACK_DEFAULT_BRANCH: "main" };
  try {
    const { stdout, stderr } = await execFileAsync("python3", [gate, taskDir], { cwd: root, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function taskRecord(suffix) {
  return {
    id: suffix,
    name: suffix,
    title: "Gate probe fixture",
    description: "Temporary fixture exercising the pre-start ready gate.",
    status: "planning",
    dev_type: null,
    scope: null,
    package: null,
    priority: "P3",
    creator: "test",
    assignee: "test",
    createdAt: "2026-01-01",
    completedAt: null,
    branch: null,
    base_branch: "main",
    worktree_path: null,
    commit: null,
    pr_url: null,
    subtasks: [],
    children: [],
    parent: null,
    relatedFiles: [],
    notes: "",
    meta: {},
    blocked: false,
    blockedOn: null,
  };
}

// The preflight only accepts an exact `.trellis/tasks/MM-DD-name` directory, so
// the fixture keeps that shape inside a sandbox root rather than in the real
// tasks tree.
async function withTaskDir(rows, run) {
  const suffix = "gate-probe";
  const root = await makeSandbox();
  const taskDir = path.join(root, ".trellis", "tasks", `01-01-${suffix}`);
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, "implement.jsonl"), `${rows}\n`, "utf8");
  await writeFile(path.join(taskDir, "check.jsonl"), `${rows}\n`, "utf8");
  // The seeded-task command inspects the whole task record, so the fixture
  // needs a task.json and prd.md that are themselves valid; otherwise the
  // manifest verdict is masked by unrelated findings.
  await writeFile(path.join(taskDir, "task.json"), `${JSON.stringify(taskRecord(suffix), null, 2)}\n`, "utf8");
  await writeFile(
    path.join(taskDir, "prd.md"),
    "# Gate probe fixture\n\n## Goal\n\nExercise the pre-start ready gate.\n\n" +
      "## Acceptance Criteria\n\n- [ ] The gate reports a verdict for this directory.\n",
    "utf8",
  );
  try {
    return await run(path.relative(root, taskDir), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("gate refuses a task whose manifests hold only the seed row", async () => {
  const result = await withTaskDir(SEED_ROW, runGate);
  assert.equal(result.code, 1, "a seed-only task must refuse the start");
  assert.match(result.stderr, /task_context_seed/);
  assert.match(result.stderr, /implement\.jsonl/);
  assert.match(result.stderr, /check\.jsonl/);
});

test("gate allows a task whose manifests carry a real entry", async () => {
  const result = await withTaskDir(REAL_ROW, runGate);
  assert.equal(result.code, 0, `curated manifests must pass; stderr: ${result.stderr}`);
});

test("gate rejects a bad invocation without pretending the task is ready", async () => {
  for (const argv of [[], [".", "extra"]]) {
    const result = await execFileAsync("python3", [GATE, ...argv], { cwd: REPO_ROOT }).then(
      () => ({ code: 0, stderr: "" }),
      (error) => ({ code: error.code, stderr: error.stderr ?? "" }),
    );
    assert.equal(result.code, 2, `argv ${JSON.stringify(argv)} must be a usage error`);
    assert.match(result.stderr, /usage:/);
  }
});

test("gate refuses a task directory the preflight will not accept", async () => {
  // A missing directory comes back as a structured finding; option-like and
  // traversal paths are rejected before the preflight reports at all. Both
  // shapes must refuse -- a gate that cannot evaluate must not wave the start
  // through.
  for (const argv of [".trellis/tasks/01-01-does-not-exist", "--repo", "../../etc"]) {
    const result = await runGate(argv);
    assert.equal(result.code, 1, `argv ${JSON.stringify(argv)} must refuse the start`);
    assert.match(result.stderr, /Ready gate (failed for|could not evaluate)/);
  }
});

test("gate degrades visibly rather than refusing when the preflight is unreachable", async () => {
  // A gate that cannot report must not block every start on unrelated tooling
  // breakage. Running from a directory with no command pack exercises that path
  // through the script's own missing-preflight branch.
  const parent = await mkdtemp(path.join(os.tmpdir(), "trellis-gate-nopack-"));
  const copied = path.join(parent, "scripts");
  await mkdir(copied, { recursive: true });
  await writeFile(path.join(copied, "trellis-task-start-gate.py"), await readFile(GATE, "utf8"), "utf8");
  try {
    const result = await execFileAsync(
      "python3",
      [path.join(copied, "trellis-task-start-gate.py"), parent],
      { cwd: parent },
    ).then(
      (ok) => ({ code: 0, stderr: ok.stderr }),
      (error) => ({ code: error.code, stderr: error.stderr ?? "" }),
    );
    assert.equal(result.code, 0, "a missing command pack must not block the start");
    assert.match(result.stderr, /\[skip\] ready gate not run/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
