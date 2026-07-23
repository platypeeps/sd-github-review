import { createHash } from "node:crypto";
import { normalizeConfidence, normalizeMode, routeReview } from "./router.js";

export const PROTOCOL_SCHEMA_MAJOR = 1;

const REQUEST_MAX_BYTES = 16 * 1024;
const LOCAL_SUMMARY_MAX_BYTES = 8 * 1024;
const RECEIPT_MAX_BYTES = 32 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const REASON_MAX_BYTES = 512;
const MAX_COLLECTION_ITEMS = 16;

const ROUTES = new Set(["auto", "cheap", "deep", "copilot", "none"]);
const REMOTE_ROUTES = new Set(["cheap", "deep", "copilot"]);
const CONFIDENCE_LEVELS = new Set(["unknown", "high", "medium", "low"]);
const LOCAL_OUTCOMES = new Set([
  "clean",
  "fully-dispositioned",
  "unavailable",
  "failed",
  "cancelled",
  "skipped",
]);
const SKIP_REASONS = new Set([
  "explicit-none",
  "bookkeeping-successor",
  "provider-unavailable",
  "not-requested",
]);
const COST_TIERS = new Set(["free", "low", "medium", "high", "unknown"]);
const QUALITY_TIERS = new Set(["basic", "standard", "advanced", "unknown"]);
const CAPABILITY_TIERS = new Set(["basic", "standard", "advanced"]);
const BACKEND_KINDS = new Set(["copilot", "external"]);
const BACKEND_CAPABILITIES = new Set([
  "review",
  "inline-comments",
  "conversation-comments",
  "checks",
  "rerequest",
]);
const FINDING_CHANNELS = new Set([
  "review",
  "inline-comment",
  "conversation-comment",
  "check",
]);
const SUCCESSOR_CLASSES = new Set([
  "bookkeeping-only",
  "mixed",
  "content-changing",
  "non-comparable",
  "ambiguous",
  "oversized",
  "changed-head",
]);
const DISPATCH_STATUSES = new Set(["requested", "already-present", "skipped", "failed"]);
const DISPATCH_PHASES = new Set(["not-started", "started", "acknowledged", "observed"]);
const ACK_STATUSES = new Set(["acknowledged", "failed"]);
const CONTRIBUTIONS = new Set(["lowered", "unchanged", "ignored"]);
const CALLER_TYPES = new Set(["human", "automation", "service"]);

const FORBIDDEN_FIELD_NAMES = new Set([
  "source",
  "sourcetext",
  "path",
  "paths",
  "file",
  "files",
  "prompt",
  "prompts",
  "finding",
  "findings",
  "rawfinding",
  "rawfindings",
  "transcript",
  "transcripts",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "token",
  "tokens",
  "configuration",
  "config",
  "configurationvalues",
  "artifact",
  "artifacts",
  "artifactcontent",
  "artifactcontents",
  "localartifact",
  "localartifacts",
  "content",
  "contents",
]);

