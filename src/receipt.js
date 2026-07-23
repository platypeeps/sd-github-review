import { createHash } from "node:crypto";
import {
  decodeAdapterAcknowledgment,
  decodeReceipt,
  decodeReviewRequest,
  decodeSuccessorEvidence,
  stableProtocolJson,
} from "./protocol.js";
import { globToRegExp } from "./router.js";

export const RECEIPT_CHECK_NAME = "sd-github-review/receipt";
export const RECEIPT_MARKER = "<!-- sd-github-review-receipt:v1 -->\n";

const MAX_RECEIPT_TEXT_BYTES = 32 * 1024 + 256;
const DEFAULT_MAX_COMPARE_FILES = 3_000;
const COMPARE_STATUSES = new Set(["ahead", "behind", "diverged", "identical"]);
const FILE_STATUSES = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function isoTimestamp(value, field) {
  const timestamp = typeof value === "function" ? value() : value;
  const normalized = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(normalized)) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp`);
  }
  return normalized;
}

function headFromPullRequest(pullRequest) {
  const head = pullRequest?.head?.sha;
  if (typeof head !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(head)) {
    throw new Error("GitHub pull request response must include a full head SHA");
  }
  return head.toLowerCase();
}

function completedReceipt(receipt) {
  return receipt.dispatch.status === "skipped"
    || receipt.dispatch.status === "failed"
    || receipt.dispatch.phase === "observed";
}

function checkConclusion(receipt) {
  if (receipt.dispatch.status === "failed") return "failure";
  if (receipt.dispatch.status === "skipped") return "neutral";
  return "success";
}

export function encodeReceiptCheckText(value) {
  const receipt = decodeReceipt(value);
  const text = `${RECEIPT_MARKER}${stableProtocolJson(receipt)}`;
  if (Buffer.byteLength(text, "utf8") > MAX_RECEIPT_TEXT_BYTES) {
    throw new Error(`receipt check text exceeds the ${MAX_RECEIPT_TEXT_BYTES}-byte limit`);
  }
  return text;
}

export function decodeReceiptCheckRun(check, expected = {}) {
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new Error("receipt check must be an object");
  }
  if (check.name !== RECEIPT_CHECK_NAME) {
    throw new Error(`receipt check name must be ${RECEIPT_CHECK_NAME}`);
  }
  if (!Number.isInteger(check.id) || check.id < 1) {
    throw new Error("receipt check id must be a positive integer");
  }
  const headSha = lower(check.head_sha);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(headSha)) {
    throw new Error("receipt check head_sha must be a full SHA");
  }
  if (expected.headSha && headSha !== lower(expected.headSha)) {
    throw new Error("receipt check head_sha must match the queried head");
  }
  const text = check.output?.text;
  if (typeof text !== "string" || !text.startsWith(RECEIPT_MARKER)) {
    throw new Error("receipt check output must contain the v1 machine marker");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_RECEIPT_TEXT_BYTES) {
    throw new Error(`receipt check output exceeds the ${MAX_RECEIPT_TEXT_BYTES}-byte limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(RECEIPT_MARKER.length));
  } catch {
    throw new Error("receipt check output must contain valid JSON");
  }
  const receipt = decodeReceipt(parsed);
  if (text !== encodeReceiptCheckText(receipt)) {
    throw new Error("receipt check output must contain canonical receipt JSON");
  }
  if (lower(check.external_id) !== receipt.logicalDispatchId) {
    throw new Error("receipt check external_id must match receipt.logicalDispatchId");
  }
  if (receipt.headSha !== headSha) {
    throw new Error("receipt check head_sha must match receipt.headSha");
  }
  if (expected.pullRequestNumber && receipt.pullRequestNumber !== expected.pullRequestNumber) {
    throw new Error("receipt pullRequestNumber must match the queried pull request");
  }
  if (
    expected.repository
    && (
      receipt.repository.owner !== lower(expected.repository.owner)
      || receipt.repository.name !== lower(expected.repository.name)
    )
  ) {
    throw new Error("receipt repository must match the queried repository");
  }
  return { checkId: check.id, receipt };
}

