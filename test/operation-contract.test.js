import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OPERATIONS,
  operationNames,
  durableOperations,
  tokenRequiredOperations,
  getOperationContract,
  operationRequiresToken,
  contractInputNames,
  contractOutputNames,
  allowedInputsFor,
  unionPermissions,
} from "../src/operation-contract.js";

async function actionMetadata() {
  const url = new URL("../action.yml", import.meta.url);
  return readFile(url, "utf8");
}

// Minimal YAML section reader: collects the top-level keys nested under a
// given block header (`inputs:` / `outputs:`), which are two-space indented.
function yamlSectionKeys(source, header) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${header}:`);
  assert.notEqual(start, -1, `action.yml must declare ${header}`);
  const keys = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/u.test(line)) break; // next top-level block
    const match = /^ {2}([a-z0-9-]+):/u.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

test("operation set is the frozen canonical list", () => {
  assert.deepEqual(operationNames, ["standalone", "route", "acknowledge", "finalize", "query"]);
  assert.ok(Object.isFrozen(OPERATIONS));
  for (const op of OPERATIONS) {
    assert.ok(Object.isFrozen(op));
    assert.ok(Object.isFrozen(op.inputs));
    assert.ok(Object.isFrozen(op.outputs));
    assert.ok(Object.isFrozen(op.permissions));
  }
});

test("frozen contract rejects mutation, extension, and deletion", () => {
  const route = getOperationContract("route");
  assert.throws(() => {
    route.permissions.checks = "read";
  }, TypeError);
  assert.throws(() => {
    route.inputs.push("bogus");
  }, TypeError);
  assert.throws(() => {
    OPERATIONS.push({ name: "x" });
  }, TypeError);
});

test("durable and token-required derivations are correct", () => {
  assert.deepEqual(durableOperations, ["route", "acknowledge", "finalize", "query"]);
  assert.deepEqual(tokenRequiredOperations, ["route", "finalize", "query"]);
  assert.equal(operationRequiresToken("acknowledge"), false);
  assert.equal(operationRequiresToken("standalone"), false);
  assert.equal(operationRequiresToken("route"), true);
});

test("every contract input and output exists in action.yml", async () => {
  const source = await actionMetadata();
  const metadataInputs = new Set(yamlSectionKeys(source, "inputs"));
  const metadataOutputs = new Set(yamlSectionKeys(source, "outputs"));
  for (const name of contractInputNames()) {
    assert.ok(metadataInputs.has(name), `contract input ${name} missing from action.yml`);
  }
  for (const name of contractOutputNames()) {
    assert.ok(metadataOutputs.has(name), `contract output ${name} missing from action.yml`);
  }
});

test("contract input/output union equals action.yml (no dead fields)", async () => {
  const source = await actionMetadata();
  assert.deepEqual(
    [...new Set(yamlSectionKeys(source, "inputs"))].sort(),
    contractInputNames(),
    "action.yml inputs and contract input union must match exactly",
  );
  assert.deepEqual(
    [...new Set(yamlSectionKeys(source, "outputs"))].sort(),
    contractOutputNames(),
    "action.yml outputs and contract output union must match exactly",
  );
});

test("acknowledge tolerates the envelope, forbids other-operation inputs", () => {
  const allowed = allowedInputsFor("acknowledge");
  assert.ok(allowed.includes("github-token"), "github-token is a tolerated envelope input");
  assert.ok(allowed.includes("operation"));
  assert.ok(allowed.includes("adapter-request"));
  assert.ok(allowed.includes("adapter-outcome"));
  assert.ok(!allowed.includes("review-request"), "review-request is another operation's input");
});

test("no input is required by every operation (github-token cannot be globally required)", () => {
  // github-token is absent from acknowledge's required semantics and standalone
  // may skip it, so it must not be globally required in metadata.
  assert.ok(!operationRequiresToken("acknowledge"));
  assert.ok(!operationRequiresToken("standalone"));
});

test("permission union over supportedOperations matches the setup config", async () => {
  const url = new URL("../config/routed-review-setup-v1.json", import.meta.url);
  const config = JSON.parse(await readFile(url, "utf8"));
  for (const name of config.supportedOperations) {
    assert.ok(durableOperations.includes(name), `${name} must be a durable operation`);
  }
  assert.deepEqual(
    unionPermissions(config.supportedOperations),
    config.requiredPermissions,
    "config.requiredPermissions must equal the contract union over supportedOperations",
  );
});

test("getOperationContract rejects unknown operations", () => {
  assert.throws(() => getOperationContract("bogus"), /unknown operation/u);
});
