import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import {
  parseReleaseTag,
  prohibitedPublishedMetadataReason,
  validateMetadata,
  validateReleaseConsistency,
} from "../scripts/validate-action-metadata.mjs";
import {
  contractInputNames,
  contractOutputNames,
} from "../src/operation-contract.js";

// action.yml covering the full operation contract (all inputs/outputs), so a
// fixture satisfies the A-010 contract cross-check and reaches the assertion
// the test actually targets.
function contractActionYaml() {
  const inputLines = contractInputNames().flatMap((name) => [
    `  ${name}:`,
    `    description: ${name}`,
    "    required: false",
  ]);
  const outputLines = contractOutputNames().flatMap((name) => [
    `  ${name}:`,
    `    description: ${name}`,
  ]);
  return [
    "name: Fixture",
    "description: Fixture action",
    "inputs:",
    ...inputLines,
    "outputs:",
    ...outputLines,
    "runs:",
    "  using: node24",
    "  main: index.js",
    "",
  ].join("\n");
}
import { SUPPORTED_PROVIDERS } from "../scripts/consumer-installer.mjs";

const execFileAsync = promisify(execFile);

async function writeMetadataFixture(root, actionReference, options = {}) {
  const {
    descriptorSha = "a".repeat(40),
    contractMajor = 1,
    version = "0.0.0",
    writeDescriptor = true,
    writePackage = true,
  } = options;
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(root, "examples"), { recursive: true });
  await writeFile(path.join(root, "index.js"), "", "utf8");
  if (writeDescriptor) {
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(
      path.join(root, "config", "routed-review-setup-v1.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          contractMajor,
          actionReference: `platypeeps/sd-github-review@${descriptorSha}`,
          supportedOperations: ["route", "finalize", "query"],
          requiredPermissions: {
            contents: "read",
            "pull-requests": "write",
            checks: "write",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  if (writePackage) {
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`,
      "utf8",
    );
  }
  await writeFile(path.join(root, "action.yml"), contractActionYaml(), "utf8");
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on:",
      "  push:",
      "permissions:",
      "  contents: read",
      "  pull-requests: write",
      "  checks: write",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${actionReference}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeExampleFixture(root, actionReference) {
  await writeFile(
    path.join(root, "examples", "fixture.yml"),
    [
      "name: Example",
      "on:",
      "  workflow_dispatch:",
      "permissions:",
      "  contents: read",
      "  pull-requests: write",
      "  checks: write",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${actionReference}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("validates the repository action metadata, pinned workflows, and examples", async () => {
  const result = await validateMetadata(path.resolve(import.meta.dirname, ".."));
  assert.equal(result.workflowCount, 1);
  assert.equal(result.exampleCount, 6);
  assert.ok(result.trackedPathCount > 0);
  assert.equal(result.contractMajor, 1);
});

test("publishes pinned standalone and durable PR-Agent workflows", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const loadWorkflow = async (name) => {
    const source = await readFile(path.join(root, "examples", name), "utf8");
    const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
    assert.deepEqual(document.errors, [], name);
    return { source, workflow: document.toJS() };
  };
  const standalone = await loadWorkflow("pr-agent-router.yml");
  const durable = await loadWorkflow("pr-agent-on-demand-review-router.yml");
  const genericStandalone = await loadWorkflow("review-router.yml");
  const pilot = await loadWorkflow("pilot-router.yml");
  const genericDurable = await loadWorkflow("on-demand-review-router.yml");
  const digestReference =
    "pragent/pr-agent@sha256:cae31b51b65b5c978a3b2a978d96e89e6a4c5bcd81cb2553fd8dad0251c3a23e";
  const providerMappings = [
    {
      provider: "openai",
      credential: "OPENAI__KEY",
      model: "configured-openai-model",
    },
    {
      provider: "gemini",
      credential: "GOOGLE_AI_STUDIO__GEMINI_API_KEY",
      model: "gemini/configured-model",
    },
    {
      provider: "openrouter",
      credential: "OPENROUTER__KEY",
      model: "openrouter/anthropic/configured-model",
    },
    {
      provider: "anthropic",
      credential: "ANTHROPIC__KEY",
      model: "anthropic/configured-model",
    },
    {
      provider: "cohere",
      credential: "COHERE__KEY",
      model: "cohere/configured-model",
    },
    {
      provider: "replicate",
      credential: "REPLICATE__KEY",
      model: "replicate/configured-model",
    },
    { provider: "groq", credential: "GROQ__KEY", model: "groq/configured-model" },
    {
      provider: "sambanova",
      credential: "SAMBANOVA__KEY",
      model: "sambanova/configured-model",
    },
    { provider: "xai", credential: "XAI__KEY", model: "xai/configured-model" },
    {
      provider: "deepseek",
      credential: "DEEPSEEK__KEY",
      model: "deepseek/configured-model",
    },
    {
      provider: "deepinfra",
      credential: "DEEPINFRA__KEY",
      model: "deepinfra/configured-model",
    },
    {
      provider: "mistral",
      credential: "MISTRAL__KEY",
      model: "mistral/configured-model",
    },
    {
      provider: "codestral",
      credential: "CODESTRAL__KEY",
      model: "codestral/configured-model",
    },
  ];
  assert.deepEqual(
    providerMappings.map(({ provider }) => provider).sort(),
    [...SUPPORTED_PROVIDERS].sort(),
  );

  assert.deepEqual(standalone.workflow.permissions, {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
  });
  // A-004: the third-party reviewer runs in an isolated job whose token has no
  // receipt authority. Workflow-level permissions are minimal; only the
  // receipt-writing jobs (review, finalize) hold checks:write, and the reviewer
  // job (pr-agent) holds neither checks:write nor issues:write.
  assert.deepEqual(durable.workflow.permissions, { contents: "read" });
  assert.deepEqual(durable.workflow.jobs.review.permissions, {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
    checks: "write",
  });
  assert.deepEqual(durable.workflow.jobs.finalize.permissions, {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
    checks: "write",
  });
  assert.deepEqual(durable.workflow.jobs["pr-agent"].permissions, {
    contents: "read",
    "pull-requests": "write",
  });
  assert.equal(durable.workflow.jobs["pr-agent"].permissions.checks, undefined);
  assert.equal(durable.workflow.jobs["pr-agent"].permissions.issues, undefined);

  for (const { source, workflow } of [standalone, durable]) {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
    const prAgent = steps.find((step) => step.name === "Run PR-Agent review");
    const preflight = steps.find((step) => step.id === "pr-agent-config");
    assert.equal(prAgent.uses, undefined);
    assert.match(prAgent.run, /docker run --rm/u);
    await assert.doesNotReject(execFileAsync("bash", ["-n", "-c", prAgent.run]));
    assert.ok(prAgent.run.includes(digestReference));
    assert.equal(
      /(?:^|\s)(?:-v|--volume|--mount|--volumes-from)(?:\s|=)/u.test(prAgent.run),
      false,
    );
    assert.equal(prAgent.run.includes("/github/workspace"), false);
    for (const { provider, credential } of providerMappings) {
      assert.equal(
        prAgent.env[credential],
        `\${{ vars.PR_AGENT_MODEL_PROVIDER == '${provider}' && secrets.PR_AGENT_MODEL_API_KEY || '' }}`,
      );
      assert.ok(prAgent.run.includes(`--env ${credential}`));
    }
    // The reviewer step reads route outputs from the same job (standalone) or
    // across jobs via needs (durable, where the reviewer is isolated).
    const crossJob = Boolean(workflow.jobs["pr-agent"]);
    const routeOut = crossJob ? "needs.review.outputs" : "steps.review.outputs";
    assert.equal(prAgent.env.CONFIG__MODEL, `\${{ ${routeOut}.model }}`);
    assert.equal(prAgent.env.CONFIG__FALLBACK_MODELS, "[]");
    assert.equal(prAgent.env.CONFIG__RESTRICTED_MODE, "true");
    assert.equal(
      prAgent.env.REVIEW_PULL_REQUEST_NUMBER,
      `\${{ ${routeOut}.pull-request-number }}`,
    );
    assert.match(prAgent.run, /--pr_url=.*REVIEW_PULL_REQUEST_NUMBER/u);
    assert.equal(
      preflight.env.REVIEW_MODEL_PROVIDER,
      "${{ vars.PR_AGENT_MODEL_PROVIDER }}",
    );
    assert.match(
      preflight.run,
      new RegExp(
        providerMappings
          .filter(({ provider }) => provider !== "openai")
          .map(({ provider }) => provider)
          .join("\\|"),
        "u",
      ),
    );
    assert.match(preflight.run, /REVIEW_MODEL_PREFIX="\$\{REVIEW_MODEL_PROVIDER\}\/"/u);
    assert.equal(
      steps
        .filter((step) => step !== prAgent)
        .some((step) => JSON.stringify(step).includes("PR_AGENT_MODEL_API_KEY")),
      false,
    );
    assert.equal(source.includes("PR_AGENT_OPENAI_KEY"), false);
    assert.equal(steps.some((step) => step.uses?.startsWith("actions/checkout@")), false);
    assert.equal(source.includes("pull_request_target"), false);
  }

  const runPreflight = ({ workflow, provider, model }) => {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
    const preflight = steps.find((step) => step.id === "pr-agent-config");
    return execFileAsync("bash", ["-c", preflight.run], {
      env: {
        REVIEW_BACKEND_ID: "pr-agent",
        REVIEW_MODEL_PROVIDER: provider,
        REVIEW_MODEL: model,
      },
    });
  };
  for (const { workflow } of [standalone, durable]) {
    for (const { provider, model } of providerMappings) {
      await assert.doesNotReject(runPreflight({ workflow, provider, model }));
    }
    await assert.rejects(
      runPreflight({ workflow, provider: "unsupported", model: "configured-model" }),
      /PR_AGENT_MODEL_PROVIDER must select a supported single-key provider/u,
    );
    for (const { provider } of providerMappings.filter(
      ({ provider }) => provider !== "openai",
    )) {
      await assert.rejects(
        runPreflight({ workflow, provider, model: "configured-model" }),
        new RegExp(
          `The selected PR-Agent model must use the ${provider}/<model-id> format`,
          "u",
        ),
      );
    }
  }

  // Durable pr-agent workflow is split across jobs (review / pr-agent /
  // finalize) for A-004 isolation, so steps are gathered across all jobs.
  const durableSteps = Object.values(durable.workflow.jobs).flatMap((job) => job.steps ?? []);
  const genericDurableSteps = genericDurable.workflow.jobs.review.steps;
  const acknowledge = durableSteps.find((step) => step.id === "acknowledge");
  const finalize = durableSteps.find((step) => step.name === "Finalize the external receipt");
  const preflight = durableSteps.find((step) => step.id === "pr-agent-config");
  const durableRoute = durable.workflow.jobs.review.steps.find((step) => step.id === "review");
  const genericDurableRoute = genericDurableSteps.find((step) => step.id === "review");
  const standaloneRoute = standalone.workflow.jobs.route.steps.find((step) => step.id === "review");
  const genericStandaloneRoute = genericStandalone.workflow.jobs.route.steps.find(
    (step) => step.id === "review",
  );
  const pilotRoute = pilot.workflow.jobs.route.steps.find((step) => step.id === "review");
  assert.equal(standaloneRoute.with["high-risk-route"], "deep");
  assert.equal(durableRoute.with["high-risk-route"], "deep");
  assert.equal(genericStandaloneRoute.with["high-risk-route"], undefined);
  assert.equal(pilotRoute.with["high-risk-route"], undefined);
  assert.equal(genericDurableRoute.with["high-risk-route"], undefined);
  const durableInputs = durable.workflow.on.workflow_dispatch.inputs;
  const genericDurableInputs = genericDurable.workflow.on.workflow_dispatch.inputs;
  for (const control of ["rerequest-authorized", "independent-review-floor"]) {
    assert.deepEqual(durableInputs[control], genericDurableInputs[control]);
    assert.equal(durableRoute.with[control], `\${{ inputs.${control} }}`);
    assert.equal(genericDurableRoute.with[control], `\${{ inputs.${control} }}`);
  }
  assert.equal(durableInputs["rerequest-authorized"].type, "boolean");
  assert.equal(durableInputs["rerequest-authorized"].default, false);
  assert.equal(durableInputs["independent-review-floor"].type, "choice");
  assert.equal(durableInputs["independent-review-floor"].default, "none");
  assert.deepEqual(
    durableInputs["independent-review-floor"].options,
    ["none", "cheap", "deep", "copilot"],
  );
  assert.match(preflight.run, /REVIEW_BACKEND_ID.*pr-agent/su);
  assert.ok(preflight.run.includes('-z "$REVIEW_MODEL"'));
  assert.equal(acknowledge.with.operation, "acknowledge");
  assert.equal(
    acknowledge.with["adapter-outcome"],
    "${{ needs.pr-agent.result }}",
  );
  assert.equal(finalize.with["adapter-acknowledgment"], "${{ steps.acknowledge.outputs.adapter-acknowledgment }}");
  assert.equal(
    durableSteps
      .filter((step) => typeof step.run === "string")
      .some((step) => step.run.includes("inputs.review-request")),
    false,
  );
});

test("publishes consistent read-only setup discovery and a no-checkout durable workflow", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const descriptor = JSON.parse(
    await readFile(path.join(root, "config", "routed-review-setup-v1.json"), "utf8"),
  );
  const discovery = JSON.parse(
    await readFile(path.join(root, "fixtures", "setup", "v1", "discovery.json"), "utf8"),
  );
  const workflowSource = await readFile(
    path.join(root, "examples", "on-demand-review-router.yml"),
    "utf8",
  );
  const workflowDocument = parseDocument(workflowSource, { prettyErrors: true, uniqueKeys: true });
  assert.deepEqual(workflowDocument.errors, []);
  const workflow = workflowDocument.toJS();

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.contractMajor, 1);
  assert.deepEqual(descriptor.supportedIntents, ["auto", "cheap", "deep", "copilot", "none"]);
  assert.deepEqual(descriptor.supportedOperations, ["route", "finalize", "query"]);
  assert.equal(descriptor.durableReceipt.checkName, "sd-github-review/receipt");
  assert.equal(descriptor.workflow.name, workflow.name);
  assert.equal(descriptor.noninteractive, true);
  assert.equal(descriptor.checkoutRequired, false);
  assert.deepEqual(workflow.permissions, descriptor.requiredPermissions);
  assert.ok(workflow.on.workflow_dispatch.inputs["review-request"]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs["rerequest-authorized"].default,
    false,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs["independent-review-floor"].default,
    "none",
  );

  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const route = steps.find((step) => step.id === "review");
  assert.equal(
    route.with["rerequest-authorized"],
    "${{ inputs.rerequest-authorized }}",
  );
  assert.equal(
    route.with["independent-review-floor"],
    "${{ inputs.independent-review-floor }}",
  );
  assert.equal(steps.some((step) => step.uses?.startsWith("actions/checkout@")), false);
  assert.equal(steps.some((step) => typeof step.run === "string"), false);
  assert.equal(workflowSource.includes("AskUserQuestion"), false);
  assert.equal(workflowSource.includes("pull_request_target"), false);

  const classify = ({ declarationPresent, metadata }) => {
    if (!declarationPresent) return "absent";
    if (!metadata?.readable) return "unavailable";
    if (!metadata.workflowPresent || metadata.workflowState !== "active") return "invalid";
    if (metadata.contractMajor !== descriptor.contractMajor) return "incompatible";
    return "ready";
  };
  assert.deepEqual(
    discovery.cases.map((entry) => [entry.name, classify(entry)]),
    discovery.cases.map((entry) => [entry.name, entry.expectedState]),
  );
});

test("rejects local and session metadata paths while preserving shared project knowledge", () => {
  const prohibited = [
    ".env.local",
    ".trellis/.developer",
    ".trellis\\.developer",
    ".trellis/.runtime/session.json",
    ".trellis/.cache/context.json",
    ".trellis/worktrees/task",
    ".trellis/.template-hashes.json",
    ".trellis/.current-task",
    ".trellis/tasks/example/.plan-log",
    ".trellis/scripts/__pycache__/task.cpython-314.pyc",
    ".trellis/workspace/sdelmas/transcript.jsonl",
    ".agents/skills/example/cache/state.json",
    ".agents/session.local.json",
    ".codex/sessions/session.jsonl",
    ".gemini/hooks/debug.log",
    ".opencode/state/session.json",
    ".github/copilot/sessions/session.jsonl",
  ];
  for (const filePath of prohibited) {
    assert.ok(prohibitedPublishedMetadataReason(filePath), `${filePath} should be prohibited`);
  }

  const allowed = [
    ".env.example",
    ".trellis/workflow.md",
    ".trellis/tasks/07-22-example/prd.md",
    ".trellis/workspace/index.md",
    ".trellis/workspace/sdelmas/index.md",
    ".trellis/workspace/sdelmas/journal-1.md",
    ".trellis\\workspace\\sdelmas\\journal-1.md",
    ".agents/skills/sd-status/SKILL.md",
    ".codex/config.toml",
    ".github/copilot/hooks/session-start.py",
    ".opencode/lib/session-utils.js",
    ".gito/sd-ai-command-pack.env",
    ".sd-ai-command-pack/provenance.json",
  ];
  for (const filePath of allowed) {
    assert.equal(prohibitedPublishedMetadataReason(filePath), null, `${filePath} should be public`);
  }
});

test("rejects floating third-party Action references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-metadata-"));
  await writeMetadataFixture(root, "actions/checkout@v4");

  await assert.rejects(
    validateMetadata(root),
    /must pin third-party action actions\/checkout@v4 to a 40-character commit SHA/u,
  );
});

test("the nested OpenCode package declares no unlocked runtime dependency (A-016)", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../.opencode/package.json", import.meta.url), "utf8"),
  );
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(
    declared,
    [],
    "the .opencode runtime must not carry an unlocked nested dependency (no lockfile is committed)",
  );
});

const A010_VALID_PIN = `platypeeps/sd-github-review@${"a".repeat(40)}`;

test("rejects an action.yml input used by no operation (A-010)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-a010-extra-input-"));
  await writeMetadataFixture(root, A010_VALID_PIN);
  const drifted = `${contractActionYaml().replace(
    "outputs:",
    "  bogus-drift-input:\n    description: drift\n    required: false\noutputs:",
  )}`;
  await writeFile(path.join(root, "action.yml"), drifted, "utf8");
  await assert.rejects(
    validateMetadata(root),
    /inputs \[bogus-drift-input\] are used by no operation/u,
  );
});

test("rejects a globally-required github-token (A-010)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-a010-global-required-"));
  await writeMetadataFixture(root, A010_VALID_PIN);
  const drifted = contractActionYaml().replace(
    "  github-token:\n    description: github-token\n    required: false",
    "  github-token:\n    description: github-token\n    required: true",
  );
  await writeFile(path.join(root, "action.yml"), drifted, "utf8");
  await assert.rejects(
    validateMetadata(root),
    /input "github-token" is globally required but not every operation requires it/u,
  );
});

test("rejects a route job that under-grants contract permissions (A-010)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-a010-undergrant-"));
  await writeMetadataFixture(root, A010_VALID_PIN);
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on:",
      "  workflow_dispatch:",
      "permissions:",
      "  contents: read",
      "  pull-requests: write",
      "jobs:",
      "  route:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${A010_VALID_PIN}`,
      "        with:",
      "          operation: route",
      "",
    ].join("\n"),
    "utf8",
  );
  await assert.rejects(validateMetadata(root), /needing checks:write but grants checks:none/u);
});

test("rejects a non-empty default on a semantic payload input (A-010)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-a010-payload-default-"));
  await writeMetadataFixture(root, A010_VALID_PIN);
  const drifted = contractActionYaml().replace(
    "  cheap-backend:\n    description: cheap-backend\n    required: false",
    '  cheap-backend:\n    description: cheap-backend\n    required: false\n    default: "{}"',
  );
  await writeFile(path.join(root, "action.yml"), drifted, "utf8");
  await assert.rejects(
    validateMetadata(root),
    /semantic payload input "cheap-backend" must declare an empty default/u,
  );
});

