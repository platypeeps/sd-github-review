import { appendFile } from "node:fs/promises";
import {
  decodeAdapterRequest,
  decodeAdapterAcknowledgment,
  decodeBackend,
  decodeReviewRequest,
  stableProtocolJson,
} from "./protocol.js";
import { DEFAULT_STRANDED_RECEIPT_MINUTES, DURABLE_STATES, ReceiptStore } from "./receipt.js";
import { selectProtocolRoute } from "./router.js";
import { buildRiskContext } from "./risk-context.js";
import {
  LANDING_ABSENT,
  LANDING_UNVERIFIED,
  LANDING_DECLINED,
  requestCopilotReviewer,
} from "./reviewer-dispatch.js";
import { normalizeMode, parseList } from "./normalize.js";
import {
  operationNames,
  operationRequiresToken,
  forbiddenPayloadInputsFor,
} from "./operation-contract.js";

const OPERATION_NAME_SET = new Set(operationNames);
const ADAPTER_OUTCOMES = new Set(["success", "failure", "cancelled", "skipped"]);
const FAILED_OUTCOME_CODES = new Map([
  ["failure", "adapter-failed"],
  ["cancelled", "adapter-cancelled"],
  ["skipped", "adapter-skipped"],
]);
const MAX_JSON_INPUT_BYTES = 32 * 1024;
const MAX_ADAPTER_REQUEST_BYTES = 16 * 1024;

function input(name, fallback = "", env = process.env) {
  return env[`INPUT_${name.toUpperCase().replace(/ /gu, "_")}`] ?? fallback;
}

