// Review data retention policy contract (A-011 companion, retention scope).
//
// This module owns ONLY the versioned retention schema, the mandatory
// `standard-v1` named profile, its bounded status/purge/hold contracts, and a
// pure lifecycle/expiry computation used as a conformance fake. It never reads
// GitHub, the checkout, process state, the filesystem, the clock, or output
// files, and it never emits a side effect. Time is ALWAYS an injected parameter
// (`nowIso`) so fake-clock conformance tests are deterministic.
//
// The consumer private control plane ENFORCES these durations, executes
// deletion, manages backups, and mints legal holds. This module only DEFINES
// the schema and the deterministic computation that enforcement must match.
// GitHub-native checks, comments, and reviews stay OUTSIDE this lifecycle and
// are called out explicitly by every status and purge projection.

import { createHash } from "node:crypto";

export const RETENTION_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 16 * 1024;
const RESPONSE_MAX_BYTES = 32 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const REASON_MAX_BYTES = 512;
const MAX_COLLECTION_ITEMS = 32;
const MAX_NESTING_DEPTH = 32;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

// --- controlled vocabularies -----------------------------------------------

// Every stored record carries exactly one of these data classes. A record that
// declares more than one class fails closed (it never selects the longer one).
export const RETENTION_DATA_CLASSES = Object.freeze([
  "prohibited_content",
  "operational_state",
  "deferred_review",
  "budget_observation",
  "bounded_event",
  "adjudication_chain",
  "catalog_policy_version",
  "static_prompt_profile",
  "anonymous_aggregate",
  "backup",
]);
const RETENTION_DATA_CLASS_SET = new Set(RETENTION_DATA_CLASSES);

// Lifecycle states shared by the normal aging path plus the purge path.
export const RETENTION_LIFECYCLE_STATES = Object.freeze([
  "active",
  "terminal",
  "compacted",
  "deleted",
  "purge_pending",
  "live_deleted",
  "backup_expired",
]);
const RETENTION_LIFECYCLE_STATE_SET = new Set(RETENTION_LIFECYCLE_STATES);

// A deferred review reaches this visible terminal state when its actionable
// window elapses without a review.
export const DEFERRED_EXPIRED_STATE = "expired_unreviewed";
// An unresolved operational attempt reaches this visible terminal state at its
// active maximum.
export const UNRESOLVED_EXPIRED_STATE = "expired_unknown";
export const RECORD_TERMINAL_STATES = Object.freeze([
  DEFERRED_EXPIRED_STATE,
  UNRESOLVED_EXPIRED_STATE,
]);
const RECORD_TERMINAL_STATE_SET = new Set(RECORD_TERMINAL_STATES);

// A deferred review may go terminal early through an explicit resolution.
export const DEFERRED_RESOLUTIONS = Object.freeze([
  "recovered",
  "superseded",
  "pr_closed",
]);
const DEFERRED_RESOLUTION_SET = new Set(DEFERRED_RESOLUTIONS);

export const LEGAL_HOLD_STATES = Object.freeze([
  "active",
  "released",
  "expired",
  "renewed",
]);
const LEGAL_HOLD_STATE_SET = new Set(LEGAL_HOLD_STATES);

export const DELETION_STATUSES = Object.freeze([
  "not_requested",
  "purge_pending",
  "live_deleted",
  "backup_expired",
  "complete",
]);
const DELETION_STATUS_SET = new Set(DELETION_STATUSES);

export const REPOSITORY_LIFECYCLE_KINDS = Object.freeze([
  "uninstall",
  "removal",
  "transfer_same_tenant",
  "transfer_cross_tenant",
  "authorized_purge",
]);
const REPOSITORY_LIFECYCLE_KIND_SET = new Set(REPOSITORY_LIFECYCLE_KINDS);

// Forbidden content field names. These protect prompt bodies, diffs, source,
// raw findings, model output, provider payloads, and raw billing payloads from
// ever entering a persisted retention record or a public response. Checked
// after case/separator normalization, before any canonicalization.
const FORBIDDEN_CONTENT_FIELDS = new Set([
  "prompt",
  "prompts",
  "promptbody",
  "promptbodies",
  "profilebody",
  "profilebodies",
  "renderedprompt",
  "renderedprompts",
  "diff",
  "diffs",
  "source",
  "sourcetext",
  "finding",
  "findings",
  "rawfinding",
  "rawfindings",
  "modeloutput",
  "output",
  "outputs",
  "transcript",
  "transcripts",
  "providerpayload",
  "providerpayloads",
  "rawpayload",
  "rawpayloads",
  "billingpayload",
  "billingpayloads",
  "rawbilling",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "token",
  "tokens",
  "apikey",
  "apikeys",
  "rawbalance",
  "rawbalances",
  "privatepolicy",
  "managementendpoint",
  "content",
  "contents",
  "requestcontent",
]);

// Identifying field names stripped from anonymous aggregates and rejected from
// static prompt-profile configuration (which must carry no PR-specific data).
const IDENTIFYING_FIELDS = new Set([
  "repository",
  "repositoryid",
  "repo",
  "owner",
  "pullrequest",
  "pullrequestnumber",
  "prnumber",
  "pr",
  "headsha",
  "attempt",
  "attemptid",
  "findingid",
  "actor",
  "candidateactor",
  "provideraccount",
  "provideraccountid",
]);

// Authority fields a purge request may never carry: purge never grants ledger,
// dispatch, or recovery authority.
const PURGE_FORBIDDEN_AUTHORITY = Object.freeze([
  "ledgerAuthority",
  "dispatchAuthority",
  "recoveryAuthority",
  "grantLedger",
  "grantDispatch",
  "grantRecovery",
]);