test("rejects floating example Actions while allowing documented placeholders", async () => {
  const pinnedAction = "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c";
  const floatingRoot = await mkdtemp(path.join(os.tmpdir(), "sd-review-example-floating-"));
  await writeMetadataFixture(floatingRoot, pinnedAction);
  await writeExampleFixture(floatingRoot, "actions/checkout@v4");
  await assert.rejects(
    validateMetadata(floatingRoot),
    /must pin third-party action actions\/checkout@v4 to a 40-character commit SHA/u,
  );

  const placeholderRoot = await mkdtemp(
    path.join(os.tmpdir(), "sd-review-example-placeholder-"),
  );
  await writeMetadataFixture(placeholderRoot, pinnedAction);
  await writeExampleFixture(placeholderRoot, "your-org/review-action@<commit-sha>");
  await execFileAsync("git", ["init", "-q", placeholderRoot]);
  await execFileAsync("git", ["-C", placeholderRoot, "add", "."]);
  await assert.doesNotReject(validateMetadata(placeholderRoot));
});

test("rejects floating Docker references and accepts digest pins", async () => {
  const floatingRoot = await mkdtemp(path.join(os.tmpdir(), "sd-review-docker-floating-"));
  await writeMetadataFixture(floatingRoot, "docker://pragent/pr-agent:0.39.0");
  await assert.rejects(
    validateMetadata(floatingRoot),
    /must pin Docker image .* to a sha256 digest/u,
  );

  const pinnedRoot = await mkdtemp(path.join(os.tmpdir(), "sd-review-docker-pinned-"));
  await writeMetadataFixture(
    pinnedRoot,
    "docker://pragent/pr-agent@sha256:cae31b51b65b5c978a3b2a978d96e89e6a4c5bcd81cb2553fd8dad0251c3a23e",
  );
  await execFileAsync("git", ["init", "-q", pinnedRoot]);
  await execFileAsync("git", ["-C", pinnedRoot, "add", "."]);
  await assert.doesNotReject(validateMetadata(pinnedRoot));
});