function booleanInput(name, fallback = false, env = process.env) {
  const value = input(name, String(fallback), env).trim().toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function integerInput(name, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}, env) {
  const raw = input(name, String(fallback), env);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function jsonInput(name, env, { required = true } = {}) {
  const raw = input(name, "", env);
  if (!raw.trim()) {
    if (!required) return null;
    throw new Error(`${name} is required for durable operations`);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_INPUT_BYTES) {
    throw new Error(`${name} exceeds the ${MAX_JSON_INPUT_BYTES}-byte input limit`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function liveHead(pullRequest) {
  const value = pullRequest?.head?.sha;
  if (typeof value !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(value)) {
    throw new Error("GitHub pull request response must include a full head SHA");
  }
  return value.toLowerCase();
}

function workflowUrl(env) {
  const explicit = input("workflow-url", "", env).trim();
  const value = explicit || (
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : ""
  );
  if (!value) return undefined;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("workflow-url must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("workflow-url must be a valid HTTPS URL");
  }
  if (url.username || url.password) {
    throw new Error("workflow-url must not include credentials");
  }
  return url.toString();
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value.toISOString();
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(normalized)) {
    throw new Error("operation timestamp must be an ISO-8601 UTC timestamp");
  }
  return normalized;
}

function copilotBackend(env) {
  const reviewer = input(
    "copilot-reviewer",
    "copilot-pull-request-reviewer[bot]",
    env,
  ).trim();
  return decodeBackend({
    id: "github-copilot",
    label: "GitHub Copilot",
    kind: "copilot",
    costTier: "medium",
    qualityTier: "advanced",
    capabilities: ["review", "inline-comments"],
    reviewAuthors: [reviewer],
    checkNames: [],
    findingChannels: ["review", "inline-comment"],
    supportsRerequest: true,
    limitations: ["GitHub-managed model selection"],
  });
}

function selectedBackend(route, env) {
  if (route === "none") return null;
  if (route === "copilot") return copilotBackend(env);
  const backend = decodeBackend(jsonInput(`${route}-backend`, env), `${route}-backend`);
  if (backend.kind !== "external") {
    throw new Error(`${route}-backend.kind must be external`);
  }
  return backend;
}

function adapterRequest(receipt) {
  const request = stableProtocolJson({
    schemaVersion: 1,
    requestType: "routed-review-dispatch",
    logicalDispatchId: receipt.logicalDispatchId,
    requestFingerprint: receipt.requestFingerprint,
    repository: receipt.repository,
    pullRequestNumber: receipt.pullRequestNumber,
    headSha: receipt.headSha,
    attempt: receipt.attempt,
    selectedRoute: receipt.selectedRoute,
    backend: receipt.backend,
    policyVersion: receipt.policyVersion,
    correlationIds: receipt.correlationIds,
  });
  if (Buffer.byteLength(request, "utf8") > MAX_ADAPTER_REQUEST_BYTES) {
    throw new Error(`adapter request exceeds the ${MAX_ADAPTER_REQUEST_BYTES}-byte limit`);
  }
  return request;
}

function elapsedMilliseconds(receipt, completedAt) {
  if (!receipt.dispatch.startedAt) return 0;
  return Math.max(0, Date.parse(completedAt) - Date.parse(receipt.dispatch.startedAt));
}

function resultOutputs({ operation, result, adapter = "", changedLines = 0, sensitiveCount = 0 }) {
  const receipt = result.receipt ?? null;
  const verifiedReceipt = result.receiptVerified === false ? null : receipt;
  const backend = receipt?.backend ?? null;
  return {
    operation,
    route: receipt?.selectedRoute ?? "",
    reason: receipt?.reason ?? "",
    model: backend?.model ?? "",
    "pull-request-number": receipt ? String(receipt.pullRequestNumber) : "",
    "changed-lines": String(changedLines),
    "sensitive-files": "[]",
    "sensitive-file-count": String(sensitiveCount),
    "run-external-reviewer": String(Boolean(adapter)),
    "copilot-requested": String(result.copilotRequested === true),
    receipt: verifiedReceipt ? stableProtocolJson(verifiedReceipt) : "",
    "receipt-verified": String(Boolean(verifiedReceipt)),
    "receipt-id": receipt?.receiptId ?? "",
    "logical-dispatch-id": receipt?.logicalDispatchId ?? "",
    "request-fingerprint": receipt?.requestFingerprint ?? "",
    "durable-state": durableState(result.state),
    "dispatch-status": verifiedReceipt?.dispatch.status ?? "",
    "dispatch-phase": verifiedReceipt?.dispatch.phase ?? "",
    "dispatch-allowed": String(result.dispatchAllowed === true),
    "reconciliation-required": String(result.reconciliationRequired === true),
    "reconciliation-error": result.error ? String(result.error).slice(0, 512) : "",
    backend: backend ? stableProtocolJson(backend) : "",
    "backend-id": backend?.id ?? "",
    "backend-kind": backend?.kind ?? "",
    "cost-tier": backend?.costTier ?? "",
    "quality-tier": backend?.qualityTier ?? "",
    "finding-channels": JSON.stringify(backend?.findingChannels ?? []),
    limitations: JSON.stringify(backend?.limitations ?? []),
    "workflow-url": verifiedReceipt?.dispatch.workflowUrl ?? "",
    "latency-ms": verifiedReceipt?.observations
      ? String(verifiedReceipt.observations.latencyMs)
      : "",
    "adapter-request": adapter,
  };
}

// Enforces DURABLE_STATES on the way out, which is what keeps that set honest
// rather than a list someone has to remember to update. Every routing test
// passes through here.
function durableState(state) {
  if (!DURABLE_STATES.has(state)) {
    throw new Error(
      `durable-state "${state}" is not a declared durable state; add it to DURABLE_STATES `
        + "and to the durable-state description in action.yml",
    );
  }
  return state;
}

async function emitDurableResult(
  details,
  { outputWriter, summaryWriter, logger },
) {
  const outputs = resultOutputs(details);
  for (const [name, value] of Object.entries(outputs)) {
    await outputWriter(name, value);
  }
  await summaryWriter({
    operation: details.operation,
    state: details.result.state,
    receipt: details.result.receiptVerified === false ? null : details.result.receipt ?? null,
    dispatchAllowed: details.result.dispatchAllowed === true,
    reconciliationRequired: details.result.reconciliationRequired === true,
    changedLines: details.changedLines ?? 0,
    sensitiveCount: details.sensitiveCount ?? 0,
  });
  const receipt = details.result.receipt;
  logger(
    receipt
      ? `Durable ${details.operation} ${details.result.state} for PR #${receipt.pullRequestNumber} at ${receipt.headSha}`
      : `Durable ${details.operation} ${details.result.state}`,
  );
  return { ...details.result, outputs };
}

export function normalizeOperation(value) {
  const operation = String(value ?? "standalone").trim().toLowerCase();
  if (!OPERATION_NAME_SET.has(operation)) {
    throw new Error(`operation must be one of: ${operationNames.join(", ")}`);
  }
  return operation;
}

export function buildAdapterAcknowledgment(adapterRequestValue, outcomeValue, acknowledgedAt) {
  const adapterRequest = decodeAdapterRequest(adapterRequestValue);
  const outcome = String(outcomeValue ?? "").trim().toLowerCase();
  if (!ADAPTER_OUTCOMES.has(outcome)) {
    throw new Error(
      "adapter-outcome must be one of: success, failure, cancelled, skipped",
    );
  }
  return decodeAdapterAcknowledgment({
    schemaVersion: 1,
    logicalDispatchId: adapterRequest.logicalDispatchId,
    backendId: adapterRequest.backend.id,
    status: outcome === "success" ? "acknowledged" : "failed",
    acknowledgedAt: timestamp(acknowledgedAt),
    findingChannels: adapterRequest.backend.findingChannels,
    ...(outcome === "success" ? {} : { errorCode: FAILED_OUTCOME_CODES.get(outcome) }),
  });
}

// A-010: acknowledge builds an adapter acknowledgment with no GitHub client and
// tolerates only its contract inputs (adapter-request, adapter-outcome, plus the
// operation/github-token envelope). A populated payload input belonging to
// another operation (e.g. review-request) signals a mis-wired step and is
// rejected. Only empty-default semantic payload inputs are checked so injected
// action.yml defaults cannot misfire.
function assertNoForbiddenAcknowledgeInputs(env) {
  for (const name of forbiddenPayloadInputsFor("acknowledge")) {
    if (input(name, "", env).trim()) {
      throw new Error(`acknowledge does not accept ${name}`);
    }
  }
}

async function runAcknowledgmentAction({ env, outputWriter, summaryWriter, logger, now }) {
  assertNoForbiddenAcknowledgeInputs(env);
  const acknowledgment = buildAdapterAcknowledgment(
    jsonInput("adapter-request", env),
    input("adapter-outcome", "", env),
    now,
  );
  const outputs = {
    operation: "acknowledge",
    "adapter-acknowledgment": stableProtocolJson(acknowledgment),
  };
  for (const [name, value] of Object.entries(outputs)) {
    await outputWriter(name, value);
  }
  await summaryWriter({
    operation: "acknowledge",
    state: acknowledgment.status,
    receipt: null,
    dispatchAllowed: false,
    reconciliationRequired: false,
    changedLines: 0,
    sensitiveCount: 0,
  });
  logger(
    `Built ${acknowledgment.status} adapter acknowledgment for ${acknowledgment.backendId}`,
  );
  return { acknowledgment, outputs };
}

export async function writeDurableSummary(
  { operation, state, receipt, dispatchAllowed, reconciliationRequired, changedLines, sensitiveCount },
  { env = process.env, appendFileImpl = appendFile } = {},
) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    "### Durable AI review",
    "",
    `- Operation: \`${operation}\``,
    `- State: \`${state}\``,
  ];
  if (receipt) {
    lines.push(
      `- Pull request: #${receipt.pullRequestNumber}`,
      `- Head: \`${receipt.headSha}\``,
      `- Route: \`${receipt.selectedRoute}\``,
      `- Reason: ${receipt.reason}`,
      `- Dispatch: \`${receipt.dispatch.status}/${receipt.dispatch.phase}\``,
      `- Backend: ${receipt.backend?.label ?? "none"}`,
      `- Finding channels: ${(receipt.backend?.findingChannels ?? []).join(", ") || "none"}`,
      `- Limitations: ${(receipt.backend?.limitations ?? []).join("; ") || "none"}`,
      `- Changed lines: ${changedLines}`,
      `- Sensitive file count: ${sensitiveCount}`,
    );
  }
  lines.push(
    `- Dispatch allowed: ${dispatchAllowed}`,
    `- Reconciliation required: ${reconciliationRequired}`,
    "",
  );
  await appendFileImpl(env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

function createStore({ client, now, receiptStoreFactory, env }) {
  return receiptStoreFactory
    ? receiptStoreFactory({ client, now, env })
    : new ReceiptStore({
        client,
        now,
        bookkeepingPatterns: parseList(
          input("bookkeeping-paths", ".trellis/**,.obsidian-kb/**", env),
        ),
        strandedAfterMinutes: integerInput(
          "stranded-receipt-minutes",
          DEFAULT_STRANDED_RECEIPT_MINUTES,
          { minimum: 1 },
          env,
        ),
      });
}

async function routeOperation({ request, client, store, env, now }) {
  const pullRequest = await client.getPullRequest(request.pullRequestNumber);
  if (liveHead(pullRequest) !== request.headSha) {
    throw new Error("live pull request head must match review-request.headSha");
  }
  const changedLines = Number(pullRequest.additions ?? 0) + Number(pullRequest.deletions ?? 0);
  const changedLineThreshold = integerInput(
    "changed-line-threshold",
    800,
    { minimum: 1 },
    env,
  );
  // A-014: files feed only sensitive-path matching, so skip the enumeration when
  // no sensitive pattern is configured (an empty policy yields no sensitive files
  // regardless of the file list).
  const sensitivePaths = parseList(input("sensitive-paths", "", env));
  const files = request.route === "auto" && sensitivePaths.length > 0
    ? await client.listPullRequestFiles(request.pullRequestNumber)
    : [];
  const successor = request.supersedes ? await store.compareSuccessor(request) : null;
  const risk = buildRiskContext({
    changedLines,
    changedLineThreshold,
    files,
    sensitivePaths,
    confidence: input("confidence", "unknown", env),
    lowConfidenceRoute: input("low-confidence-route", "deep", env),
    highRiskRoute: input("high-risk-route", "deep", env),
    draft: Boolean(pullRequest.draft),
    reviewDrafts: booleanInput("review-drafts", false, env),
  });
  const sensitiveFiles = risk.sensitiveFiles;
  const decision = selectProtocolRoute({
    request,
    routingContext: {
      ...risk,
      ...(successor ? { successorEvidence: successor.evidence } : {}),
    },
    policy: {
      allowBookkeepingNone: booleanInput("allow-bookkeeping-none", false, env),
      independentReviewFloor: normalizeMode(
        input("independent-review-floor", "none", env),
        "independent-review-floor",
      ),
      // Raw on purpose: the default is "" (no recorded policy), and
      // normalizeMode would reject that on every dispatch from a consumer
      // below manifest schema 4. decodeRoutingInputs maps "" to "no policy"
      // and validates every other value.
      routePolicy: input("route-policy", "", env),
      localConfidenceThreshold: integerInput(
        "local-confidence-threshold",
        80,
        { maximum: 100 },
        env,
      ),
      localEvidenceRoute: normalizeMode(
        input("local-evidence-route", "cheap", env),
        "local-evidence-route",
      ),
    },
  });
  const backend = selectedBackend(decision.route, env);
  let result = await store.begin(request, {
    decision,
    backend,
    workflowUrl: workflowUrl(env),
    ...(successor ? { successorEvidence: successor.evidence } : {}),
    rerequestAuthorized: booleanInput("rerequest-authorized", false, env),
  });
  let adapter = "";
  if (result.dispatchAllowed && backend?.kind === "external") {
    adapter = adapterRequest(result.receipt);
  } else if (result.dispatchAllowed && backend?.kind === "copilot") {
    let dispatch = null;
    try {
      dispatch = await requestCopilotReviewer({
        client,
        pullRequestNumber: request.pullRequestNumber,
        reviewer: backend.reviewAuthors[0],
        headSha: request.headSha,
        forceRerequest:
          Boolean(request.rerequestOf) && booleanInput("rerequest-authorized", false, env),
        // begin() authorized this dispatch: for a first attempt that means
        // no receipt records prior dispatched work at this head, so any
        // reviewer request found pending now was not made by this action at
        // this head (issue #158); an authorized later attempt forces the
        // re-request regardless. The service removes and re-requests it
        // rather than read it as coverage.
        rerequestPending: true,
      });
    } catch (error) {
      // A throw does not prove GitHub received nothing -- the POST may well
      // have been accepted before the connection died. It proves we cannot
      // claim it landed, and an unverifiable dispatch must not read as
      // satisfied. `failed` states that this dispatch did not verifiably
      // complete and routes it to a human, rather than asserting anything
      // about the outside world we did not observe.
      result = await failDispatch({
        store,
        request,
        env,
        now,
        receipt: result.receipt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // A POST that added nobody, or one whose outcome could not be read, is a
    // failed dispatch -- not a satisfied receipt. Recording it as `observed`
    // is what let PR #156 claim a review request that never landed and then
    // block every retry behind its own false claim. Fail closed instead; the
    // receipt store deliberately routes a failed dispatch to a human
    // (see receipt.js:200-204), so this escalates rather than self-heals.
    if (dispatch && dispatch.landing === LANDING_DECLINED) {
      // GitHub parsed the request and refused it for this pull request. Same
      // gate as a failure, but the receipt says which refusal it was, so the
      // next reader does not mistake a reviewer that will never accept this
      // head for a network error worth retrying.
      result = await declineDispatch({
        store,
        request,
        env,
        now,
        receipt: result.receipt,
        reason: dispatch.declined.message,
        message:
          `reviewer request for ${backend.reviewAuthors[0]} was declined by GitHub `
          + `(HTTP ${dispatch.declined.status}): ${dispatch.declined.message}`,
      });
    } else if (dispatch && (dispatch.landing === LANDING_ABSENT || dispatch.landing === LANDING_UNVERIFIED)) {
      result = await failDispatch({
        store,
        request,
        env,
        now,
        receipt: result.receipt,
        message:
          dispatch.landing === LANDING_ABSENT
            ? `requested reviewer ${backend.reviewAuthors[0]} was absent after the request was accepted`
            : `could not verify whether requested reviewer ${backend.reviewAuthors[0]} was added`,
      });
    } else if (dispatch) {
      // Observation is a separate failure domain and must not share the
      // dispatch's catch. The request landed here; if only the receipt advance
      // fails, writing `failed` would record a review that was requested as one
      // that never was. Reconcile in memory and leave the dispatch record
      // alone.
      try {
        const completedAt = timestamp(now);
        result = await store.observe({
          pullRequestNumber: request.pullRequestNumber,
          headSha: request.headSha,
          logicalDispatchId: request.logicalDispatchId,
          alreadyPresent: !dispatch.requested,
          observations: {
            latencyMs: elapsedMilliseconds(result.receipt, completedAt),
            costTier: backend.costTier,
          },
          workflowUrl: workflowUrl(env),
          completedAt,
        });
        result.copilotRequested = dispatch.requested;
      } catch (error) {
        result = {
          state: "reconciliation-required",
          receipt: result.receipt,
          receiptVerified: true,
          dispatchAllowed: false,
          reconciliationRequired: true,
          copilotRequested: dispatch.requested,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return { result, adapter, changedLines, sensitiveCount: sensitiveFiles.length };
}

// Persist the failure; do not merely report it. Without the durable write the
// receipt stays `requested`/`started`, which receiptState reads as in-flight
// until `strandedAfterMinutes` elapses -- so a dead dispatch this run proved
// would read as possibly-running for the next six hours. If the persist itself
// fails there is nothing further to try: keep the state pinned to
// reconciliation-required and carry both errors, since both are true.
async function failDispatch({ store, request, env, now, receipt, message }) {
  let persisted = null;
  let persistError = null;
  try {
    persisted = await store.dispatchFailed({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: request.logicalDispatchId,
      workflowUrl: workflowUrl(env),
      completedAt: timestamp(now),
    });
  } catch (error) {
    persistError = error instanceof Error ? error.message : String(error);
  }
  return {
    state: "reconciliation-required",
    receipt: persisted?.receipt ?? receipt,
    // The store's own verdict, never a forced `true`. #updateRecord answers
    // `receiptVerified: false` when updateCheckRun or the re-read fails, and a
    // throw means nothing was written at all -- in both cases the receipt we
    // hand back is not durable evidence of this failure. Asserting it were
    // would emit an unpersisted receipt as durable, which is the same false
    // claim about the outside world this whole path exists to stop. The
    // success return omits the key, and every consumer tests `=== false`, so
    // undefined still reads as verified.
    receiptVerified: persisted ? persisted.receiptVerified : false,
    dispatchAllowed: false,
    reconciliationRequired: true,
    copilotRequested: false,
    error: [message, persisted?.error, persistError].filter(Boolean).join("; "),
  };
}

// Sibling of failDispatch for the backend's own refusal. Same persistence
// posture, same fail-closed result shape; the recorded state and the error
// text name the decline.
async function declineDispatch({ store, request, env, now, receipt, reason, message }) {
  let persisted = null;
  let persistError = null;
  try {
    persisted = await store.dispatchDeclined({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: request.logicalDispatchId,
      workflowUrl: workflowUrl(env),
      completedAt: timestamp(now),
      reason,
    });
  } catch (error) {
    persistError = error instanceof Error ? error.message : String(error);
  }
  return {
    state: "reconciliation-required",
    receipt: persisted?.receipt ?? receipt,
    receiptVerified: persisted ? persisted.receiptVerified : false,
    dispatchAllowed: false,
    reconciliationRequired: true,
    copilotRequested: false,
    error: [message, persisted?.error, persistError].filter(Boolean).join("; "),
  };
}

async function finalizeOperation({ request, store, env, now }) {
  const acknowledgment = decodeAdapterAcknowledgment(
    jsonInput("adapter-acknowledgment", env),
  );
  const finalizedAt = timestamp(now);
  if (Date.parse(acknowledgment.acknowledgedAt) > Date.parse(finalizedAt)) {
    throw new Error("adapter-acknowledgment.acknowledgedAt must not be after finalization time");
  }
  let result = await store.acknowledge({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: request.logicalDispatchId,
    acknowledgment,
  });
  if (!result.reconciliationRequired && acknowledgment.status === "acknowledged") {
    if (result.receipt.dispatch.phase !== "observed") {
      result = await store.observe({
        pullRequestNumber: request.pullRequestNumber,
        headSha: request.headSha,
        logicalDispatchId: request.logicalDispatchId,
        observations: {
          latencyMs: elapsedMilliseconds(result.receipt, acknowledgment.acknowledgedAt),
          costTier: result.receipt.backend.costTier,
        },
        workflowUrl: workflowUrl(env),
        completedAt: finalizedAt,
      });
    }
  }
  return { result, adapter: "", changedLines: 0, sensitiveCount: 0 };
}

async function queryOperation({ request, store }) {
  const receipt = await store.query({
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    logicalDispatchId: request.logicalDispatchId,
    correlationId: request.correlationId,
  });
  return {
    result: receipt
      ? {
          state: receipt.dispatch.phase === "started"
            ? "reconciliation-required"
            : receipt.dispatch.status === "failed"
              ? "failed"
              : receipt.dispatch.status === "skipped"
                ? "skipped"
                : receipt.dispatch.phase === "acknowledged"
                  ? "acknowledged"
                  : "observed",
          receipt,
          dispatchAllowed: false,
          reconciliationRequired: receipt.dispatch.phase === "started",
        }
      : {
          state: "not-found",
          receipt: null,
          dispatchAllowed: false,
          reconciliationRequired: false,
        },
    adapter: "",
    changedLines: 0,
    sensitiveCount: 0,
  };
}

export async function runDurableAction({
  operation,
  env = process.env,
  clientFactory,
  outputWriter,
  summaryWriter = (summary) => writeDurableSummary(summary, { env }),
  logger = (message) => console.log(message),
  now = () => new Date().toISOString(),
  receiptStoreFactory,
}) {
  const normalizedOperation = normalizeOperation(operation);
  if (normalizedOperation === "standalone") {
    throw new Error("runDurableAction requires route, acknowledge, finalize, or query");
  }
  if (normalizedOperation === "acknowledge") {
    return runAcknowledgmentAction({ env, outputWriter, summaryWriter, logger, now });
  }
  const request = decodeReviewRequest(jsonInput("review-request", env));
  // A-010: route/finalize/query construct a client eagerly, so github-token is
  // required at runtime (it is no longer globally required in action.yml). Fail
  // with a bounded explicit error instead of an opaque downstream client error.
  const token = input("github-token", "", env);
  if (operationRequiresToken(normalizedOperation) && !token.trim()) {
    throw new Error(`operation "${normalizedOperation}" requires github-token`);
  }
  const client = clientFactory({
    token,
    repository: env.GITHUB_REPOSITORY,
    apiUrl: env.GITHUB_API_URL,
  });
  const store = createStore({ client, now, receiptStoreFactory, env });
  const context = { request, client, store, env, now };
  const details = normalizedOperation === "route"
    ? await routeOperation(context)
    : normalizedOperation === "finalize"
      ? await finalizeOperation(context)
      : await queryOperation(context);
  const emitted = await emitDurableResult(
    { operation: normalizedOperation, ...details },
    { outputWriter, summaryWriter, logger },
  );

  // The gate lives here rather than in the shipped lanes for two reasons. The
  // canonical durable workflow is required to contain no `run:` step at all
  // (it holds checks:write), so it has nowhere to put a shell gate; and a gate
  // written into YAML is one a consumer can quietly drop while still believing
  // the lane is enforcing it. Emitting first means the outputs and the job
  // summary are already written when the step goes red.
  //
  // Only `route` fails. A `query` exists to report the durable state and must
  // stay usable for exactly that, and `finalize` failing here would mask the
  // reconciliation it was invoked to record.
  // A concurrent begin that lost the election is exempt. Its evidence names the
  // authoritative check run, which means another dispatch is reviewing this
  // exact head right now -- failing the loser would put a red mark on a pull
  // request that is in fact being reviewed, which is the false alarm that gets
  // a gate switched off. Everything else reaching here means no review is
  // happening at this head and nothing else will say so.
  const handledElsewhere = Number.isInteger(emitted.reconciliation?.authoritativeCheckId);
  if (
    normalizedOperation === "route"
    && emitted.reconciliationRequired === true
    && !handledElsewhere
    && booleanInput("fail-on-reconciliation", true, env)
  ) {
    const receipt = emitted.receipt;
    throw new Error(
      "this exact head has a durable receipt that needs reconciliation, so no review was dispatched.\n"
        + `  durable-state:       ${emitted.state}\n`
        + `  receipt-id:          ${receipt?.receiptId ?? "(none)"}\n`
        + `  logical-dispatch-id: ${receipt?.logicalDispatchId ?? "(none)"}\n`
        + `  dispatch-phase:      ${receipt?.dispatch?.phase ?? "(none)"}\n`
        + (emitted.error ? `  detail:              ${String(emitted.error).slice(0, 512)}\n` : "")
        + "Set fail-on-reconciliation: false to report this on the outputs without failing the job.",
    );
  }
  return emitted;
}
