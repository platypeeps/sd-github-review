// Authoritative operation contract (A-010).
//
// One source of truth for the Action's operation set and, per operation, the
// inputs it reads, the outputs it may emit, whether it constructs a GitHub
// client/token, and the GITHUB_TOKEN permissions it needs. Runtime decoding
// (src/operations.js, src/index.js), metadata validation
// (scripts/validate-action-metadata.mjs), and tests all read this module so
// metadata, runtime, permissions, and docs cannot drift independently.
//
// The runtime decoders remain the trust boundary: they still parse and reject
// caller data. This module only declares the shapes they enforce.

// GITHUB_TOKEN permission levels, ordered so a granted level satisfies a
// required level when granted >= required.
export const PERMISSION_LEVELS = Object.freeze({ none: 0, read: 1, write: 2 });

// Per operation:
// - needsClient: "no" | "lazy" | "yes" — whether a GitHub client is built.
//   "yes" operations require github-token at runtime; "lazy"/"no" do not.
// - inputs: every action.yml input the operation reads. `operation` and
//   `github-token` are the universal envelope and appear on every operation
//   that tolerates them.
// - outputs: every action.yml output the operation may emit.
// - permissions: the GITHUB_TOKEN scopes the operation's own API calls need,
//   grounded in the client methods it invokes.
const OPERATION_LIST = [
  {
    name: "standalone",
    requiredInputs: [],
    needsClient: "lazy",
    inputs: [
      "operation",
      "github-token",
      "mode",
      "pr-number",
      "trusted-associations",
      "allow-pr-author-commands",
      "review-drafts",
      "changed-line-threshold",
      "sensitive-paths",
      "confidence",
      "low-confidence-route",
      "high-risk-route",
      "request-copilot",
      "copilot-reviewer",
      "cheap-model",
      "deep-model",
    ],
    outputs: [
      "operation",
      "route",
      "reason",
      "model",
      "pull-request-number",
      "changed-lines",
      "sensitive-files",
      "run-external-reviewer",
      "copilot-requested",
    ],
    // contents:read reads the PR/files; pull-requests:write is needed only when
    // Copilot is requested, so it is documented but not a base requirement.
    permissions: { contents: "read" },
  },
  {
    name: "route",
    requiredInputs: ["review-request", "github-token"],
    needsClient: "yes",
    inputs: [
      "operation",
      "github-token",
      "review-request",
      "changed-line-threshold",
      "sensitive-paths",
      "confidence",
      "low-confidence-route",
      "high-risk-route",
      "review-drafts",
      "allow-bookkeeping-none",
      "independent-review-floor",
      "local-confidence-threshold",
      "local-evidence-route",
      "rerequest-authorized",
      "copilot-reviewer",
      "cheap-backend",
      "deep-backend",
      "workflow-url",
      "bookkeeping-paths",
    ],
    outputs: DURABLE_OUTPUTS(),
    permissions: { contents: "read", "pull-requests": "write", checks: "write" },
  },
  {
    name: "acknowledge",
    requiredInputs: ["adapter-request", "adapter-outcome"],
    needsClient: "no",
    // Reads only adapter-request + adapter-outcome. The envelope inputs
    // operation + github-token are tolerated (the shipped finalize job passes
    // github-token) but unused. Every other action.yml input is forbidden.
    inputs: ["operation", "github-token", "adapter-request", "adapter-outcome"],
    outputs: ["operation", "adapter-acknowledgment"],
    permissions: {},
  },
  {
    name: "finalize",
    requiredInputs: ["review-request", "adapter-acknowledgment", "github-token"],
    needsClient: "yes",
    inputs: [
      "operation",
      "github-token",
      "review-request",
      "adapter-acknowledgment",
      "workflow-url",
      "bookkeeping-paths",
    ],
    outputs: DURABLE_OUTPUTS(),
    permissions: { contents: "read", checks: "write" },
  },
  {
    name: "query",
    requiredInputs: ["review-request", "github-token"],
    needsClient: "yes",
    inputs: [
      "operation",
      "github-token",
      "review-request",
      "bookkeeping-paths",
    ],
    outputs: DURABLE_OUTPUTS(),
    // query only reads durable Check Runs.
    permissions: { contents: "read", checks: "read" },
  },
];