async function initTracked(root) {
  await execFileAsync("git", ["init", "-q", root]);
  await execFileAsync("git", ["-C", root, "add", "-f", "."]);
}

test("rejects a first-party pin that disagrees with the descriptor actionReference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-firstparty-"));
  await writeMetadataFixture(root, `platypeeps/sd-github-review@${"b".repeat(40)}`, {
    descriptorSha: "c".repeat(40),
  });
  await assert.rejects(
    validateMetadata(root),
    /first-party references must be mutually consistent/u,
  );
});

test("rejects a missing setup descriptor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-nodescriptor-"));
  await writeMetadataFixture(root, "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c", {
    writeDescriptor: false,
  });
  await assert.rejects(validateMetadata(root), /setup descriptor is missing or invalid JSON/u);
});

test("rejects an unknown contract major", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-contract-"));
  await writeMetadataFixture(root, "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c", {
    contractMajor: 99,
  });
  await assert.rejects(validateMetadata(root), /contractMajor must be a known contract/u);
});

test("rejects a non-semver package version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-version-"));
  await writeMetadataFixture(root, "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c", {
    version: "not-semver",
  });
  await assert.rejects(validateMetadata(root), /version must be valid semver/u);
});

test("validateReleaseConsistency accepts a matching not-yet-existing tag and rejects drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-release-"));
  await writeMetadataFixture(root, "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c", {
    version: "0.2.0",
  });
  await initTracked(root);
  const absentTag = { tagExists: async () => false };

  const accepted = await validateReleaseConsistency({
    repositoryRoot: root,
    releaseTag: "v0.2.0",
    gitImpl: absentTag,
  });
  assert.equal(accepted.releaseChecked, true);
  assert.equal(accepted.releaseTag, "v0.2.0");

  await assert.rejects(
    validateReleaseConsistency({ repositoryRoot: root, releaseTag: "v0.3.0", gitImpl: absentTag }),
    /must equal v0\.2\.0 from package\.json/u,
  );

  await assert.rejects(
    validateReleaseConsistency({
      repositoryRoot: root,
      releaseTag: "v0.2.0",
      gitImpl: { tagExists: async () => true },
    }),
    /already exists; choose an unused version/u,
  );

  const consistencyOnly = await validateReleaseConsistency({ repositoryRoot: root });
  assert.equal(consistencyOnly.releaseChecked, false);
});