function checkRunPayload(receipt, { update = false } = {}) {
  const complete = completedReceipt(receipt);
  const payload = {
    ...(!update ? {
      name: RECEIPT_CHECK_NAME,
      head_sha: receipt.headSha,
    } : {}),
    external_id: receipt.logicalDispatchId,
    status: complete ? "completed" : "in_progress",
    output: {
      title: "Routed review receipt",
      summary: `Durable routed-review receipt for PR #${receipt.pullRequestNumber}.`,
      text: encodeReceiptCheckText(receipt),
    },
  };
  if (receipt.dispatch.workflowUrl) payload.details_url = receipt.dispatch.workflowUrl;
  if (receipt.dispatch.startedAt) payload.started_at = receipt.dispatch.startedAt;
  if (complete) {
    payload.conclusion = checkConclusion(receipt);
    payload.completed_at = receipt.dispatch.completedAt;
  }
  return payload;
}

function receiptState(receipt) {
  if (receipt.dispatch.status === "failed" && receipt.dispatch.phase === "started") {
    return "reconciliation-required";
  }
  if (receipt.dispatch.phase === "started") return "reconciliation-required";
  if (receipt.dispatch.phase === "acknowledged") {
    return receipt.dispatch.status === "failed" ? "failed" : "acknowledged";
  }
  if (receipt.dispatch.status === "skipped") return "skipped";
  return "existing";
}

function mutationFailure(receipt, error, { receiptVerified = false } = {}) {
  return {
    state: "reconciliation-required",
    receipt,
    dispatchAllowed: false,
    reconciliationRequired: true,
    receiptVerified,
    error: error instanceof Error ? error.message : String(error),
  };
}

function pathMetadata(file) {
  if (
    !file
    || typeof file !== "object"
    || Array.isArray(file)
    || typeof file.filename !== "string"
    || !FILE_STATUSES.has(file.status)
    || !Number.isInteger(file.additions)
    || file.additions < 0
    || !Number.isInteger(file.deletions)
    || file.deletions < 0
    || !Number.isInteger(file.changes)
    || file.changes < 0
    || (file.previous_filename !== undefined && typeof file.previous_filename !== "string")
  ) return null;
  return {
    pathDigest: sha256(file.filename),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    ...(typeof file.previous_filename === "string"
      ? { previousPathDigest: sha256(file.previous_filename) }
      : {}),
  };
}

