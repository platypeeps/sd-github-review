import { createHash } from "node:crypto";
import {
  decodeAdapterAcknowledgment,
  decodeReceipt,
  decodeReviewRequest,
  decodeSuccessorEvidence,
  stableProtocolJson,
} from "./protocol.js";
import { globToRegExp } from "./path-match.js";

export const RECEIPT_CHECK_NAME = "sd-github-review/receipt";
export const RECEIPT_MARKER = "<!-- sd-github-review-receipt:v1 -->\n";

const MAX_RECEIPT_TEXT_BYTES = 32 * 1024 + 256;
const MAX_RECONCILIATION_EVIDENCE = 16;
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

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
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

// GitHub's maximum job lifetime. A receipt is advanced out of "started" by the
// job that dispatched it, so past this age no job can still be alive to do it
// and a false strand is impossible. It is a ceiling derived from the platform,
// not a tuning guess -- the shipped lanes declare no `timeout-minutes`, so the
// platform default is what actually bounds them. A lane that declares its own
// lower timeout can safely lower this to match, which is what the
// `stranded-receipt-minutes` input is for.
export const DEFAULT_STRANDED_RECEIPT_MINUTES = 360;

// Every value the `durable-state` output can carry. This is not a recitation:
// resultOutputs() validates result.state against it on the way out, so a state
// introduced without being added here fails the moment any test routes, and a
// test binds action.yml's documented list to this set. Adding a state means
// touching one place and being told about the other two.
export const DURABLE_STATES = Object.freeze(new Set([
  "started",
  "in-flight",
  "acknowledged",
  "observed",
  "skipped",
  "failed",
  "existing",
  "not-found",
  "reconciliation-required",
]));

// Whether a receipt sitting at phase "started" has outlived any job that could
// still advance it.
function startedReceiptIsStranded(receipt, now, strandedAfterMinutes) {
  const startedAt = Date.parse(receipt.dispatch.startedAt ?? "");
  const observedAt = Date.parse(typeof now === "function" ? now() : now);
  // No usable clock on either side means there is no age to judge. Report
  // stranded: a receipt that cannot be shown to be running is exactly the case
  // a human must look at, and this is also the pre-existing behaviour, so an
  // unreadable timestamp degrades to the old semantics rather than to silence.
  if (!Number.isFinite(startedAt) || !Number.isFinite(observedAt)) return true;
  return observedAt - startedAt >= strandedAfterMinutes * 60_000;
}