// The flat output set emitted by resultOutputs() in src/operations.js for the
// durable route/finalize/query operations (a fixed superset, empty-valued for
// fields an individual result does not populate).
function DURABLE_OUTPUTS() {
  return [
    "operation",
    "route",
    "reason",
    "model",
    "pull-request-number",
    "changed-lines",
    "sensitive-files",
    "sensitive-file-count",
    "run-external-reviewer",
    "copilot-requested",
    "receipt",
    "receipt-verified",
    "receipt-id",
    "logical-dispatch-id",
    "request-fingerprint",
    "durable-state",
    "dispatch-status",
    "dispatch-phase",
    "dispatch-allowed",
    "reconciliation-required",
    "reconciliation-error",
    "backend",
    "backend-id",
    "backend-kind",
    "cost-tier",
    "quality-tier",
    "finding-channels",
    "limitations",
    "workflow-url",
    "latency-ms",
    "adapter-request",
  ];
}

function freezeOperation(operation) {
  return Object.freeze({
    ...operation,
    requiredInputs: Object.freeze([...operation.requiredInputs]),
    inputs: Object.freeze([...operation.inputs]),
    outputs: Object.freeze([...operation.outputs]),
    permissions: Object.freeze({ ...operation.permissions }),
  });
}

const OPERATIONS_BY_NAME = Object.freeze(
  Object.fromEntries(OPERATION_LIST.map((op) => [op.name, freezeOperation(op)])),
);

export const OPERATIONS = Object.freeze(Object.values(OPERATIONS_BY_NAME));

// Canonical operation set; drives normalizeOperation.
export const operationNames = Object.freeze(OPERATION_LIST.map((op) => op.name));

// Operations dispatched through runDurableAction (everything but standalone).
export const durableOperations = Object.freeze(
  operationNames.filter((name) => name !== "standalone"),
);

// Operations that construct a client eagerly and therefore require github-token
// at runtime.
export const tokenRequiredOperations = Object.freeze(
  OPERATION_LIST.filter((op) => op.needsClient === "yes").map((op) => op.name),
);

export function getOperationContract(name) {
  const contract = OPERATIONS_BY_NAME[name];
  if (!contract) throw new Error(`unknown operation: ${name}`);
  return contract;
}

export function operationRequiresToken(name) {
  return tokenRequiredOperations.includes(name);
}

// Inputs required by EVERY operation — the only inputs that may be declared
// globally `required: true` in action.yml. The standalone default operation
// requires none, so this is empty: no input can be globally required (the
// github-token drift catch).
export function globallyRequiredInputs() {
  return operationNames
    .map((name) => new Set(getOperationContract(name).requiredInputs))
    .reduce((acc, set) => acc.filter((name) => set.has(name)), contractInputNames());
}

// Union of every input any operation reads.
export function contractInputNames() {
  return [...new Set(OPERATION_LIST.flatMap((op) => op.inputs))].sort();
}

// Union of every output any operation may emit.
export function contractOutputNames() {
  return [...new Set(OPERATION_LIST.flatMap((op) => op.outputs))].sort();
}

// Inputs an operation tolerates (required or optional). Any action.yml input
// outside this set is forbidden for that operation.
export function allowedInputsFor(name) {
  return getOperationContract(name).inputs;
}

// Semantic payload inputs (canonical JSON / URL carriers) that all declare an
// empty-string default in action.yml, so a non-empty runtime value is always a
// caller override rather than an injected default. This is the only class the
// forbidden-input check can act on without misfiring on GitHub Actions' default
// injection (scalar config inputs like `mode`/`sensitive-paths` arrive at their
// defaults in every job and cannot be distinguished from caller-set values).
export const SEMANTIC_PAYLOAD_INPUTS = Object.freeze([
  "review-request",
  "adapter-request",
  "adapter-acknowledgment",
  "cheap-backend",
  "deep-backend",
  "workflow-url",
]);

// Semantic payload inputs an operation must reject when present: another
// operation's payload wired into this operation's step.
export function forbiddenPayloadInputsFor(name) {
  const allowed = new Set(allowedInputsFor(name));
  return SEMANTIC_PAYLOAD_INPUTS.filter((input) => !allowed.has(input));
}

// Merge permission maps taking the strongest level per scope.
export function unionPermissions(names) {
  const merged = {};
  for (const name of names) {
    for (const [scope, level] of Object.entries(getOperationContract(name).permissions)) {
      if (!(scope in merged) || PERMISSION_LEVELS[level] > PERMISSION_LEVELS[merged[scope]]) {
        merged[scope] = level;
      }
    }
  }
  return merged;
}