export function normalizeSuccessorComparison(
  comparison,
  {
    priorHeadSha,
    currentHeadSha,
    bookkeepingPatterns = [],
    maximumFiles = DEFAULT_MAX_COMPARE_FILES,
    headChanged = false,
  },
) {
  if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
    throw new Error("GitHub comparison must be an object");
  }
  const files = Array.isArray(comparison.files) ? comparison.files : [];
  const metadata = files.map(pathMetadata);
  const invalidFile = metadata.some((item) => item === null);
  const invalidComparison = !Array.isArray(comparison.files)
    || !COMPARE_STATUSES.has(comparison.status)
    || !Number.isInteger(comparison.aheadBy)
    || comparison.aheadBy < 0
    || !Number.isInteger(comparison.behindBy)
    || comparison.behindBy < 0
    || !Number.isInteger(comparison.totalCommits)
    || comparison.totalCommits < 0
    || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(comparison.mergeBaseSha ?? "")
    || typeof comparison.incomplete !== "boolean"
    || typeof comparison.inconsistent !== "boolean"
    || (comparison.truncated !== undefined && typeof comparison.truncated !== "boolean");
  const digestInput = {
    status: comparison.status ?? null,
    aheadBy: comparison.aheadBy ?? null,
    behindBy: comparison.behindBy ?? null,
    totalCommits: comparison.totalCommits ?? null,
    mergeBaseSha: comparison.mergeBaseSha ? lower(comparison.mergeBaseSha) : null,
    files: metadata.filter(Boolean).sort((left, right) =>
      left.pathDigest < right.pathDigest ? -1 : left.pathDigest > right.pathDigest ? 1 : 0),
    incomplete: comparison.incomplete === true,
    inconsistent: comparison.inconsistent === true,
  };
  const counts = {
    files: files.length,
    additions: files.reduce((sum, file) => sum + (Number.isInteger(file?.additions) ? file.additions : 0), 0),
    deletions: files.reduce((sum, file) => sum + (Number.isInteger(file?.deletions) ? file.deletions : 0), 0),
  };
  let classification;
  let truncated = false;
  if (headChanged) {
    classification = "changed-head";
  } else if (
    files.length > maximumFiles
    || comparison.truncated === true
    || (comparison.incomplete === true && files.length >= maximumFiles)
  ) {
    classification = "oversized";
    truncated = true;
  } else if (
    comparison.incomplete === true
    || comparison.inconsistent === true
    || invalidComparison
    || invalidFile
  ) {
    classification = "ambiguous";
    truncated = comparison.incomplete === true;
  } else if (
    comparison.status !== "ahead"
    || lower(comparison.mergeBaseSha) !== lower(priorHeadSha)
  ) {
    classification = "non-comparable";
  } else if (files.length === 0) {
    classification = "ambiguous";
  } else {
    const matchers = bookkeepingPatterns.map(globToRegExp);
    const matches = files.map((file) => {
      const paths = [file.filename, file.previous_filename].filter(
        (value) => typeof value === "string",
      );
      return paths.length > 0 && paths.every((path) => matchers.some((matcher) => matcher.test(path)));
    });
    if (matches.every(Boolean)) classification = "bookkeeping-only";
    else if (matches.some(Boolean)) classification = "mixed";
    else classification = "content-changing";
  }
  return {
    comparison: classification,
    deltaDigest: sha256(stableProtocolJson(digestInput)),
    counts,
    truncated,
    priorHeadSha: lower(priorHeadSha),
    currentHeadSha: lower(currentHeadSha),
  };
}

export class ReceiptStore {
  constructor({
    client,
    now = () => new Date().toISOString(),
    bookkeepingPatterns = [".trellis/**", ".obsidian-kb/**"],
    maximumCompareFiles = DEFAULT_MAX_COMPARE_FILES,
  }) {
    if (!client) throw new Error("ReceiptStore requires a GitHub client");
    this.client = client;
    this.now = now;
    this.bookkeepingPatterns = bookkeepingPatterns;
    this.maximumCompareFiles = maximumCompareFiles;
    this.repository = { owner: lower(client.owner), name: lower(client.repo) };
  }