// --- primitive validators (matching protocol-v2 semantics) -----------------

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

// Parameterized privacy/anonymization boundary walker. Names the field and the
// boundary only; never echoes the offending value.
function rejectFieldNames(value, field, forbidden, boundaryLabel) {
  const seen = new WeakSet();
  const pending = [{ value, field, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > MAX_NESTING_DEPTH) {
      throw new Error(`${current.field} exceeds the ${MAX_NESTING_DEPTH}-level nesting limit`);
    }
    if (current.value === null) continue;
    if (typeof current.value !== "object") {
      if (
        !["string", "number", "boolean"].includes(typeof current.value)
        || (typeof current.value === "number" && !Number.isFinite(current.value))
      ) {
        throw new Error(`${current.field} must contain JSON values only`);
      }
      continue;
    }
    if (seen.has(current.value)) {
      throw new Error(`${current.field} must not contain repeated object references or circular data`);
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          field: `${current.field}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!isPlainObject(current.value)) {
      throw new Error(`${current.field} must contain plain JSON objects only`);
    }
    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, item] = entries[index];
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (forbidden.has(normalizedKey)) {
        throw new Error(`${current.field}.${key} is forbidden by the ${boundaryLabel}`);
      }
      pending.push({
        value: item,
        field: `${current.field}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
}

// Reject any prompt/diff/source/finding/output/credential/provider/billing body.
function rejectForbiddenContent(value, field) {
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "retention privacy boundary");
}

// Reject any repository/PR/attempt/finding/actor/provider identifier.
function rejectIdentifyingFields(value, field) {
  rejectFieldNames(value, field, IDENTIFYING_FIELDS, "retention anonymization boundary");
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
  const normalized = stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES });
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

function trueValue(value, field) {
  if (value !== true) {
    throw new Error(`${field} must be explicitly true`);
  }
  return true;
}