// `reconciliation-required` used to cover every receipt at phase "started",
// which conflated a dispatch running right now with one stranded by a finalize
// that never landed. Nothing could gate on it without failing healthy in-flight
// replays, so no shipped lane gated on it at all and a stranded receipt was
// silent. Splitting by age restores the meaning docs/RELEASE_CHECKLIST.md
// already claims -- reserved for cases needing a human -- and makes the gate
// safe to ship.
function receiptState(receipt, { now, strandedAfterMinutes } = {}) {
  // A failed dispatch is known broken rather than running, so age is
  // irrelevant to it and it always needs a human.
  if (receipt.dispatch.status === "failed" && receipt.dispatch.phase === "started") {
    return "reconciliation-required";
  }
  if (receipt.dispatch.phase === "started") {
    return startedReceiptIsStranded(receipt, now, strandedAfterMinutes)
      ? "reconciliation-required"
      : "in-flight";
  }
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
    strandedAfterMinutes = DEFAULT_STRANDED_RECEIPT_MINUTES,
  }) {
    if (!client) throw new Error("ReceiptStore requires a GitHub client");
    this.client = client;
    this.now = now;
    this.strandedAfterMinutes = strandedAfterMinutes;
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
    return checks.map((check) => decodeReceiptCheckRun(check, {
      repository: this.repository,
      pullRequestNumber,
      headSha,
    }));
  }

  // Elect one authoritative record per logical dispatch identity. GitHub Check
  // Runs offer no atomic create-if-absent, so concurrent begins can durably
  // create more than one Check Run for a single identity. The lowest check id
  // (the earliest durable create) is authoritative; extra creates are retained
  // as bounded reconciliation evidence and never deleted or overwritten. This
  // replaces the previous unconditional duplicate rejection, which wedged every
  // later query/finalize with no recovery path (A-003).
  async #electedRecords(pullRequestNumber, headSha) {
    const records = await this.#records(pullRequestNumber, headSha);
    const elected = new Map();
    const duplicates = new Map();
    for (const record of records) {
      const id = record.receipt.logicalDispatchId;
      const current = elected.get(id);
      if (!current) {
        elected.set(id, record);
        continue;
      }
      const keep = record.checkId < current.checkId ? record : current;
      const drop = record.checkId < current.checkId ? current : record;
      elected.set(id, keep);
      duplicates.set(id, [...(duplicates.get(id) ?? []), drop.checkId]);
    }
    for (const [id, ids] of duplicates) {
      duplicates.set(id, uniqueSortedNumbers(ids));
    }
    return { elected, duplicates };
  }

  // Pure selection over a pre-loaded elected map. Extracted from query so a
  // single current-head snapshot can serve both query() and begin()'s rerequest
  // validation + identity lookup without reloading the same Check Run set (A-015).
  #selectElectedReceipt(elected, { logicalDispatchId, correlationId }) {
    if (!logicalDispatchId && !correlationId) {
      throw new Error("receipt query requires logicalDispatchId or correlationId");
    }
    const matches = [...elected.values()].filter(({ receipt }) =>
      (!logicalDispatchId || receipt.logicalDispatchId === lower(logicalDispatchId))
      && (!correlationId || receipt.correlationIds.includes(correlationId)));
    if (matches.length > 1) {
      throw new Error("receipt query matched multiple durable receipts");
    }
    return matches[0]?.receipt ?? null;
  }

  async query({ pullRequestNumber, headSha, logicalDispatchId, correlationId }) {
    const { elected } = await this.#electedRecords(pullRequestNumber, lower(headSha));
    return this.#selectElectedReceipt(elected, { logicalDispatchId, correlationId });
  }

  async #rereadRecord(receipt) {
    const { elected } = await this.#electedRecords(receipt.pullRequestNumber, receipt.headSha);
    const match = elected.get(receipt.logicalDispatchId);
    if (!match) throw new Error("durable receipt was not observable after mutation");
    return match;
  }

  // The store owns the clock and the staleness window, so every state read goes
  // through here rather than calling receiptState with them spelled out at each
  // site -- a site that forgot them would silently report every in-flight
  // receipt as stranded.
  #stateOf(receipt) {
    return receiptState(receipt, {
      now: this.now,
      strandedAfterMinutes: this.strandedAfterMinutes,
    });
  }

  // `authorizeDispatch` is for replacing a recorded skip with a real dispatch.
  // The default result shape reports every update as non-dispatching and runs
  // the state through receiptState, which maps phase "started" to
  // reconciliation-required -- correct for an in-place edit of a live receipt,
  // wrong for one that is only now beginning. That case takes the same shape
  // the create path returns for a freshly minted receipt.
  async #updateRecord(record, receipt, { authorizeDispatch = false } = {}) {
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
    if (authorizeDispatch) {
      return {
        state: receipt.dispatch.status === "skipped" ? "skipped" : "started",
        receipt: updated.receipt,
        dispatchAllowed: receipt.dispatch.status === "requested",
        reconciliationRequired: false,
      };
    }
    const updatedState = this.#stateOf(updated.receipt);
    return {
      state: updatedState,
      receipt: updated.receipt,
      dispatchAllowed: false,
      reconciliationRequired: updatedState === "reconciliation-required",
    };
  }

  #validateRerequest(request, selectedRoute, backend, authorized, elected) {
    if (!request.rerequestOf) return;
    if (!authorized) throw new Error("same-head rerequest is not authorized by repository policy");
    const prior = this.#selectElectedReceipt(elected, {
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
    // Load one pre-create current-head snapshot and share it across rerequest
    // validation and the identity lookup (A-015). The post-create reread below
    // is a separate, required observation of the newly created Check Run.
    const preElection = await this.#electedRecords(request.pullRequestNumber, request.headSha);
    this.#validateRerequest(
      request,
      receipt.selectedRoute,
      receipt.backend,
      rerequestAuthorized,
      preElection.elected,
    );
    const existing = preElection.elected.get(request.logicalDispatchId) ?? null;
    if (existing) {
      if (existing.receipt.requestFingerprint !== request.requestFingerprint) {
        throw new Error("existing durable receipt conflicts with the canonical request fingerprint");
      }
      const correlationIds = uniqueSorted([
        ...existing.receipt.correlationIds,
        request.correlationId,
        ...request.correlationAliases,
      ]);
      // A recorded skip is terminal but represents no work: nothing was
      // dispatched and no reviewer ran, so replacing it cannot duplicate a
      // review. Every input that produces a skip -- draft, sensitive-paths,
      // changed-line-threshold, review-drafts -- is read from live GitHub state
      // or action inputs into routingContext, never into the request, so none
      // of them reach fingerprintFields and none move logicalDispatchId. Nor
      // does marking a pull request ready for review change its head SHA.
      // Without this, the first review of a draft wedges that exact head: every
      // later dispatch matches the stale skip, agrees on the fingerprint, and
      // is answered "not reviewed" for as long as the head stands.
      //
      // Narrow on purpose. It fires only when the recorded outcome was a skip
      // and the fresh decision is not, so a bookkeeping none re-dispatched
      // under unchanged conditions still returns its existing receipt
      // untouched. Phase "not-started" -> "started" advances, so this does not
      // regress the monotonic phase rule.
      if (existing.receipt.dispatch.status === "skipped" && receipt.dispatch.status !== "skipped") {
        return this.#updateRecord(
          existing,
          decodeReceipt({ ...receipt, correlationIds }),
          { authorizeDispatch: true },
        );
      }
      if (stableProtocolJson(correlationIds) !== stableProtocolJson(existing.receipt.correlationIds)) {
        return this.#updateRecord(existing, decodeReceipt({
          ...existing.receipt,
          correlationIds,
        }));
      }
      const state = this.#stateOf(existing.receipt);
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
    let election;
    try {
      election = await this.#electedRecords(request.pullRequestNumber, request.headSha);
    } catch (error) {
      return mutationFailure(receipt, error);
    }
    const elected = election.elected.get(request.logicalDispatchId);
    if (!elected) {
      return mutationFailure(receipt, new Error("durable receipt was not observable after mutation"));
    }
    try {
      await this.#assertLiveHead(request);
    } catch (error) {
      return mutationFailure(elected.receipt, error, { receiptVerified: true });
    }
    if (!Number.isInteger(created?.id)) {
      // The authoritative receipt was already reread and its live head asserted,
      // so it is verified even though this caller's own create response id is
      // unusable; retain it for reconciliation rather than dropping it.
      return mutationFailure(
        elected.receipt,
        new Error("created receipt identity is ambiguous"),
        { receiptVerified: true },
      );
    }
    if (created.id !== elected.checkId) {
      // A concurrent begin durably created the authoritative receipt first. Do
      // not authorize a second dispatch; surface bounded reconciliation evidence
      // and leave every competing Check Run intact for external reconciliation.
      const duplicates = election.duplicates.get(request.logicalDispatchId) ?? [];
      const superseded = uniqueSortedNumbers([created.id, ...duplicates]);
      return {
        state: "reconciliation-required",
        receipt: elected.receipt,
        dispatchAllowed: false,
        reconciliationRequired: true,
        receiptVerified: true,
        reconciliation: {
          authoritativeCheckId: elected.checkId,
          supersededCheckId: created.id,
          duplicateCount: superseded.length,
          // Keep the evidence hint bounded; every Check Run remains durable for
          // external reconciliation, so the full set is never lost by capping.
          duplicateCheckIds: superseded.slice(0, MAX_RECONCILIATION_EVIDENCE),
        },
      };
    }
    return {
      state: receipt.dispatch.status === "skipped" ? "skipped" : "started",
      receipt: elected.receipt,
      dispatchAllowed: receipt.dispatch.status === "requested",
      reconciliationRequired: false,
    };
  }

  async acknowledge({ pullRequestNumber, headSha, logicalDispatchId, acknowledgment }) {
    const decoded = decodeAdapterAcknowledgment(acknowledgment);
    const { elected } = await this.#electedRecords(pullRequestNumber, lower(headSha));
    const record = elected.get(lower(logicalDispatchId));
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
    const { elected } = await this.#electedRecords(pullRequestNumber, lower(headSha));
    const record = elected.get(lower(logicalDispatchId));
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
