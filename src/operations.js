import { appendFile } from "node:fs/promises";
import {
  decodeAdapterAcknowledgment,
  decodeBackend,
  decodeReviewRequest,
  selectProtocolRoute,
  stableProtocolJson,
} from "./protocol.js";
import { ReceiptStore } from "./receipt.js";
import { findSensitiveFiles, normalizeConfidence, normalizeMode, parseList } from "./router.js";

const OPERATIONS = new Set(["route", "finalize", "query"]);
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
  if (explicit) return explicit;
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) return undefined;
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
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
    "durable-state": result.state,
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
  if (operation === "standalone") return operation;
  if (!OPERATIONS.has(operation)) {
    throw new Error("operation must be one of: standalone, route, finalize, query");
  }
  return operation;
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
  const files = request.route === "auto"
    ? await client.listPullRequestFiles(request.pullRequestNumber)
    : [];
  const sensitiveFiles = findSensitiveFiles(
    files,
    parseList(input("sensitive-paths", "", env)),
  );
  const successor = request.supersedes ? await store.compareSuccessor(request) : null;
  const lowConfidenceRoute = normalizeMode(
    input("low-confidence-route", "deep", env),
    "low-confidence-route",
  );
  if (!new Set(["deep", "copilot"]).has(lowConfidenceRoute)) {
    throw new Error("low-confidence-route must be deep or copilot");
  }
  const decision = selectProtocolRoute({
    request,
    routingContext: {
      changedLines,
      changedLineThreshold,
      sensitiveFiles,
      confidence: normalizeConfidence(input("confidence", "unknown", env)),
      lowConfidenceRoute,
      draft: Boolean(pullRequest.draft),
      reviewDrafts: booleanInput("review-drafts", false, env),
      ...(successor ? { successorEvidence: successor.evidence } : {}),
    },
    policy: {
      allowBookkeepingNone: booleanInput("allow-bookkeeping-none", false, env),
      independentReviewFloor: normalizeMode(
        input("independent-review-floor", "none", env),
        "independent-review-floor",
      ),
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
    try {
      const reviewer = backend.reviewAuthors[0];
      const requested = await client.getRequestedReviewers(request.pullRequestNumber);
      const alreadyRequested = requested.users?.some((user) => user.login === reviewer);
      const alreadyReviewed = !alreadyRequested
        && (await client.listPullRequestReviews(request.pullRequestNumber)).some(
          (review) =>
            review.user?.login === reviewer
            && review.commit_id?.toLowerCase() === request.headSha
            && review.state !== "DISMISSED",
        );
      if (!alreadyRequested && !alreadyReviewed) {
        await client.requestReviewer(request.pullRequestNumber, reviewer);
      }
      const completedAt = timestamp(now);
      result = await store.observe({
        pullRequestNumber: request.pullRequestNumber,
        headSha: request.headSha,
        logicalDispatchId: request.logicalDispatchId,
        alreadyPresent: alreadyRequested || alreadyReviewed,
        observations: {
          latencyMs: elapsedMilliseconds(result.receipt, completedAt),
          costTier: backend.costTier,
        },
        workflowUrl: workflowUrl(env),
        completedAt,
      });
      result.copilotRequested = !alreadyRequested && !alreadyReviewed;
    } catch (error) {
      result = {
        state: "reconciliation-required",
        receipt: result.receipt,
        receiptVerified: true,
        dispatchAllowed: false,
        reconciliationRequired: true,
        copilotRequested: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { result, adapter, changedLines, sensitiveCount: sensitiveFiles.length };
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
    throw new Error("runDurableAction requires route, finalize, or query");
  }
  const request = decodeReviewRequest(jsonInput("review-request", env));
  const client = clientFactory({
    token: input("github-token", "", env),
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
  return emitDurableResult(
    { operation: normalizedOperation, ...details },
    { outputWriter, summaryWriter, logger },
  );
}