test("accepts a full semver version with both prerelease and build metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-semver-"));
  await writeMetadataFixture(root, "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c", {
    version: "1.2.3-alpha.1+build.5",
  });
  await initTracked(root);
  await assert.doesNotReject(validateMetadata(root));
  const accepted = await validateReleaseConsistency({
    repositoryRoot: root,
    releaseTag: "v1.2.3-alpha.1+build.5",
    gitImpl: { tagExists: async () => false },
  });
  assert.equal(accepted.releaseChecked, true);
});

test("parseReleaseTag rejects an explicitly-empty SD_RELEASE_TAG and reads valid sources", () => {
  assert.equal(parseReleaseTag([], {}), null);
  assert.equal(parseReleaseTag([], { SD_RELEASE_TAG: "v0.2.0" }), "v0.2.0");
  assert.equal(parseReleaseTag(["--release-tag", "v0.2.0"], {}), "v0.2.0");
  assert.throws(() => parseReleaseTag([], { SD_RELEASE_TAG: "" }), /set but empty/u);
  assert.throws(() => parseReleaseTag(["--release-tag"], {}), /requires a v<semver> value/u);
});

test("rejects a prohibited path even when it is force-added to Git", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sd-review-public-metadata-"));
  await writeMetadataFixture(
    root,
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f544fe5000c",
  );
  await mkdir(path.join(root, ".trellis"), { recursive: true });
  await writeFile(path.join(root, ".trellis", ".developer"), "fixture-user\n", "utf8");
  await execFileAsync("git", ["init", "-q", root]);
  await execFileAsync("git", ["-C", root, "add", "-f", "."]);

  await assert.rejects(
    validateMetadata(root),
    /prohibited local\/session metadata is tracked:[\s\S]*\.trellis\/\.developer/u,
  );
});
