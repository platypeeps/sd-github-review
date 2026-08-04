// Subprocess coverage for the shipped installer entrypoint
// `scripts/install-consumer.mjs`. The in-process tests in
// consumer-installer.test.js inject a FakeGitHub object; these run the real CLI
// as `node scripts/install-consumer.mjs ...` against a locally git-initialised
// target with a fake `gh` on PATH, covering argument parsing, the `gh`
// boundary, JSON vs human output, TTY refusal, exit status, and secret
// redaction. No real repository, network, secret, or user directory is used.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { makeFakeGh, makeGitTarget, runEntrypoint } from "./support/subprocess.mjs";

const INSTALLER = "scripts/install-consumer.mjs";
const MANIFEST = ".github/sd-github-review.json";

function installerEnv(fakeGh, overrides = {}) {
  return { GH_FAKE_LOG: fakeGh.logPath, ...overrides };
}

const MANAGED_SECRET = "PR_AGENT_MODEL_API_KEY";

// Install into a fresh target and return the handles for follow-on lifecycle
// commands against the same checkout. The managed secret is modelled as already
// present so install reconciles to a healthy state without a secret prompt.
async function freshInstall(ghOptions = {}) {
  const target = await makeGitTarget();
  const fakeGh = await makeFakeGh({ secrets: [MANAGED_SECRET], ...ghOptions });
  const result = runEntrypoint(INSTALLER, ["install", "--target", target, "--json"], {
    env: installerEnv(fakeGh),
    extraPath: [fakeGh.binDir],
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  return { target, fakeGh, report };
}

test("installer install writes the manifest and drives gh, emitting JSON", async () => {
  const { target, fakeGh, report } = await freshInstall();
  assert.equal(report.command, "install");
  assert.equal(report.repository, "acme/consumer");
  assert.ok(existsSync(path.join(target, MANIFEST)), "manifest should be written");

  const calls = await fakeGh.calls();
  assert.ok(
    calls.some((call) => call[0] === "repo" && call[1] === "view"),
    "gh repo view should run during inspect",
  );
  assert.ok(
    calls.some((call) => call[0] === "label" && call[1] === "create"),
    "labels should be created via gh",
  );
});

test("installer install emits a human report without --json", async () => {
  const target = await makeGitTarget();
  const fakeGh = await makeFakeGh({ secrets: [MANAGED_SECRET] });
  const { status, stdout, stderr } = runEntrypoint(INSTALLER, ["install", "--target", target], {
    env: installerEnv(fakeGh),
    extraPath: [fakeGh.binDir],
  });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /install complete for acme\/consumer:/u);
  assert.doesNotMatch(stdout, /^\{/u, "human output must not be JSON");
});

// Model the GitHub side (variables, labels, secret) exactly as the manifest
// install wrote it, so a read-only check reconciles to healthy. Deriving from
// the manifest keeps the test correct if default provider/model values change.
async function githubStateFromManifest(target) {
  const manifest = JSON.parse(await readFile(path.join(target, MANIFEST), "utf8"));
  const variables = {};
  for (const [name, entry] of Object.entries(manifest.resources.variables)) {
    variables[name] = entry.value;
  }
  const labels = manifest.resources.labels.map((label) => ({ name: label.name }));
  return { secrets: [MANAGED_SECRET], variables, labels };
}

test("installer check reports a healthy installation as JSON", async () => {
  const { target } = await freshInstall();
  const fakeGh = await makeFakeGh(await githubStateFromManifest(target));
  const { status, stdout, stderr } = runEntrypoint(INSTALLER, ["check", "--target", target, "--json"], {
    env: installerEnv(fakeGh),
    extraPath: [fakeGh.binDir],
  });
  assert.equal(status, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.command, "check");
  assert.equal(report.ok, true);
});

test("installer update is idempotent over an existing installation", async () => {
  const { target } = await freshInstall();
  const fakeGh = await makeFakeGh({ secrets: ["PR_AGENT_MODEL_API_KEY"] });
  const { status, stdout, stderr } = runEntrypoint(INSTALLER, ["update", "--target", target, "--json"], {
    env: installerEnv(fakeGh),
    extraPath: [fakeGh.binDir],
  });
  assert.equal(status, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.command, "update");
  assert.equal(report.ok, true);
});

test("installer uninstall removes managed state with non-interactive --yes", async () => {
  const { target } = await freshInstall();
  const fakeGh = await makeFakeGh({ secrets: ["PR_AGENT_MODEL_API_KEY"] });
  const { status, stdout, stderr } = runEntrypoint(
    INSTALLER,
    ["uninstall", "--target", target, "--yes", "--json"],
    { env: installerEnv(fakeGh), extraPath: [fakeGh.binDir] },
  );
  assert.equal(status, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.command, "uninstall");
  assert.equal(report.ok, true);
  assert.equal(existsSync(path.join(target, MANIFEST)), false, "manifest should be removed");
});

test("installer refuses interactive --set-secret without a terminal and exits 1", async () => {
  const target = await makeGitTarget();
  const fakeGh = await makeFakeGh();
  const { status, stderr } = runEntrypoint(
    INSTALLER,
    ["install", "--target", target, "--set-secret"],
    { env: installerEnv(fakeGh), extraPath: [fakeGh.binDir] },
  );
  assert.equal(status, 1);
  assert.match(stderr, /--set-secret requires a terminal/u);
});

test("installer redacts the secret when a gh secret command fails", async () => {
  const target = await makeGitTarget();
  const secret = "super-secret-token-value";
  const fakeGh = await makeFakeGh({ failOn: ["secret", "set"] });
  const { status, stdout, stderr } = runEntrypoint(
    INSTALLER,
    ["install", "--target", target, "--secret-stdin", "--json"],
    { env: installerEnv(fakeGh), extraPath: [fakeGh.binDir], input: `${secret}\n` },
  );
  const combined = `${stdout}${stderr}`;
  assert.equal(status, 1);
  assert.doesNotMatch(combined, new RegExp(secret, "u"), "raw secret must never appear");
  assert.match(combined, /\[redacted\]/u);
});