const ROUTE_STRENGTH = new Map([
  ["none", 0],
  ["cheap", 1],
  ["deep", 2],
  ["copilot", 3],
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectValue(value, field) {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function rejectForbiddenFields(value, field = "value", seen = new WeakSet()) {
  if (value === null) return;
  if (typeof value !== "object") {
    if (
      !["string", "number", "boolean"].includes(typeof value)
      || (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error(`${field} must contain JSON values only`);
    }
    return;
  }
  if (seen.has(value)) {
    throw new Error(`${field} must not contain circular data`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenFields(item, `${field}[${index}]`, seen));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_FIELD_NAMES.has(normalizedKey)) {
      throw new Error(`${field}.${key} is forbidden by the protocol privacy boundary`);
    }
    rejectForbiddenFields(item, `${field}.${key}`, seen);
  }
}

function assertEncodedSize(value, field, maximum) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${field} must be JSON serializable`);
  }
  if (encoded === undefined) {
    throw new Error(`${field} must be JSON serializable`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maximum) {
    throw new Error(`${field} exceeds the ${maximum}-byte limit`);
  }
}

function stringValue(value, field, { maximum = SHORT_TEXT_MAX_BYTES, pattern, lower = false } = {}) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }
  if (Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new Error(`${field} exceeds the ${maximum}-byte limit`);
  }
  if (pattern && !pattern.test(normalized)) {
    throw new Error(`${field} has an invalid format`);
  }
  return lower ? normalized.toLowerCase() : normalized;
}

function optionalString(value, field, options) {
  return value === undefined ? undefined : stringValue(value, field, options);
}

function enumValue(value, field, allowed) {
  const normalized = stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES }).toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(`${field} must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function integerValue(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function schemaVersion(value, field) {
  if (value !== PROTOCOL_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${PROTOCOL_SCHEMA_MAJOR}`);
  }
  return value;
}

function digestValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-fA-F0-9]{64}$/u, lower: true });
}

function headShaValue(value, field) {
  return stringValue(value, field, {
    maximum: 64,
    pattern: /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u,
    lower: true,
  });
}

function timestampValue(value, field) {
  const normalized = stringValue(value, field, { maximum: 40 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(normalized)) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp`);
  }
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return normalized;
}

function httpsUrlValue(value, field) {
  const normalized = stringValue(value, field, { maximum: 2048 });
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  return url.toString();
}

function stringArray(value, field, {
  maximumItems = MAX_COLLECTION_ITEMS,
  maximumBytes = SHORT_TEXT_MAX_BYTES,
  allowed,
  lower = false,
  allowEmpty = true,
} = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  if (value.length > maximumItems) {
    throw new Error(`${field} exceeds the ${maximumItems}-item limit`);
  }
  const normalized = value.map((item, index) => {
    const result = stringValue(item, `${field}[${index}]`, { maximum: maximumBytes });
    const canonical = lower ? result.toLowerCase() : result;
    if (allowed && !allowed.has(canonical)) {
      throw new Error(`${field}[${index}] must be one of: ${[...allowed].join(", ")}`);
    }
    return canonical;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not contain duplicates`);
  }
  return normalized.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function repositoryValue(value, field = "repository") {
  const repository = objectValue(value, field);
  return {
    owner: stringValue(repository.owner, `${field}.owner`, {
      maximum: 100,
      pattern: /^[A-Za-z0-9_.-]+$/u,
      lower: true,
    }),
    name: stringValue(repository.name, `${field}.name`, {
      maximum: 100,
      pattern: /^[A-Za-z0-9_.-]+$/u,
      lower: true,
    }),
  };
}

function sameRepository(left, right) {
  return left.owner === right.owner && left.name === right.name;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function stableProtocolJson(value) {
  return JSON.stringify(canonicalize(value));
}

function fingerprintFields(request) {
  const {
    correlationId: _correlationId,
    correlationAliases: _correlationAliases,
    logicalDispatchId: _logicalDispatchId,
    requestFingerprint: _requestFingerprint,
    ...dispatchRelevant
  } = request;
  if (!dispatchRelevant.supersedes) return dispatchRelevant;
  const { correlationId: _supersedesCorrelationId, ...supersedes } = dispatchRelevant.supersedes;
  return { ...dispatchRelevant, supersedes };
}

function sha256(value) {
  return createHash("sha256").update(stableProtocolJson(value), "utf8").digest("hex");
}

function logicalIdentityFields(request) {
  return {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    repository: request.repository,
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    attempt: request.attempt,
  };
}

function deriveLogicalDispatchIdFromFields(fields) {
  return sha256(logicalIdentityFields(fields));
}

function localProviderValue(value, field) {
  const provider = objectValue(value, field);
  return {
    id: stringValue(provider.id, `${field}.id`, { maximum: SHORT_TEXT_MAX_BYTES }),
    capabilityTier: enumValue(provider.capabilityTier, `${field}.capabilityTier`, CAPABILITY_TIERS),
    costTier: enumValue(provider.costTier, `${field}.costTier`, COST_TIERS),
    qualityTier: enumValue(provider.qualityTier, `${field}.qualityTier`, QUALITY_TIERS),
  };
}

function dispositionCountsValue(value, field) {
  const counts = objectValue(value, field);
  const normalized = {
    total: integerValue(counts.total, `${field}.total`, { maximum: 10_000 }),
    unresolved: integerValue(counts.unresolved, `${field}.unresolved`, { maximum: 10_000 }),
    fixed: integerValue(counts.fixed, `${field}.fixed`, { maximum: 10_000 }),
    rebutted: integerValue(counts.rebutted, `${field}.rebutted`, { maximum: 10_000 }),
  };
  if (normalized.total !== normalized.unresolved + normalized.fixed + normalized.rebutted) {
    throw new Error(`${field}.total must equal unresolved + fixed + rebutted`);
  }
  return normalized;
}

export function decodeLocalReviewSummary(value, expectedIdentity) {
  rejectForbiddenFields(value, "localReview");
  assertEncodedSize(value, "localReview", LOCAL_SUMMARY_MAX_BYTES);
  const summary = objectValue(value, "localReview");
  schemaVersion(summary.schemaVersion, "localReview.schemaVersion");
  const providers = Array.isArray(summary.providers)
    ? summary.providers.map((provider, index) => localProviderValue(provider, `localReview.providers[${index}]`))
    : (() => { throw new Error("localReview.providers must be an array"); })();
  if (providers.length === 0 || providers.length > 8) {
    throw new Error("localReview.providers must contain 1 through 8 items");
  }
  providers.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
    throw new Error("localReview.providers must use unique IDs");
  }

  const outcome = enumValue(summary.outcome, "localReview.outcome", LOCAL_OUTCOMES);
  const confidence = integerValue(summary.confidence, "localReview.confidence", { maximum: 100 });
  const dispositionCounts = dispositionCountsValue(
    summary.dispositionCounts,
    "localReview.dispositionCounts",
  );
  const skipReason = optionalString(summary.skipReason, "localReview.skipReason", { maximum: 64 });

  if (["unavailable", "failed", "cancelled", "skipped"].includes(outcome) && confidence !== 0) {
    throw new Error(`localReview.confidence must be 0 for ${outcome} outcomes`);
  }
  if (outcome === "skipped") {
    if (!skipReason || !SKIP_REASONS.has(skipReason.toLowerCase())) {
      throw new Error(`localReview.skipReason must be one of: ${[...SKIP_REASONS].join(", ")}`);
    }
  } else if (skipReason !== undefined) {
    throw new Error("localReview.skipReason is valid only for skipped outcomes");
  }
  if (["clean", "fully-dispositioned"].includes(outcome) && dispositionCounts.unresolved !== 0) {
    throw new Error(`localReview.dispositionCounts.unresolved must be 0 for ${outcome} outcomes`);
  }
  if (outcome === "clean" && dispositionCounts.total !== 0) {
    throw new Error("localReview.dispositionCounts.total must be 0 for a clean outcome");
  }

  const normalized = {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    receiptId: stringValue(summary.receiptId, "localReview.receiptId"),
    repository: repositoryValue(summary.repository, "localReview.repository"),
    pullRequestNumber: integerValue(summary.pullRequestNumber, "localReview.pullRequestNumber", {
      minimum: 1,
    }),
    headSha: headShaValue(summary.headSha, "localReview.headSha"),
    scopeDigest: digestValue(summary.scopeDigest, "localReview.scopeDigest"),
    configurationDigest: digestValue(
      summary.configurationDigest,
      "localReview.configurationDigest",
    ),
    providers,
    outcome,
    dispositionCounts,
    confidence,
    latencyMs: integerValue(summary.latencyMs, "localReview.latencyMs", {
      maximum: 86_400_000,
    }),
    costTier: enumValue(summary.costTier, "localReview.costTier", COST_TIERS),
    ...(skipReason === undefined ? {} : { skipReason: skipReason.toLowerCase() }),
  };

  if (expectedIdentity) {
    if (!sameRepository(normalized.repository, expectedIdentity.repository)) {
      throw new Error("localReview.repository must match the request repository");
    }
    if (normalized.pullRequestNumber !== expectedIdentity.pullRequestNumber) {
      throw new Error("localReview.pullRequestNumber must match the request pull request");
    }
    if (normalized.headSha !== expectedIdentity.headSha) {
      throw new Error("localReview.headSha must match the request headSha");
    }
  }
  return normalized;
}

function supersedesValue(value, field = "supersedes") {
  const supersedes = objectValue(value, field);
  return {
    priorReceiptId: stringValue(supersedes.priorReceiptId, `${field}.priorReceiptId`),
    priorLogicalDispatchId: digestValue(
      supersedes.priorLogicalDispatchId,
      `${field}.priorLogicalDispatchId`,
    ),
    priorHeadSha: headShaValue(supersedes.priorHeadSha, `${field}.priorHeadSha`),
    ...(supersedes.correlationId === undefined
      ? {}
      : { correlationId: stringValue(supersedes.correlationId, `${field}.correlationId`) }),
  };
}

function rerequestValue(value, field = "rerequestOf") {
  const rerequest = objectValue(value, field);
  return {
    priorReceiptId: stringValue(rerequest.priorReceiptId, `${field}.priorReceiptId`),
    priorLogicalDispatchId: digestValue(
      rerequest.priorLogicalDispatchId,
      `${field}.priorLogicalDispatchId`,
    ),
    priorAttempt: integerValue(rerequest.priorAttempt, `${field}.priorAttempt`, {
      minimum: 1,
      maximum: 99,
    }),
  };
}

function normalizeReviewRequest(value, { verifyCompatibility = true } = {}) {
  rejectForbiddenFields(value, "request");
  assertEncodedSize(value, "request", REQUEST_MAX_BYTES);
  const request = objectValue(value, "request");
  schemaVersion(request.schemaVersion, "request.schemaVersion");
  if (typeof request.route !== "string") {
    throw new Error("request.route must be a string");
  }
  const route = normalizeMode(request.route, "request.route");
  if (!ROUTES.has(route)) {
    throw new Error(`request.route must be one of: ${[...ROUTES].join(", ")}`);
  }
  const trustedConfidence = request.trustedConfidence === undefined
    ? undefined
    : (() => {
        if (typeof request.trustedConfidence !== "string") {
          throw new Error("request.trustedConfidence must be a string");
        }
        return normalizeConfidence(request.trustedConfidence);
      })();
  if (trustedConfidence !== undefined && !CONFIDENCE_LEVELS.has(trustedConfidence)) {
    throw new Error(`request.trustedConfidence must be one of: ${[...CONFIDENCE_LEVELS].join(", ")}`);
  }

  const repository = repositoryValue(request.repository);
  const pullRequestNumber = integerValue(request.pullRequestNumber, "request.pullRequestNumber", {
    minimum: 1,
  });
  const headSha = headShaValue(request.headSha, "request.headSha");
  const attempt = integerValue(request.attempt, "request.attempt", { minimum: 1, maximum: 100 });
  const correlationId = stringValue(request.correlationId, "request.correlationId");
  const correlationAliases = request.correlationAliases === undefined
    ? []
    : stringArray(request.correlationAliases, "request.correlationAliases", { maximumItems: 8 });
  const aliasesWithoutPrimary = correlationAliases.filter((alias) => alias !== correlationId);
  const identity = { repository, pullRequestNumber, headSha };

  const caller = request.caller === undefined
    ? undefined
    : (() => {
        const callerValue = objectValue(request.caller, "request.caller");
        return {
          id: stringValue(callerValue.id, "request.caller.id"),
          type: enumValue(callerValue.type, "request.caller.type", CALLER_TYPES),
        };
      })();
  const localReview = request.localReview === undefined
    ? undefined
    : decodeLocalReviewSummary(request.localReview, identity);
  const supersedes = request.supersedes === undefined
    ? undefined
    : supersedesValue(request.supersedes);
  const rerequestOf = request.rerequestOf === undefined
    ? undefined
    : rerequestValue(request.rerequestOf);

  if (supersedes && supersedes.priorHeadSha === headSha) {
    throw new Error("request.supersedes.priorHeadSha must differ from request.headSha");
  }
  if (rerequestOf && attempt !== rerequestOf.priorAttempt + 1) {
    throw new Error("request.attempt must be the next attempt after request.rerequestOf.priorAttempt");
  }
  if (supersedes && rerequestOf) {
    throw new Error("request.supersedes and request.rerequestOf cannot be combined");
  }

  const normalized = {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    correlationId,
    correlationAliases: aliasesWithoutPrimary,
    attempt,
    repository,
    pullRequestNumber,
    headSha,
    route,
    policyVersion: stringValue(request.policyVersion, "request.policyVersion", { maximum: 64 }),
    ...(request.policyReference === undefined
      ? {}
      : {
          policyReference: stringValue(request.policyReference, "request.policyReference", {
            maximum: SHORT_TEXT_MAX_BYTES,
          }),
        }),
    ...(trustedConfidence === undefined ? {} : { trustedConfidence }),
    ...(caller === undefined ? {} : { caller }),
    ...(localReview === undefined ? {} : { localReview }),
    ...(supersedes === undefined ? {} : { supersedes }),
    ...(rerequestOf === undefined ? {} : { rerequestOf }),
  };
  const logicalDispatchId = deriveLogicalDispatchIdFromFields(normalized);
  const requestFingerprint = sha256(fingerprintFields(normalized));

  if (verifyCompatibility && request.logicalDispatchId !== undefined) {
    const supplied = digestValue(request.logicalDispatchId, "request.logicalDispatchId");
    if (supplied !== logicalDispatchId) {
      throw new Error("request.logicalDispatchId does not match the derived logical dispatch ID");
    }
  }
  if (verifyCompatibility && request.requestFingerprint !== undefined) {
    const supplied = digestValue(request.requestFingerprint, "request.requestFingerprint");
    if (supplied !== requestFingerprint) {
      throw new Error("request.requestFingerprint does not match the derived request fingerprint");
    }
  }
  return { ...normalized, logicalDispatchId, requestFingerprint };
}

export function decodeReviewRequest(value) {
  return normalizeReviewRequest(value);
}

export function deriveLogicalDispatchId(value) {
  return deriveLogicalDispatchIdFromFields(normalizeReviewRequest(value, { verifyCompatibility: false }));
}

export function deriveRequestFingerprint(value) {
  return normalizeReviewRequest(value, { verifyCompatibility: false }).requestFingerprint;
}

export function decodeBackend(value, field = "backend") {
  rejectForbiddenFields(value, field);
  const backend = objectValue(value, field);
  const kind = enumValue(backend.kind, `${field}.kind`, BACKEND_KINDS);
  const findingChannels = stringArray(backend.findingChannels, `${field}.findingChannels`, {
    allowed: FINDING_CHANNELS,
    lower: true,
    allowEmpty: false,
  });
  const reviewAuthors = stringArray(backend.reviewAuthors ?? [], `${field}.reviewAuthors`, {
    maximumItems: 8,
  });
  const checkNames = stringArray(backend.checkNames ?? [], `${field}.checkNames`, {
    maximumItems: 8,
  });
  if (findingChannels.includes("check") && checkNames.length === 0) {
    throw new Error(`${field}.checkNames must identify every declared check finding channel`);
  }
  if (findingChannels.some((channel) => channel !== "check") && reviewAuthors.length === 0) {
    throw new Error(`${field}.reviewAuthors must identify declared comment or review channels`);
  }
  if (kind === "copilot" && reviewAuthors.length === 0) {
    throw new Error(`${field}.reviewAuthors must identify the Copilot review author`);
  }
  return {
    id: stringValue(backend.id, `${field}.id`),
    label: stringValue(backend.label, `${field}.label`),
    kind,
    ...(backend.model === undefined
      ? {}
      : { model: stringValue(backend.model, `${field}.model`, { maximum: SHORT_TEXT_MAX_BYTES }) }),
    costTier: enumValue(backend.costTier, `${field}.costTier`, COST_TIERS),
    qualityTier: enumValue(backend.qualityTier, `${field}.qualityTier`, QUALITY_TIERS),
    capabilities: stringArray(backend.capabilities, `${field}.capabilities`, {
      allowed: BACKEND_CAPABILITIES,
      lower: true,
      allowEmpty: false,
    }),
    reviewAuthors,
    checkNames,
    findingChannels,
    supportsRerequest: booleanValue(backend.supportsRerequest, `${field}.supportsRerequest`),
    limitations: stringArray(backend.limitations ?? [], `${field}.limitations`, {
      maximumItems: 8,
      maximumBytes: REASON_MAX_BYTES,
    }),
  };
}

export function decodeAdapterAcknowledgment(value) {
  rejectForbiddenFields(value, "acknowledgment");
  assertEncodedSize(value, "acknowledgment", LOCAL_SUMMARY_MAX_BYTES);
  const acknowledgment = objectValue(value, "acknowledgment");
  schemaVersion(acknowledgment.schemaVersion, "acknowledgment.schemaVersion");
  const status = enumValue(acknowledgment.status, "acknowledgment.status", ACK_STATUSES);
  const errorCode = optionalString(acknowledgment.errorCode, "acknowledgment.errorCode", {
    maximum: 64,
    pattern: /^[A-Za-z0-9_.-]+$/u,
  });
  if (status === "failed" && errorCode === undefined) {
    throw new Error("acknowledgment.errorCode is required for a failed acknowledgment");
  }
  if (status === "acknowledged" && errorCode !== undefined) {
    throw new Error("acknowledgment.errorCode is valid only for a failed acknowledgment");
  }
  return {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    logicalDispatchId: digestValue(
      acknowledgment.logicalDispatchId,
      "acknowledgment.logicalDispatchId",
    ),
    backendId: stringValue(acknowledgment.backendId, "acknowledgment.backendId"),
    status,
    acknowledgedAt: timestampValue(
      acknowledgment.acknowledgedAt,
      "acknowledgment.acknowledgedAt",
    ),
    findingChannels: stringArray(
      acknowledgment.findingChannels,
      "acknowledgment.findingChannels",
      { allowed: FINDING_CHANNELS, lower: true, allowEmpty: false },
    ),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

export function decodeSuccessorEvidence(value) {
  rejectForbiddenFields(value, "successorEvidence");
  assertEncodedSize(value, "successorEvidence", LOCAL_SUMMARY_MAX_BYTES);
  const evidence = objectValue(value, "successorEvidence");
  schemaVersion(evidence.schemaVersion, "successorEvidence.schemaVersion");
  const priorHeadSha = headShaValue(evidence.priorHeadSha, "successorEvidence.priorHeadSha");
  const currentHeadSha = headShaValue(evidence.currentHeadSha, "successorEvidence.currentHeadSha");
  if (priorHeadSha === currentHeadSha) {
    throw new Error("successorEvidence.currentHeadSha must differ from priorHeadSha");
  }
  return {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    evidenceType: enumValue(
      evidence.evidenceType,
      "successorEvidence.evidenceType",
      new Set(["github-compare"]),
    ),
    priorReceiptId: stringValue(evidence.priorReceiptId, "successorEvidence.priorReceiptId"),
    priorLogicalDispatchId: digestValue(
      evidence.priorLogicalDispatchId,
      "successorEvidence.priorLogicalDispatchId",
    ),
    priorHeadSha,
    currentHeadSha,
    comparison: enumValue(evidence.comparison, "successorEvidence.comparison", SUCCESSOR_CLASSES),
    deltaDigest: digestValue(evidence.deltaDigest, "successorEvidence.deltaDigest"),
  };
}

function dispatchValue(value, field = "receipt.dispatch") {
  const dispatch = objectValue(value, field);
  const normalized = {
    status: enumValue(dispatch.status, `${field}.status`, DISPATCH_STATUSES),
    phase: enumValue(dispatch.phase, `${field}.phase`, DISPATCH_PHASES),
    idempotencyKey: digestValue(dispatch.idempotencyKey, `${field}.idempotencyKey`),
    ...(dispatch.startedAt === undefined
      ? {}
      : { startedAt: timestampValue(dispatch.startedAt, `${field}.startedAt`) }),
    ...(dispatch.completedAt === undefined
      ? {}
      : { completedAt: timestampValue(dispatch.completedAt, `${field}.completedAt`) }),
    ...(dispatch.workflowUrl === undefined
      ? {}
      : { workflowUrl: httpsUrlValue(dispatch.workflowUrl, `${field}.workflowUrl`) }),
  };
  if (normalized.status === "requested" && normalized.phase === "not-started") {
    throw new Error(`${field}.phase cannot be not-started after a requested dispatch`);
  }
  if (normalized.status === "already-present" && normalized.phase !== "observed") {
    throw new Error(`${field}.phase must be observed for an already-present dispatch`);
  }
  if (normalized.status === "skipped" && normalized.phase !== "not-started") {
    throw new Error(`${field}.phase must be not-started for a skipped dispatch`);
  }
  if (
    normalized.startedAt
    && normalized.completedAt
    && Date.parse(normalized.completedAt) < Date.parse(normalized.startedAt)
  ) {
    throw new Error(`${field}.completedAt must not precede startedAt`);
  }
  return normalized;
}

export function decodeReceipt(value) {
  rejectForbiddenFields(value, "receipt");
  assertEncodedSize(value, "receipt", RECEIPT_MAX_BYTES);
  const receipt = objectValue(value, "receipt");
  schemaVersion(receipt.schemaVersion, "receipt.schemaVersion");
  if (typeof receipt.selectedRoute !== "string") {
    throw new Error("receipt.selectedRoute must be a string");
  }
  const selectedRoute = normalizeMode(receipt.selectedRoute, "receipt.selectedRoute");
  if (selectedRoute === "auto") {
    throw new Error("receipt.selectedRoute must be a resolved route, not auto");
  }
  const repository = repositoryValue(receipt.repository, "receipt.repository");
  const pullRequestNumber = integerValue(
    receipt.pullRequestNumber,
    "receipt.pullRequestNumber",
    { minimum: 1 },
  );
  const headSha = headShaValue(receipt.headSha, "receipt.headSha");
  const attempt = integerValue(receipt.attempt, "receipt.attempt", { minimum: 1, maximum: 100 });
  const logicalDispatchId = digestValue(receipt.logicalDispatchId, "receipt.logicalDispatchId");
  const expectedLogicalDispatchId = deriveLogicalDispatchIdFromFields({
    repository,
    pullRequestNumber,
    headSha,
    attempt,
  });
  if (logicalDispatchId !== expectedLogicalDispatchId) {
    throw new Error("receipt.logicalDispatchId does not match the receipt identity");
  }

  const backend = receipt.backend === null ? null : decodeBackend(receipt.backend, "receipt.backend");
  if (selectedRoute === "none" && backend !== null) {
    throw new Error("receipt.backend must be null for the none route");
  }
  if (REMOTE_ROUTES.has(selectedRoute) && backend === null) {
    throw new Error(`receipt.backend is required for the ${selectedRoute} route`);
  }
  if (selectedRoute === "copilot" && backend?.kind !== "copilot") {
    throw new Error("receipt.backend.kind must be copilot for the copilot route");
  }
  if (["cheap", "deep"].includes(selectedRoute) && backend?.kind !== "external") {
    throw new Error(`receipt.backend.kind must be external for the ${selectedRoute} route`);
  }

  const dispatch = dispatchValue(receipt.dispatch);
  if (dispatch.idempotencyKey !== logicalDispatchId) {
    throw new Error("receipt.dispatch.idempotencyKey must match receipt.logicalDispatchId");
  }
  if (selectedRoute === "none" && dispatch.status !== "skipped") {
    throw new Error("receipt.dispatch.status must be skipped for the none route");
  }

  const normalized = {
    schemaVersion: PROTOCOL_SCHEMA_MAJOR,
    receiptId: stringValue(receipt.receiptId, "receipt.receiptId"),
    logicalDispatchId,
    requestFingerprint: digestValue(receipt.requestFingerprint, "receipt.requestFingerprint"),
    repository,
    pullRequestNumber,
    headSha,
    attempt,
    selectedRoute,
    backend,
    reason: stringValue(receipt.reason, "receipt.reason", { maximum: REASON_MAX_BYTES }),
    policyVersion: stringValue(receipt.policyVersion, "receipt.policyVersion", { maximum: 64 }),
    dispatch,
    correlationIds: stringArray(receipt.correlationIds, "receipt.correlationIds", {
      maximumItems: 16,
      allowEmpty: false,
    }),
  };

  if (receipt.observations !== undefined) {
    const observations = objectValue(receipt.observations, "receipt.observations");
    normalized.observations = {
      latencyMs: integerValue(observations.latencyMs, "receipt.observations.latencyMs", {
        maximum: 86_400_000,
      }),
      costTier: enumValue(observations.costTier, "receipt.observations.costTier", COST_TIERS),
    };
  }
  if (receipt.localEvidence !== undefined) {
    const localEvidence = objectValue(receipt.localEvidence, "receipt.localEvidence");
    normalized.localEvidence = {
      receiptId: stringValue(localEvidence.receiptId, "receipt.localEvidence.receiptId"),
      digest: digestValue(localEvidence.digest, "receipt.localEvidence.digest"),
      contribution: enumValue(
        localEvidence.contribution,
        "receipt.localEvidence.contribution",
        CONTRIBUTIONS,
      ),
    };
  }
  if (receipt.successorEvidence !== undefined) {
    normalized.successorEvidence = decodeSuccessorEvidence(receipt.successorEvidence);
    if (normalized.successorEvidence.currentHeadSha !== headSha) {
      throw new Error("receipt.successorEvidence.currentHeadSha must match receipt.headSha");
    }
  }
  return normalized;
}

function resolvedRoute(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const route = normalizeMode(value, field);
  if (route === "auto") throw new Error(`${field} must be a resolved route`);
  return route;
}

function weakerRoute(left, right) {
  return ROUTE_STRENGTH.get(left) <= ROUTE_STRENGTH.get(right) ? left : right;
}

function strongerRoute(left, right) {
  return ROUTE_STRENGTH.get(left) >= ROUTE_STRENGTH.get(right) ? left : right;
}

function successorMatchesRequest(evidence, request) {
  if (!request.supersedes) {
    throw new Error("successorEvidence requires request.supersedes");
  }
  if (evidence.priorReceiptId !== request.supersedes.priorReceiptId) {
    throw new Error("successorEvidence.priorReceiptId must match request.supersedes");
  }
  if (evidence.priorLogicalDispatchId !== request.supersedes.priorLogicalDispatchId) {
    throw new Error("successorEvidence.priorLogicalDispatchId must match request.supersedes");
  }
  if (evidence.priorHeadSha !== request.supersedes.priorHeadSha) {
    throw new Error("successorEvidence.priorHeadSha must match request.supersedes");
  }
  if (evidence.currentHeadSha !== request.headSha) {
    throw new Error("successorEvidence.currentHeadSha must match request.headSha");
  }
}

export function selectProtocolRoute({ request: requestValue, routingContext = {}, policy = {} }) {
  const request = decodeReviewRequest(requestValue);
  const context = objectValue(routingContext, "routingContext");
  const policyValue = objectValue(policy, "policy");
  const allowBookkeepingNone = policyValue.allowBookkeepingNone === undefined
    ? false
    : booleanValue(policyValue.allowBookkeepingNone, "policy.allowBookkeepingNone");
  const sensitiveFiles = context.sensitiveFiles === undefined
    ? []
    : stringArray(context.sensitiveFiles, "routingContext.sensitiveFiles", {
        maximumItems: 3_000,
        maximumBytes: 512,
      });
  const changedLines = integerValue(context.changedLines ?? 0, "routingContext.changedLines");
  const changedLineThreshold = integerValue(
    context.changedLineThreshold ?? 800,
    "routingContext.changedLineThreshold",
    { minimum: 1 },
  );
  if (typeof (context.confidence ?? "unknown") !== "string") {
    throw new Error("routingContext.confidence must be a string");
  }
  const confidence = normalizeConfidence(context.confidence ?? "unknown");
  const lowConfidenceRoute = resolvedRoute(
    context.lowConfidenceRoute ?? "deep",
    "routingContext.lowConfidenceRoute",
  );
  const draft = booleanValue(context.draft ?? false, "routingContext.draft");
  const reviewDrafts = booleanValue(context.reviewDrafts ?? false, "routingContext.reviewDrafts");

  const baseDecision = routeReview({
    configuredMode: request.route,
    labelMode: null,
    commandMode: null,
    eventName: "workflow_dispatch",
    eventAction: "requested",
    draft,
    reviewDrafts,
    changedLines,
    changedLineThreshold,
    sensitiveFiles,
    confidence,
    lowConfidenceRoute,
  });

  if (request.route !== "auto") {
    return {
      ...baseDecision,
      policyVersion: request.policyVersion,
      floorApplied: null,
      localEvidence: request.localReview ? "ignored-explicit" : "absent",
      successorEvidence: context.successorEvidence ? "ignored-explicit" : "absent",
    };
  }

  const configuredFloor = resolvedRoute(
    policyValue.independentReviewFloor ?? "none",
    "policy.independentReviewFloor",
  );
  const riskFloor = sensitiveFiles.length > 0 || changedLines >= changedLineThreshold
    ? "copilot"
    : "none";
  const floor = strongerRoute(configuredFloor, riskFloor);
  let route = baseDecision.route;
  const reasons = [baseDecision.reason];
  let localEvidence = request.localReview ? "ineligible" : "absent";
  let successorEvidence = context.successorEvidence ? "ineligible" : "absent";

  if (request.localReview) {
    const threshold = integerValue(
      policyValue.localConfidenceThreshold ?? 80,
      "policy.localConfidenceThreshold",
      { maximum: 100 },
    );
    const eligible = ["clean", "fully-dispositioned"].includes(request.localReview.outcome)
      && request.localReview.confidence >= threshold
      && request.localReview.dispositionCounts.unresolved === 0;
    if (eligible) {
      const target = resolvedRoute(
        policyValue.localEvidenceRoute ?? "cheap",
        "policy.localEvidenceRoute",
      );
      const reduced = weakerRoute(route, target);
      localEvidence = reduced === route ? "unchanged" : "lowered";
      route = reduced;
      reasons.push(
        localEvidence === "lowered"
          ? `eligible exact-head local evidence lowered auto to ${route}`
          : "eligible exact-head local evidence did not lower the automatic route",
      );
    } else {
      reasons.push("local evidence supplied no positive routing confidence");
    }
  }

  if (context.successorEvidence !== undefined) {
    const evidence = decodeSuccessorEvidence(context.successorEvidence);
    successorMatchesRequest(evidence, request);
    if (evidence.comparison === "bookkeeping-only" && allowBookkeepingNone) {
      route = weakerRoute(route, "none");
      successorEvidence = "lowered";
      reasons.push("trusted bookkeeping-only successor evidence selected none");
    } else {
      successorEvidence = "unchanged";
      reasons.push("successor evidence did not qualify for a lower route");
    }
  }

  const beforeFloor = route;
  route = strongerRoute(route, floor);
  const floorApplied = route === beforeFloor ? null : floor;
  if (floorApplied) {
    reasons.push(`independent-review floor required ${floorApplied}`);
  }
  return {
    route,
    reason: reasons.join("; "),
    policyVersion: request.policyVersion,
    floorApplied,
    localEvidence,
    successorEvidence,
  };
}