  async #assertLiveHead(request) {
    const pullRequest = await this.client.getPullRequest(request.pullRequestNumber);
    const liveHead = headFromPullRequest(pullRequest);
    if (liveHead !== request.headSha) {
      throw new Error("live pull request head must match request.headSha");
    }
    return pullRequest;
  }

  #assertRepository(request) {
    if (
      request.repository.owner !== this.repository.owner
      || request.repository.name !== this.repository.name
    ) {
      throw new Error("request repository must match the GitHub client repository");
    }
  }

  async #records(pullRequestNumber, headSha) {
    const checks = await this.client.listCheckRuns(headSha, RECEIPT_CHECK_NAME);
    const records = checks.map((check) => decodeReceiptCheckRun(check, {
      repository: this.repository,
      pullRequestNumber,
      headSha,
    }));
    const identities = new Set();
    for (const record of records) {
      if (identities.has(record.receipt.logicalDispatchId)) {
        throw new Error("duplicate durable receipts exist for one logical dispatch identity");
      }
      identities.add(record.receipt.logicalDispatchId);
    }
    return records;
  }

  async query({ pullRequestNumber, headSha, logicalDispatchId, correlationId }) {
    if (!logicalDispatchId && !correlationId) {
      throw new Error("receipt query requires logicalDispatchId or correlationId");
    }
    const records = await this.#records(pullRequestNumber, lower(headSha));
    const matches = records.filter(({ receipt }) =>
      (!logicalDispatchId || receipt.logicalDispatchId === lower(logicalDispatchId))
      && (!correlationId || receipt.correlationIds.includes(correlationId)));
    if (matches.length > 1) {
      throw new Error("receipt query matched multiple durable receipts");
    }
    return matches[0]?.receipt ?? null;
  }

  async #recordForIdentity(request) {
    const records = await this.#records(request.pullRequestNumber, request.headSha);
    return records.find(({ receipt }) => receipt.logicalDispatchId === request.logicalDispatchId) ?? null;
  }

  async #rereadRecord(receipt) {
    const records = await this.#records(receipt.pullRequestNumber, receipt.headSha);
    const match = records.find(
      (record) => record.receipt.logicalDispatchId === receipt.logicalDispatchId,
    );
    if (!match) throw new Error("durable receipt was not observable after mutation");
    return match;
  }

  async #updateRecord(record, receipt) {
    try {
      await this.#assertLiveHead(receipt);
    } catch (error) {
      return mutationFailure(record.receipt, error, { receiptVerified: true });
    }
    try {
      await this.client.updateCheckRun(record.checkId, checkRunPayload(receipt, { update: true }));
    } catch (error) {
      return mutationFailure(receipt, error);
    }
    let updated;
    try {
      updated = await this.#rereadRecord(receipt);
    } catch (error) {
      return mutationFailure(receipt, error);
    }
    return {
      state: receiptState(updated.receipt),
      receipt: updated.receipt,
      dispatchAllowed: false,
      reconciliationRequired: receiptState(updated.receipt) === "reconciliation-required",
    };
  }

  async #validateRerequest(request, selectedRoute, backend, authorized) {
    if (!request.rerequestOf) return;
    if (!authorized) throw new Error("same-head rerequest is not authorized by repository policy");
    const prior = await this.query({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      logicalDispatchId: request.rerequestOf.priorLogicalDispatchId,
    });
    if (!prior) throw new Error("same-head rerequest prior receipt was not found");
    if (prior.receiptId !== request.rerequestOf.priorReceiptId) {
      throw new Error("same-head rerequest prior receipt identity does not match");
    }
    if (prior.attempt !== request.rerequestOf.priorAttempt) {
      throw new Error("same-head rerequest prior attempt does not match");
    }
    if (!prior.backend?.supportsRerequest) {
      throw new Error("same-head rerequest backend does not support rerequest");
    }
    if (prior.policyVersion !== request.policyVersion) {
      throw new Error("same-head rerequest policy version does not match the prior receipt");
    }
    if (prior.selectedRoute !== selectedRoute || prior.backend.id !== backend?.id) {
      throw new Error("same-head rerequest route and backend must match the prior receipt");
    }
  }

  #newReceipt(request, { decision, backend, workflowUrl, successorEvidence }) {
    const selectedRoute = decision?.route ?? request.route;
    if (selectedRoute === "auto") {
      throw new Error("automatic requests require a resolved routing decision");
    }
    const startedAt = isoTimestamp(this.now, "receipt dispatch timestamp");
    const dispatch = selectedRoute === "none"
      ? {
          status: "skipped",
          phase: "not-started",
          idempotencyKey: request.logicalDispatchId,
          completedAt: startedAt,
        }
      : {
          status: "requested",
          phase: "started",
          idempotencyKey: request.logicalDispatchId,
          startedAt,
          ...(workflowUrl ? { workflowUrl } : {}),
        };
    const receipt = {
      schemaVersion: 1,
      receiptId: `receipt-v1-${request.logicalDispatchId}`,
      logicalDispatchId: request.logicalDispatchId,
      requestFingerprint: request.requestFingerprint,
      repository: request.repository,
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
      attempt: request.attempt,
      selectedRoute,
      backend: selectedRoute === "none" ? null : backend,
      reason: decision?.reason ?? `explicit ${selectedRoute} route selected`,
      policyVersion: request.policyVersion,
      dispatch,
      correlationIds: uniqueSorted([request.correlationId, ...request.correlationAliases]),
    };
    if (request.localReview) {
      receipt.localEvidence = {
        receiptId: request.localReview.receiptId,
        digest: sha256(stableProtocolJson(request.localReview)),
        contribution: decision?.localEvidence === "lowered" ? "lowered" : "ignored",
      };
    }
    if (successorEvidence) receipt.successorEvidence = successorEvidence;
    return decodeReceipt(receipt);
  }

  async begin(
    requestValue,
    {
      decision,
      backend = null,
      workflowUrl,
      successorEvidence,
      rerequestAuthorized = false,
    } = {},
  ) {
    const request = decodeReviewRequest(requestValue);
    this.#assertRepository(request);
    await this.#assertLiveHead(request);
    const receipt = this.#newReceipt(request, { decision, backend, workflowUrl, successorEvidence });
    await this.#validateRerequest(
      request,
      receipt.selectedRoute,
      receipt.backend,
      rerequestAuthorized,
    );
    const existing = await this.#recordForIdentity(request);
    if (existing) {
      if (existing.receipt.requestFingerprint !== request.requestFingerprint) {
        throw new Error("existing durable receipt conflicts with the canonical request fingerprint");
      }
      const correlationIds = uniqueSorted([
        ...existing.receipt.correlationIds,
        request.correlationId,
        ...request.correlationAliases,
      ]);
      if (stableProtocolJson(correlationIds) !== stableProtocolJson(existing.receipt.correlationIds)) {
        return this.#updateRecord(existing, decodeReceipt({
          ...existing.receipt,
          correlationIds,
        }));
      }
      const state = receiptState(existing.receipt);
      return {
        state,
        receipt: existing.receipt,
        dispatchAllowed: false,
        reconciliationRequired: state === "reconciliation-required",
      };
    }

    await this.#assertLiveHead(request);
    let created;
    try {
      created = await this.client.createCheckRun(checkRunPayload(receipt));
    } catch (error) {
      return mutationFailure(receipt, error);
    }
    let record;
    try {
      record = await this.#rereadRecord(receipt);
    } catch (error) {
      return mutationFailure(receipt, error);
    }
    try {
      await this.#assertLiveHead(request);
    } catch (error) {
      return mutationFailure(record.receipt, error, { receiptVerified: true });
    }
    if (!Number.isInteger(created?.id) || created.id !== record.checkId) {
      return mutationFailure(record.receipt, new Error("created receipt identity is ambiguous"));
    }
    return {
      state: receipt.dispatch.status === "skipped" ? "skipped" : "started",
      receipt: record.receipt,
      dispatchAllowed: receipt.dispatch.status === "requested",
      reconciliationRequired: false,
    };
  }

  async acknowledge({ pullRequestNumber, headSha, logicalDispatchId, acknowledgment }) {
    const decoded = decodeAdapterAcknowledgment(acknowledgment);
    const records = await this.#records(pullRequestNumber, lower(headSha));
    const record = records.find(({ receipt }) => receipt.logicalDispatchId === lower(logicalDispatchId));
    if (!record) throw new Error("durable receipt was not found for acknowledgment");
    if (decoded.logicalDispatchId !== record.receipt.logicalDispatchId) {
      throw new Error("acknowledgment logicalDispatchId must match the durable receipt");
    }
    if (record.receipt.backend?.kind !== "external") {
      throw new Error("adapter acknowledgment is valid only for an external backend");
    }
    if (decoded.backendId !== record.receipt.backend?.id) {
      throw new Error("acknowledgment backendId must match the durable receipt backend");
    }
    if (
      stableProtocolJson(decoded.findingChannels)
      !== stableProtocolJson(record.receipt.backend.findingChannels)
    ) {
      throw new Error("acknowledgment findingChannels must match the durable receipt backend");
    }
    if (record.receipt.dispatch.phase === "observed") {
      if (decoded.status !== "acknowledged") {
        throw new Error("failed acknowledgment cannot follow an observed receipt");
      }
      return {
        state: "observed",
        receipt: record.receipt,
        dispatchAllowed: false,
        reconciliationRequired: false,
      };
    }
    if (record.receipt.dispatch.phase === "acknowledged") {
      const storedStatus = record.receipt.dispatch.status === "failed" ? "failed" : "acknowledged";
      if (decoded.status !== storedStatus) {
        throw new Error("acknowledgment status conflicts with the durable receipt");
      }
      return {
        state: record.receipt.dispatch.status === "failed" ? "failed" : "acknowledged",
        receipt: record.receipt,
        dispatchAllowed: false,
        reconciliationRequired: false,
      };
    }
    const receipt = decodeReceipt({
      ...record.receipt,
      dispatch: {
        ...record.receipt.dispatch,
        status: decoded.status === "failed" ? "failed" : "requested",
        phase: "acknowledged",
        completedAt: decoded.acknowledgedAt,
      },
    });
    const result = await this.#updateRecord(record, receipt);
    if (!result.reconciliationRequired) {
      result.state = decoded.status === "failed" ? "failed" : "acknowledged";
    }
    return result;
  }

  async observe({
    pullRequestNumber,
    headSha,
    logicalDispatchId,
    alreadyPresent = false,
    observations,
    workflowUrl,
    completedAt,
  }) {
    const records = await this.#records(pullRequestNumber, lower(headSha));
    const record = records.find(({ receipt }) => receipt.logicalDispatchId === lower(logicalDispatchId));
    if (!record) throw new Error("durable receipt was not found for observation");
    if (record.receipt.dispatch.status === "failed" || record.receipt.dispatch.status === "skipped") {
      throw new Error("failed or skipped receipts cannot transition to observed");
    }
    if (
      record.receipt.backend?.kind === "external"
      && record.receipt.dispatch.phase !== "acknowledged"
    ) {
      throw new Error("external receipts require acknowledgment before observation");
    }
    if (record.receipt.dispatch.phase === "observed") {
      return {
        state: "observed",
        receipt: record.receipt,
        dispatchAllowed: false,
        reconciliationRequired: false,
      };
    }
    const receipt = decodeReceipt({
      ...record.receipt,
      dispatch: {
        ...record.receipt.dispatch,
        status: alreadyPresent ? "already-present" : "requested",
        phase: "observed",
        completedAt: isoTimestamp(completedAt ?? this.now, "receipt observation timestamp"),
        ...(workflowUrl ? { workflowUrl } : {}),
      },
      ...(observations ? { observations } : {}),
    });
    const result = await this.#updateRecord(record, receipt);
    if (!result.reconciliationRequired) result.state = "observed";
    return result;
  }

  async compareSuccessor(requestValue) {
    const request = decodeReviewRequest(requestValue);
    this.#assertRepository(request);
    if (!request.supersedes) throw new Error("successor comparison requires request.supersedes");
    await this.#assertLiveHead(request);
    const priorReceipt = await this.query({
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.supersedes.priorHeadSha,
      logicalDispatchId: request.supersedes.priorLogicalDispatchId,
    });
    if (!priorReceipt) throw new Error("successor comparison prior receipt was not found");
    if (priorReceipt.receiptId !== request.supersedes.priorReceiptId) {
      throw new Error("successor comparison prior receipt identity does not match");
    }
    if (
      request.supersedes.correlationId
      && !priorReceipt.correlationIds.includes(request.supersedes.correlationId)
    ) {
      throw new Error("successor comparison correlationId does not match the prior receipt");
    }
    const comparison = await this.client.compareCommits(
      request.supersedes.priorHeadSha,
      request.headSha,
    );
    const liveAfter = headFromPullRequest(
      await this.client.getPullRequest(request.pullRequestNumber),
    );
    const normalized = normalizeSuccessorComparison(comparison, {
      priorHeadSha: request.supersedes.priorHeadSha,
      currentHeadSha: request.headSha,
      bookkeepingPatterns: this.bookkeepingPatterns,
      maximumFiles: this.maximumCompareFiles,
      headChanged: liveAfter !== request.headSha,
    });
    const evidence = decodeSuccessorEvidence({
      schemaVersion: 1,
      evidenceType: "github-compare",
      priorReceiptId: priorReceipt.receiptId,
      priorLogicalDispatchId: priorReceipt.logicalDispatchId,
      priorHeadSha: request.supersedes.priorHeadSha,
      currentHeadSha: request.headSha,
      comparison: normalized.comparison,
      deltaDigest: normalized.deltaDigest,
    });
    return { evidence, counts: normalized.counts, truncated: normalized.truncated };
  }
}