function schemaVersion(value, field) {
  if (value !== RETENTION_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${RETENTION_SCHEMA_MAJOR}`);
  }
  return value;
}

function digestValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-fA-F0-9]{64}$/u, lower: true });
}

function semverLikeValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[0-9]+\.[0-9]+\.[0-9]+$/u });
}

function aliasValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u, lower: true });
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

function optionalTimestamp(value, field) {
  return value === undefined ? undefined : timestampValue(value, field);
}

function dataClassArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must scope at least one data class`);
  }
  if (value.length > RETENTION_DATA_CLASSES.length) {
    throw new Error(`${field} exceeds the ${RETENTION_DATA_CLASSES.length}-class limit`);
  }
  const normalized = value.map((item, index) =>
    enumValue(item, `${field}[${index}]`, RETENTION_DATA_CLASS_SET));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a data class`);
  }
  return normalized.sort();
}

function repositoryValue(value, field) {
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

// --- canonicalization + deterministic digest -------------------------------

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function stableRetentionJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableRetentionJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered
// equivalent input produces the same digest; any changed field changes it.
export function deriveRetentionDigest(fields) {
  return sha256(canonicalize(fields));
}

// --- calendar-aware UTC math -----------------------------------------------

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString();
}

function addHours(iso, hours) {
  return new Date(Date.parse(iso) + hours * MS_PER_HOUR).toISOString();
}

// Calendar month addition with end-of-month clamping (adding 1 month to
// Jan 31 lands on the last day of February, honoring leap years).
function addMonths(iso, months) {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const lastDayOfTarget = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(date.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    clampedDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  )).toISOString();
}

// --- the standard-v1 named profile -----------------------------------------

const STANDARD_V1_CLASSES = {
  prohibited_content: {
    persist: false,
    crashCleanupHours: 24,
    finalForm: "none",
  },
  operational_state: {
    activeMaxDays: 180,
    terminalDays: 90,
    unresolvedExpiredState: UNRESOLVED_EXPIRED_STATE,
    finalForm: "bounded_receipt",
  },
  deferred_review: {
    activeMaxDays: 180,
    terminalDays: 30,
    expiredState: DEFERRED_EXPIRED_STATE,
    finalForm: "bounded_receipt",
  },
  budget_observation: {
    terminalDays: 90,
    finalForm: "coverage_aggregate",
  },
  bounded_event: {
    retentionMonths: 13,
    finalForm: "deleted",
  },
  adjudication_chain: {
    retentionMonths: 13,
    chainScoped: true,
    finalForm: "coverage_aggregate",
  },
  catalog_policy_version: {
    referenceGraceMonths: 13,
    finalForm: "digest_only",
  },
  static_prompt_profile: {
    referenceGraceMonths: 13,
    prohibitsPrContent: true,
    finalForm: "digest_only",
  },
  anonymous_aggregate: {
    retentionMonths: 25,
    nonIdentifying: true,
    finalForm: "deleted",
  },
  backup: {
    hardMaxDays: 35,
    finalForm: "deleted",
  },
};

function buildStandardV1() {
  const body = {
    retentionPolicyId: "standard-v1",
    version: "1.0.0",
    schemaMajor: RETENTION_SCHEMA_MAJOR,
    livePurgeSlaDays: 7,
    backupHardMaxDays: 35,
    classes: STANDARD_V1_CLASSES,
  };
  const digest = deriveRetentionDigest(body);
  const classes = {};
  for (const [name, rule] of Object.entries(STANDARD_V1_CLASSES)) {
    classes[name] = Object.freeze({ ...rule });
  }
  return Object.freeze({ ...body, classes: Object.freeze(classes), digest });
}

export const STANDARD_V1 = buildStandardV1();

function classRule(dataClass, profile = STANDARD_V1) {
  const rule = profile.classes[dataClass];
  if (!rule) {
    throw new Error(`retentionProfile has no rule for data class ${dataClass}`);
  }
  return rule;
}

// --- profile decoder --------------------------------------------------------

export function decodeRetentionProfile(value) {
  rejectForbiddenContent(value, "retentionProfile");
  assertEncodedSize(value, "retentionProfile", CONTRACT_MAX_BYTES);
  const profile = objectValue(value, "retentionProfile");
  schemaVersion(profile.schemaMajor, "retentionProfile.schemaMajor");
  const retentionPolicyId = aliasValue(profile.retentionPolicyId, "retentionProfile.retentionPolicyId");
  const version = semverLikeValue(profile.version, "retentionProfile.version");
  const livePurgeSlaDays = integerValue(profile.livePurgeSlaDays, "retentionProfile.livePurgeSlaDays", {
    minimum: 1,
    maximum: 365,
  });
  const backupHardMaxDays = integerValue(profile.backupHardMaxDays, "retentionProfile.backupHardMaxDays", {
    minimum: 1,
    maximum: 365,
  });
  const classesInput = objectValue(profile.classes, "retentionProfile.classes");
  const classes = {};
  for (const dataClass of RETENTION_DATA_CLASSES) {
    const rule = classesInput[dataClass];
    if (rule === undefined) {
      throw new Error(`retentionProfile.classes must define the ${dataClass} class`);
    }
    const ruleObject = objectValue(rule, `retentionProfile.classes.${dataClass}`);
    const normalizedRule = {};
    for (const [key, item] of Object.entries(ruleObject)) {
      if (typeof item === "number") {
        normalizedRule[key] = integerValue(item, `retentionProfile.classes.${dataClass}.${key}`, {
          maximum: 100_000,
        });
      } else if (typeof item === "boolean") {
        normalizedRule[key] = item;
      } else if (typeof item === "string") {
        normalizedRule[key] = stringValue(item, `retentionProfile.classes.${dataClass}.${key}`);
      } else {
        throw new Error(`retentionProfile.classes.${dataClass}.${key} must be a scalar rule value`);
      }
    }
    classes[dataClass] = Object.freeze(normalizedRule);
  }
  for (const key of Object.keys(classesInput)) {
    if (!RETENTION_DATA_CLASS_SET.has(key)) {
      throw new Error(`retentionProfile.classes.${key} is not a known data class`);
    }
  }
  const body = {
    retentionPolicyId,
    version,
    schemaMajor: RETENTION_SCHEMA_MAJOR,
    livePurgeSlaDays,
    backupHardMaxDays,
    classes,
  };
  const digest = deriveRetentionDigest(body);
  if (profile.digest !== undefined && digestValue(profile.digest, "retentionProfile.digest") !== digest) {
    throw new Error("retentionProfile.digest does not match its canonical content");
  }
  return Object.freeze({ ...body, classes: Object.freeze(classes), digest });
}

// --- policy binding shared by bounded contracts ----------------------------

function decodePolicyBinding(source, field, { requireDigestMatch = false } = {}) {
  const retentionPolicyId = aliasValue(source.retentionPolicyId, `${field}.retentionPolicyId`);
  const version = semverLikeValue(source.version, `${field}.version`);
  const digest = digestValue(source.digest, `${field}.digest`);
  if (requireDigestMatch && retentionPolicyId === STANDARD_V1.retentionPolicyId) {
    if (version !== STANDARD_V1.version || digest !== STANDARD_V1.digest) {
      throw new Error(`${field} standard-v1 binding must match the canonical version and digest`);
    }
  }
  return { retentionPolicyId, version, digest };
}

// --- record classification --------------------------------------------------

// Decode one stored record's classification. A record declares EXACTLY one data
// class. Multiple markers (`dataClasses`, a second class field) fail closed —
// the decoder never resolves a conflict by selecting the longer duration. A
// prohibited-content record may exist only as an ephemeral crash-cleanup marker
// and may never carry a persisted body.
export function decodeRecordClassification(value) {
  rejectForbiddenContent(value, "recordClassification");
  assertEncodedSize(value, "recordClassification", CONTRACT_MAX_BYTES);
  const record = objectValue(value, "recordClassification");
  if (record.dataClasses !== undefined) {
    throw new Error("recordClassification must declare a single dataClass, not a dataClasses set");
  }
  if (record.secondaryDataClass !== undefined) {
    throw new Error("recordClassification must declare a single dataClass; a conflicting classification fails closed");
  }
  const dataClass = enumValue(record.dataClass, "recordClassification.dataClass", RETENTION_DATA_CLASS_SET);
  const createdAt = timestampValue(record.createdAt, "recordClassification.createdAt");
  const policy = decodePolicyBinding(record, "recordClassification");
  const normalized = {
    dataClass,
    createdAt,
    coverageStart: optionalTimestamp(record.coverageStart, "recordClassification.coverageStart") ?? createdAt,
    ...policy,
  };
  if (record.coverageEnd !== undefined) {
    normalized.coverageEnd = timestampValue(record.coverageEnd, "recordClassification.coverageEnd");
  }
  if (record.recordId !== undefined) {
    normalized.recordId = digestValue(record.recordId, "recordClassification.recordId");
  }
  if (dataClass === "prohibited_content") {
    // Prohibited content is never persisted. The only valid prohibited record is
    // an ephemeral crash-cleanup marker with no body (the content walker already
    // rejects any body field).
    if (record.ephemeral !== true) {
      throw new Error("recordClassification prohibited_content must not be persisted; only an ephemeral crash-cleanup marker is permitted");
    }
    normalized.ephemeral = true;
  }
  if (dataClass === "static_prompt_profile") {
    // Static prompt-profile configuration is a separate allowed class that must
    // contain no PR-specific content.
    rejectIdentifyingFields(record, "recordClassification");
  }
  if (dataClass === "operational_state" || dataClass === "deferred_review") {
    if (record.terminalAt !== undefined) {
      normalized.terminalAt = timestampValue(record.terminalAt, "recordClassification.terminalAt");
    }
  }
  if (dataClass === "deferred_review" && record.resolution !== undefined) {
    normalized.resolution = enumValue(record.resolution, "recordClassification.resolution", DEFERRED_RESOLUTION_SET);
    if (normalized.terminalAt === undefined) {
      throw new Error("recordClassification deferred_review resolution requires terminalAt");
    }
  }
  if (dataClass === "adjudication_chain") {
    normalized.newestEventAt = optionalTimestamp(record.newestEventAt, "recordClassification.newestEventAt")
      ?? createdAt;
  }
  if (dataClass === "catalog_policy_version" || dataClass === "static_prompt_profile") {
    normalized.referenced = record.referenced === undefined
      ? true
      : booleanValue(record.referenced, "recordClassification.referenced");
    if (!normalized.referenced) {
      normalized.lastReferencedAt = optionalTimestamp(
        record.lastReferencedAt,
        "recordClassification.lastReferencedAt",
      ) ?? createdAt;
    } else if (record.lastReferencedAt !== undefined) {
      throw new Error("recordClassification.lastReferencedAt is valid only once the version is no longer referenced");
    }
  }
  return Object.freeze(normalized);
}

// --- legal hold -------------------------------------------------------------

// A legal hold is tenant/repository/data-class scoped, actor- and reason-bound,
// authorized, and expiration-bound. Renewal is explicit (a renewed hold names
// the prior hold). A release is explicit. A hold pauses only covered live
// deletion timers; it never rehydrates deleted data.
export function decodeLegalHold(value) {
  rejectForbiddenContent(value, "legalHold");
  assertEncodedSize(value, "legalHold", CONTRACT_MAX_BYTES);
  const hold = objectValue(value, "legalHold");
  schemaVersion(hold.schemaVersion, "legalHold.schemaVersion");
  const state = enumValue(hold.state, "legalHold.state", LEGAL_HOLD_STATE_SET);
  const startAt = timestampValue(hold.startAt, "legalHold.startAt");
  const expiresAt = timestampValue(hold.expiresAt, "legalHold.expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(startAt)) {
    throw new Error("legalHold.expiresAt must be after startAt");
  }
  const normalized = {
    schemaVersion: RETENTION_SCHEMA_MAJOR,
    holdId: digestValue(hold.holdId, "legalHold.holdId"),
    tenant: aliasValue(hold.tenant, "legalHold.tenant"),
    repository: repositoryValue(hold.repository, "legalHold.repository"),
    dataClasses: dataClassArray(hold.dataClasses, "legalHold.dataClasses"),
    actor: aliasValue(hold.actor, "legalHold.actor"),
    reason: stringValue(hold.reason, "legalHold.reason", { maximum: REASON_MAX_BYTES }),
    authorization: aliasValue(hold.authorization, "legalHold.authorization"),
    state,
    startAt,
    expiresAt,
  };
  if (state === "released") {
    normalized.releasedAt = timestampValue(hold.releasedAt, "legalHold.releasedAt");
    if (Date.parse(normalized.releasedAt) < Date.parse(startAt)) {
      throw new Error("legalHold.releasedAt must not precede startAt");
    }
  } else if (hold.releasedAt !== undefined) {
    throw new Error("legalHold.releasedAt is valid only for a released hold");
  }
  if (state === "renewed") {
    normalized.renewedFromHoldId = digestValue(hold.renewedFromHoldId, "legalHold.renewedFromHoldId");
  } else if (hold.renewedFromHoldId !== undefined) {
    throw new Error("legalHold.renewedFromHoldId is valid only for a renewed hold");
  }
  return Object.freeze(normalized);
}

function holdCovers(hold, dataClass) {
  return hold.dataClasses.includes(dataClass);
}

// The moment a hold stops pausing timers: an explicit release, otherwise expiry.
function holdEndMs(hold) {
  return Date.parse(hold.releasedAt ?? hold.expiresAt);
}

// Apply a covered hold to a deletion deadline. The hold preserves the time
// remaining at hold start and resumes it from the hold's end; it never restarts
// a full retention period and never rehydrates an already-due deletion.
function applyHold(retainedUntil, dataClass, hold, nowMs) {
  if (!hold || retainedUntil === null || !holdCovers(hold, dataClass)) {
    return { retainedUntil, holdPaused: false };
  }
  const startMs = Date.parse(hold.startAt);
  const untilMs = Date.parse(retainedUntil);
  const remainingMs = untilMs - startMs;
  if (remainingMs <= 0) {
    // Deletion was already due before the hold began; a hold cannot rehydrate it.
    return { retainedUntil, holdPaused: false };
  }
  if (nowMs < startMs) {
    return { retainedUntil, holdPaused: false };
  }
  const endMs = holdEndMs(hold);
  if (nowMs < endMs) {
    // Actively held: the covered deletion timer is paused, so no deletion date
    // is currently owed.
    return { retainedUntil: null, holdPaused: true };
  }
  // Hold ended: resume the remaining timer from the release/expiry moment.
  return { retainedUntil: new Date(endMs + remainingMs).toISOString(), holdPaused: false };
}

// --- lifecycle / expiry computation -----------------------------------------

// Compute the base deletion deadline and any visible terminal state for a
// classified record, before any legal hold. Returns { retainedUntil, terminalStart,
// terminalState, postExpiryState } where retainedUntil is null when the record is
// retained indefinitely (a still-referenced catalog/profile version).
function computeBaseSchedule(record, nowMs, profile) {
  const { dataClass } = record;
  const rule = classRule(dataClass, profile);
  const coverageStart = record.coverageStart;
  switch (dataClass) {
    case "prohibited_content": {
      return {
        retainedUntil: addHours(record.createdAt, rule.crashCleanupHours),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "active",
      };
    }
    case "operational_state": {
      const activeMaxUntil = addDays(coverageStart, rule.activeMaxDays);
      let terminalStart = record.terminalAt ?? null;
      let terminalState;
      if (!terminalStart && nowMs >= Date.parse(activeMaxUntil)) {
        terminalStart = activeMaxUntil;
        terminalState = rule.unresolvedExpiredState;
      }
      const retainedUntil = terminalStart ? addDays(terminalStart, rule.terminalDays) : null;
      return { retainedUntil, terminalStart, terminalState, postExpiryState: "compacted", activeState: "active" };
    }
    case "deferred_review": {
      const activeMaxUntil = addDays(coverageStart, rule.activeMaxDays);
      let terminalStart = record.terminalAt ?? null;
      let terminalState;
      if (!terminalStart && nowMs >= Date.parse(activeMaxUntil)) {
        terminalStart = activeMaxUntil;
        terminalState = rule.expiredState;
      }
      const retainedUntil = terminalStart ? addDays(terminalStart, rule.terminalDays) : null;
      return { retainedUntil, terminalStart, terminalState, postExpiryState: "compacted", activeState: "active" };
    }
    case "budget_observation": {
      return {
        retainedUntil: addDays(coverageStart, rule.terminalDays),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "active",
      };
    }
    case "bounded_event": {
      return {
        retainedUntil: addMonths(coverageStart, rule.retentionMonths),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "active",
      };
    }
    case "adjudication_chain": {
      // The whole correction/conflict chain expires as one unit relative to its
      // newest event.
      return {
        retainedUntil: addMonths(record.newestEventAt, rule.retentionMonths),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "active",
      };
    }
    case "catalog_policy_version":
    case "static_prompt_profile": {
      if (record.referenced) {
        return {
          retainedUntil: null,
          terminalStart: null,
          terminalState: undefined,
          postExpiryState: "deleted",
          activeState: "active",
        };
      }
      return {
        retainedUntil: addMonths(record.lastReferencedAt, rule.referenceGraceMonths),
        terminalStart: record.lastReferencedAt,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "terminal",
      };
    }
    case "anonymous_aggregate": {
      return {
        retainedUntil: addMonths(coverageStart, rule.retentionMonths),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "deleted",
        activeState: "active",
      };
    }
    case "backup": {
      return {
        retainedUntil: addDays(record.createdAt, rule.hardMaxDays),
        terminalStart: null,
        terminalState: undefined,
        postExpiryState: "backup_expired",
        activeState: "active",
      };
    }
    default:
      throw new Error(`unhandled retention data class ${dataClass}`);
  }
}

// Pure lifecycle projection for one classified record at an injected instant.
// `nowIso` is required; the module never reads a clock. An optional decoded
// legal `hold` pauses a covered deletion timer.
export function computeRecordLifecycle(record, { nowIso, hold, profile = STANDARD_V1 } = {}) {
  if (!isPlainObject(record) || !RETENTION_DATA_CLASS_SET.has(record.dataClass)) {
    throw new Error("computeRecordLifecycle requires a decoded record classification");
  }
  const now = timestampValue(nowIso, "nowIso");
  const nowMs = Date.parse(now);
  const decodedHold = hold === undefined || hold === null ? null : hold;
  const base = computeBaseSchedule(record, nowMs, profile);
  const { retainedUntil: heldUntil, holdPaused } = applyHold(base.retainedUntil, record.dataClass, decodedHold, nowMs);

  let lifecycleState;
  if (holdPaused) {
    // A covered hold blocks deletion: the record stays in a pre-deletion state.
    lifecycleState = base.terminalStart ? "terminal" : "active";
  } else if (heldUntil === null) {
    lifecycleState = base.activeState;
  } else if (nowMs < Date.parse(heldUntil)) {
    lifecycleState = base.terminalStart ? "terminal" : base.activeState;
  } else {
    lifecycleState = base.postExpiryState;
  }

  const rule = classRule(record.dataClass, profile);
  return Object.freeze({
    dataClass: record.dataClass,
    retentionPolicyId: record.retentionPolicyId,
    version: record.version,
    digest: record.digest,
    lifecycleState,
    retainedUntil: holdPaused ? null : heldUntil,
    nextDeletionAt: holdPaused ? null : heldUntil,
    terminalState: base.terminalState,
    holdPaused,
    finalForm: rule.finalForm,
  });
}

// --- coverage-aware reporting ----------------------------------------------

// Partition a data-class denominator into eligible/retained/expired/purged/
// unknown so a report can never present expired or purged evidence as a
// complete denominator. `complete` is true only when nothing was lost.
export function summarizeCoverage(value) {
  const counts = objectValue(value, "coverage");
  const eligible = integerValue(counts.eligible, "coverage.eligible", { maximum: 1_000_000_000 });
  const retained = integerValue(counts.retained, "coverage.retained", { maximum: 1_000_000_000 });
  const expired = integerValue(counts.expired, "coverage.expired", { maximum: 1_000_000_000 });
  const purged = integerValue(counts.purged, "coverage.purged", { maximum: 1_000_000_000 });
  const unknown = integerValue(counts.unknown, "coverage.unknown", { maximum: 1_000_000_000 });
  if (retained + expired + purged + unknown !== eligible) {
    throw new Error("coverage buckets must partition the eligible denominator exactly");
  }
  return Object.freeze({
    eligible,
    retained,
    expired,
    purged,
    unknown,
    complete: expired === 0 && purged === 0 && unknown === 0,
  });
}

// Build an anonymous 25-month aggregate. Every repository/PR/attempt/finding/
// actor/candidate-actor/provider-account identifier is rejected before the
// aggregate is formed, and the aggregate stays coverage-aware so retention or
// deletion cannot silently improve a metric.
export function buildAnonymousAggregate(value) {
  const source = objectValue(value, "anonymousAggregate");
  rejectForbiddenContent(source.metrics ?? {}, "anonymousAggregate.metrics");
  rejectIdentifyingFields(source, "anonymousAggregate");
  const metrics = objectValue(source.metrics, "anonymousAggregate.metrics");
  const normalizedMetrics = {};
  for (const [key, item] of Object.entries(metrics)) {
    normalizedMetrics[key] = integerValue(item, `anonymousAggregate.metrics.${key}`, {
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  }
  return Object.freeze({
    dataClass: "anonymous_aggregate",
    windowStart: timestampValue(source.windowStart, "anonymousAggregate.windowStart"),
    windowEnd: timestampValue(source.windowEnd, "anonymousAggregate.windowEnd"),
    metrics: Object.freeze(normalizedMetrics),
    coverage: summarizeCoverage(source.coverage),
    nonIdentifying: true,
  });
}

// --- bounded status contracts ----------------------------------------------

function decodeGithubNativeArtifacts(value, field) {
  const artifacts = objectValue(value, field);
  const managed = booleanValue(artifacts.managed, `${field}.managed`);
  const autoDeleted = booleanValue(artifacts.autoDeleted, `${field}.autoDeleted`);
  if (managed !== false || autoDeleted !== false) {
    throw new Error(`${field} must declare GitHub-native artifacts as unmanaged and never auto-deleted`);
  }
  return {
    managed: false,
    autoDeleted: false,
    note: stringValue(artifacts.note, `${field}.note`, { maximum: REASON_MAX_BYTES }),
  };
}

// The bounded per-record retention status projection. It carries only
// identities, a lifecycle state, the deletion deadline, hold status, deletion
// status, coverage window, and (optionally) bounded last-deletion evidence.
// GitHub-native artifacts are always separately called out as unmanaged.
export function decodeRetentionStatus(value) {
  rejectForbiddenContent(value, "retentionStatus");
  assertEncodedSize(value, "retentionStatus", CONTRACT_MAX_BYTES);
  const status = objectValue(value, "retentionStatus");
  schemaVersion(status.schemaVersion, "retentionStatus.schemaVersion");
  const policy = decodePolicyBinding(status, "retentionStatus", { requireDigestMatch: true });
  const dataClass = enumValue(status.dataClass, "retentionStatus.dataClass", RETENTION_DATA_CLASS_SET);
  const lifecycleState = enumValue(status.lifecycleState, "retentionStatus.lifecycleState", RETENTION_LIFECYCLE_STATE_SET);
  const deletionStatus = enumValue(status.deletionStatus, "retentionStatus.deletionStatus", DELETION_STATUS_SET);
  const legalHoldInput = objectValue(status.legalHold, "retentionStatus.legalHold");
  const held = booleanValue(legalHoldInput.held, "retentionStatus.legalHold.held");
  const legalHold = { held };
  if (held) {
    legalHold.expiresAt = timestampValue(legalHoldInput.expiresAt, "retentionStatus.legalHold.expiresAt");
  } else if (legalHoldInput.expiresAt !== undefined) {
    throw new Error("retentionStatus.legalHold.expiresAt is valid only when a hold is held");
  }
  const normalized = {
    schemaVersion: RETENTION_SCHEMA_MAJOR,
    ...policy,
    dataClass,
    lifecycleState,
    deletionStatus,
    legalHold,
    coverageStart: timestampValue(status.coverageStart, "retentionStatus.coverageStart"),
    githubNativeArtifacts: decodeGithubNativeArtifacts(
      status.githubNativeArtifacts,
      "retentionStatus.githubNativeArtifacts",
    ),
  };
  if (status.coverageEnd !== undefined) {
    normalized.coverageEnd = timestampValue(status.coverageEnd, "retentionStatus.coverageEnd");
  }
  // `retainedUntil` may be null for an indefinitely retained referenced version
  // or a currently held record.
  if (status.retainedUntil === null) {
    normalized.retainedUntil = null;
  } else {
    normalized.retainedUntil = timestampValue(status.retainedUntil, "retentionStatus.retainedUntil");
  }
  if (status.lastDeletion !== undefined) {
    const evidence = objectValue(status.lastDeletion, "retentionStatus.lastDeletion");
    normalized.lastDeletion = {
      deletionReceiptDigest: digestValue(evidence.deletionReceiptDigest, "retentionStatus.lastDeletion.deletionReceiptDigest"),
      deletedAt: timestampValue(evidence.deletedAt, "retentionStatus.lastDeletion.deletedAt"),
    };
  }
  return Object.freeze(normalized);
}

// The bounded aggregate status report: retained counts and next deletion by
// class, active holds, coverage gaps, live-purge state, the backup purge
// deadline, and a separate unmanaged GitHub-native artifact statement.
export function decodeRetentionStatusReport(value) {
  rejectForbiddenContent(value, "retentionStatusReport");
  assertEncodedSize(value, "retentionStatusReport", RESPONSE_MAX_BYTES);
  const report = objectValue(value, "retentionStatusReport");
  schemaVersion(report.schemaVersion, "retentionStatusReport.schemaVersion");
  const policy = decodePolicyBinding(report, "retentionStatusReport", { requireDigestMatch: true });
  const generatedAt = timestampValue(report.generatedAt, "retentionStatusReport.generatedAt");
  if (!Array.isArray(report.classes) || report.classes.length === 0) {
    throw new Error("retentionStatusReport.classes must be a non-empty array");
  }
  if (report.classes.length > RETENTION_DATA_CLASSES.length) {
    throw new Error(`retentionStatusReport.classes exceeds the ${RETENTION_DATA_CLASSES.length}-class limit`);
  }
  const seenClasses = new Set();
  const classes = report.classes.map((entry, index) => {
    const field = `retentionStatusReport.classes[${index}]`;
    const item = objectValue(entry, field);
    const dataClass = enumValue(item.dataClass, `${field}.dataClass`, RETENTION_DATA_CLASS_SET);
    if (seenClasses.has(dataClass)) {
      throw new Error(`${field}.dataClass ${dataClass} is duplicated`);
    }
    seenClasses.add(dataClass);
    const projected = {
      dataClass,
      retainedCount: integerValue(item.retainedCount, `${field}.retainedCount`, { maximum: 1_000_000_000 }),
      coverage: summarizeCoverage(item.coverage),
    };
    projected.nextDeletionAt = item.nextDeletionAt === null || item.nextDeletionAt === undefined
      ? null
      : timestampValue(item.nextDeletionAt, `${field}.nextDeletionAt`);
    return projected;
  });
  classes.sort((left, right) => (left.dataClass < right.dataClass ? -1 : left.dataClass > right.dataClass ? 1 : 0));

  const holdsInput = report.holds === undefined ? [] : report.holds;
  if (!Array.isArray(holdsInput)) {
    throw new Error("retentionStatusReport.holds must be an array");
  }
  if (holdsInput.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`retentionStatusReport.holds exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const holds = holdsInput.map((entry, index) => {
    const field = `retentionStatusReport.holds[${index}]`;
    const item = objectValue(entry, field);
    return {
      holdId: digestValue(item.holdId, `${field}.holdId`),
      dataClasses: dataClassArray(item.dataClasses, `${field}.dataClasses`),
      expiresAt: timestampValue(item.expiresAt, `${field}.expiresAt`),
    };
  });

  const coverageGapsInput = report.coverageGaps === undefined ? [] : report.coverageGaps;
  if (!Array.isArray(coverageGapsInput)) {
    throw new Error("retentionStatusReport.coverageGaps must be an array");
  }
  if (coverageGapsInput.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`retentionStatusReport.coverageGaps exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const coverageGaps = coverageGapsInput.map((entry, index) => {
    const field = `retentionStatusReport.coverageGaps[${index}]`;
    const item = objectValue(entry, field);
    return {
      dataClass: enumValue(item.dataClass, `${field}.dataClass`, RETENTION_DATA_CLASS_SET),
      reason: stringValue(item.reason, `${field}.reason`, { maximum: REASON_MAX_BYTES }),
    };
  });

  const normalized = {
    schemaVersion: RETENTION_SCHEMA_MAJOR,
    ...policy,
    generatedAt,
    classes,
    holds,
    coverageGaps,
    githubNativeArtifacts: decodeGithubNativeArtifacts(
      report.githubNativeArtifacts,
      "retentionStatusReport.githubNativeArtifacts",
    ),
  };
  if (report.livePurge !== undefined) {
    const livePurge = objectValue(report.livePurge, "retentionStatusReport.livePurge");
    normalized.livePurge = {
      state: enumValue(livePurge.state, "retentionStatusReport.livePurge.state", DELETION_STATUS_SET),
      deadline: timestampValue(livePurge.deadline, "retentionStatusReport.livePurge.deadline"),
    };
  }
  if (report.backupPurgeDeadline !== undefined) {
    normalized.backupPurgeDeadline = timestampValue(
      report.backupPurgeDeadline,
      "retentionStatusReport.backupPurgeDeadline",
    );
  }
  return Object.freeze(normalized);
}

// --- purge request + deterministic deletion receipt -------------------------

// Decode an idempotent `purge_repository_data` request. It requires tenant and
// repository authorization, an actor, a reason, explicit confirmation, and a
// request identity, and it yields a deterministic deletion receipt. It never
// grants ledger, dispatch, or recovery authority, and it never touches the
// GitHub-native artifacts it explicitly calls out.
export function decodePurgeRequest(value) {
  rejectForbiddenContent(value, "purgeRequest");
  assertEncodedSize(value, "purgeRequest", CONTRACT_MAX_BYTES);
  const request = objectValue(value, "purgeRequest");
  schemaVersion(request.schemaVersion, "purgeRequest.schemaVersion");
  for (const forbidden of PURGE_FORBIDDEN_AUTHORITY) {
    if (request[forbidden] !== undefined) {
      throw new Error(`purgeRequest.${forbidden} is forbidden; a purge never grants ledger, dispatch, or recovery authority`);
    }
  }
  const authorization = objectValue(request.authorization, "purgeRequest.authorization");
  const tenant = aliasValue(authorization.tenant, "purgeRequest.authorization.tenant");
  const repository = repositoryValue(authorization.repository, "purgeRequest.authorization.repository");
  const actor = aliasValue(request.actor, "purgeRequest.actor");
  const reason = stringValue(request.reason, "purgeRequest.reason", { maximum: REASON_MAX_BYTES });
  const requestId = digestValue(request.requestId, "purgeRequest.requestId");
  trueValue(request.confirmed, "purgeRequest.confirmed");
  const requestedAt = timestampValue(request.requestedAt, "purgeRequest.requestedAt");
  const liveDeletionDeadline = addDays(requestedAt, STANDARD_V1.livePurgeSlaDays);
  const backupPurgeDeadline = addDays(requestedAt, STANDARD_V1.backupHardMaxDays);
  // The receipt digest is deterministic over the authorized identity: an
  // idempotent replay of the same request reproduces the same receipt.
  const deletionReceiptDigest = deriveRetentionDigest({
    tenant,
    repository,
    actor,
    reason,
    requestId,
    requestedAt,
  });
  return Object.freeze({
    schemaVersion: RETENTION_SCHEMA_MAJOR,
    authorization: { tenant, repository },
    actor,
    reason,
    requestId,
    confirmed: true,
    requestedAt,
    liveDeletionDeadline,
    backupPurgeDeadline,
    deletionStatus: "purge_pending",
    grantsLedgerAuthority: false,
    grantsDispatchAuthority: false,
    grantsRecoveryAuthority: false,
    deletionReceipt: Object.freeze({
      deletionReceiptDigest,
      requestId,
      requestedAt,
      liveDeletionDeadline,
      backupPurgeDeadline,
    }),
    githubNativeArtifacts: Object.freeze({
      managed: false,
      autoDeleted: false,
      note: "GitHub controls its checks, comments, and reviews; they are not deleted by this purge.",
    }),
  });
}

// Assert an authorized live purge completed within the seven-day SLA. Injected
// timestamps only.
export function assertLivePurgeWithinSla(requestedAt, completedAt, profile = STANDARD_V1) {
  const requested = timestampValue(requestedAt, "requestedAt");
  const completed = timestampValue(completedAt, "completedAt");
  const deadline = addDays(requested, profile.livePurgeSlaDays);
  if (Date.parse(completed) > Date.parse(deadline)) {
    throw new Error("live purge exceeded the seven-day completion contract");
  }
  return Object.freeze({ requestedAt: requested, completedAt: completed, deadline, withinSla: true });
}

// Authorize serving reads from a restored backup. A restore may serve reads
// only after it replays the deletion journal, and only from a backup within the
// 35-day hard maximum. Neither path can rehydrate purged data.
export function authorizeRestoreReads(value, profile = STANDARD_V1) {
  const restore = objectValue(value, "restore");
  const backupCreatedAt = timestampValue(restore.backupCreatedAt, "restore.backupCreatedAt");
  const restoredAt = timestampValue(restore.restoredAt, "restore.restoredAt");
  const backupDeadline = addDays(backupCreatedAt, profile.backupHardMaxDays);
  if (Date.parse(restoredAt) > Date.parse(backupDeadline)) {
    throw new Error("restore rejected: the backup exceeded the 35-day hard maximum");
  }
  if (restore.deletionJournalReplayed !== true) {
    throw new Error("restore must replay the deletion journal before restored data becomes queryable");
  }
  return Object.freeze({ queryable: true, backupDeadline, restoredAt });
}

// --- repository lifecycle boundaries ---------------------------------------

// Decode a repository lifecycle event and enforce its ownership/authorization
// boundary. Uninstall stops collection but keeps normal retention. Removal marks
// state inactive immediately. Same-tenant transfer requires repository identity
// revalidation. Cross-tenant transfer requires explicit destination
// authorization and policy revalidation and never silently reassigns authority.
export function decodeRepositoryLifecycleEvent(value) {
  rejectForbiddenContent(value, "repositoryLifecycleEvent");
  assertEncodedSize(value, "repositoryLifecycleEvent", CONTRACT_MAX_BYTES);
  const event = objectValue(value, "repositoryLifecycleEvent");
  schemaVersion(event.schemaVersion, "repositoryLifecycleEvent.schemaVersion");
  const kind = enumValue(event.kind, "repositoryLifecycleEvent.kind", REPOSITORY_LIFECYCLE_KIND_SET);
  const tenant = aliasValue(event.tenant, "repositoryLifecycleEvent.tenant");
  const repository = repositoryValue(event.repository, "repositoryLifecycleEvent.repository");
  const normalized = {
    schemaVersion: RETENTION_SCHEMA_MAJOR,
    kind,
    tenant,
    repository,
    stopsCollection: kind !== "transfer_same_tenant" && kind !== "transfer_cross_tenant",
    purges: kind === "authorized_purge",
    marksInactive: kind === "removal",
    retentionContinues: kind === "uninstall" || kind === "removal",
  };
  if (kind === "transfer_same_tenant") {
    trueValue(event.revalidatedRepositoryIdentity, "repositoryLifecycleEvent.revalidatedRepositoryIdentity");
    normalized.revalidatedRepositoryIdentity = true;
    normalized.crossesTenant = false;
  }
  if (kind === "transfer_cross_tenant") {
    const destinationTenant = aliasValue(event.destinationTenant, "repositoryLifecycleEvent.destinationTenant");
    if (destinationTenant === tenant) {
      throw new Error("repositoryLifecycleEvent cross-tenant transfer must name a distinct destination tenant");
    }
    trueValue(event.destinationAuthorization, "repositoryLifecycleEvent.destinationAuthorization");
    trueValue(event.policyRevalidated, "repositoryLifecycleEvent.policyRevalidated");
    normalized.destinationTenant = destinationTenant;
    normalized.destinationAuthorized = true;
    normalized.policyRevalidated = true;
    normalized.crossesTenant = true;
    // A cross-tenant transfer never silently reassigns historical actor/policy
    // authority.
    normalized.reassignsHistoricalAuthority = false;
  }
  if (kind === "authorized_purge") {
    normalized.purgeRequestId = digestValue(event.purgeRequestId, "repositoryLifecycleEvent.purgeRequestId");
  }
  return Object.freeze(normalized);
}
