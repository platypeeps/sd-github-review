// Review usage reconciliation contract (A-011 companion, reconciliation scope).
//
// This module owns ONLY the schemas and a deterministic in-memory FAKE for
// reconciling an already-authorized budget reservation against a bounded
// reviewer outcome: monotonic accounting of the FULL authoritative actual usage
// and cost, soft `budget_overrun` versus hard `policy_violation` classification,
// explicit `overdrawn` pools plus a candidate-quarantine requirement, preserved
// `unknown` usage, and a retention CLASSIFICATION helper.
//
// It is a pure leaf: it imports no local module and never reads GitHub, the
// checkout, process state, the filesystem, the clock, environment, output
// files, or provider billing systems, and it emits no side effect. Time is
// ALWAYS an injected `nowIso` parameter so fake-clock conformance tests are
// deterministic; this module reads no clock of its own. Every reduce takes a
// decoded state and returns a NEW frozen state, so a rejected input (stale
// revision / conflicting final facts / cross-attempt collision) returns the
// input state unchanged and no partial mutation can ever escape.
//
// The eventual private implementation owns durable persistence, tenant/PR
// isolation, and the provider billing adapters. Actual usage and cost are
// AUTHORITATIVE observations bound to the original authorization identity; a
// missing reading stays an explicit `unknown` and never becomes a fabricated
// zero-cost success. Raw billing payloads, provider transcripts, and management
// credentials never enter this contract; the forbidden-field walker rejects
// them at the boundary. `classifyReconciliationRetention` returns a record
// shaped for `retention-policy.js#computeRecordLifecycle`, so a caller owns the
// standard-v1 duration math (90-day terminal detail, 180-day force to
// `expired_unknown`, 13-month receipt/audit) while this module stays a leaf
// (no contract->contract import edge).

import { createHash } from "node:crypto";

export const USAGE_RECONCILIATION_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 32 * 1024;
const RESPONSE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const REASON_MAX_BYTES = 512;
const MAX_COLLECTION_ITEMS = 64;
const MAX_NESTING_DEPTH = 32;

// The largest quantity any single reservation, usage, or cost reading may
// declare. This bounds one quantity, not an accumulated total: the reconciled
// log grows without bound over a pool's life, so `poolAggregates` fails closed
// if a running total ever crosses the safe-integer boundary rather than
// pretending a fixed record count keeps every sum exact.
const AMOUNT_MAX = 1_000_000_000_000_000;

// --- controlled vocabularies (mirrored, never imported) --------------------

// Explicit units. A budget quantity is always counted in exactly one of these;
// an unknown unit fails closed rather than being coerced. `usd_micros` keeps
// currency integer-exact (no floating point money).
export const BUDGET_UNITS = Object.freeze(["tokens", "usd_micros", "requests"]);
const BUDGET_UNIT_SET = new Set(BUDGET_UNITS);

// An authoritative usage or cost reading is either KNOWN or UNKNOWN. An unknown
// reading is preserved as-is; it never becomes a fabricated zero-cost success.
export const USAGE_CONFIDENCE = Object.freeze(["known", "unknown"]);
const USAGE_CONFIDENCE_SET = new Set(USAGE_CONFIDENCE);

// The bounded content outcome of the reviewer attempt. Budget classification is
// independent from this: a completed review may coexist with a `budget_overrun`.
export const REVIEW_ASSURANCES = Object.freeze(["completed", "incomplete", "ambiguous"]);
const REVIEW_ASSURANCE_SET = new Set(REVIEW_ASSURANCES);

// Whether the attempt left a reviewer side effect. `ambiguous` means the effect
// could not be determined; a reserve can never be released as unused under it.
export const RECONCILIATION_SIDE_EFFECTS = Object.freeze(["none", "review_published", "ambiguous"]);
const RECONCILIATION_SIDE_EFFECT_SET = new Set(RECONCILIATION_SIDE_EFFECTS);

// The budget classification of a KNOWN actual usage against the authorization.
// `within_reserve` fits the reserved hold; `budget_overrun` is a SOFT breach
// above reserve but within every hard request limit (the review outcome stays
// otherwise valid); `policy_violation` is a HARD input/output/usage/cost breach
// that cannot satisfy review assurance and requires candidate quarantine.
export const BUDGET_CLASSIFICATIONS = Object.freeze([
  "within_reserve",
  "budget_overrun",
  "policy_violation",
]);

// A reconciliation record is either terminal `reconciled` (a known usage was
// debited) or `unresolved` (an explicit unknown awaiting later evidence).
export const RECONCILIATION_STATUSES = Object.freeze(["reconciled", "unresolved"]);

// The bounded outcomes a reduce returns. `rejected` covers every fail-closed
// refusal that leaves the input state unchanged.
export const RECONCILIATION_OUTCOMES = Object.freeze(["reconciled", "unresolved", "rejected"]);

// The bounded, fail-closed reasons a reconcile is refused. A stale revision, a
// changed final fact on a terminal record, and a fingerprint bound to a
// different identity/economics all refuse rather than overwrite.
export const RECONCILIATION_REJECTIONS = Object.freeze([
  "stale_revision",
  "conflicting_facts",
]);

export const POOL_STATES = Object.freeze(["usable", "overdrawn"]);

export const QUARANTINE_STATES = Object.freeze(["quarantined", "released"]);

// Retention subjects this module classifies, mapped onto the retention policy's
// data classes. A terminal/unresolved reconciliation is `operational_state`
// (90-day terminal detail, 180-day force to `expired_unknown`); a receipt is a
// 13-month `bounded_event`; an audit trail is a 13-month `adjudication_chain`;
// a raw usage/cost observation is a 90-day `budget_observation`.
export const RECONCILIATION_RETENTION_SUBJECTS = Object.freeze([
  "reconciliation",
  "receipt",
  "audit",
  "usage_observation",
]);
const RECONCILIATION_RETENTION_SUBJECT_SET = new Set(RECONCILIATION_RETENTION_SUBJECTS);
const SUBJECT_TO_DATA_CLASS = Object.freeze({
  reconciliation: "operational_state",
  receipt: "bounded_event",
  audit: "adjudication_chain",
  usage_observation: "budget_observation",
});

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. These protect raw billing payloads, provider balances,
// management credentials/endpoints, and prompt/finding/model bodies from ever
// entering a reservation, a reviewer outcome, a reconciliation record, or a
// public projection.
const FORBIDDEN_CONTENT_FIELDS = new Set([
  "billingpayload",
  "billingpayloads",
  "rawbilling",
  "rawbillingpayload",
  "providerpayload",
  "providerpayloads",
  "providermetadata",
  "rawprovider",
  "rawpayload",
  "rawpayloads",
  "rawbalance",
  "rawbalances",
  "balance",
  "balances",
  "invoice",
  "invoices",
  "creditcard",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "apikey",
  "apikeys",
  "managementcredential",
  "managementcredentials",
  "managementkey",
  "managementtoken",
  "managementendpoint",
  "managementendpoints",
  "endpoint",
  "endpoints",
  "baseurl",
  "authorizationheader",
  "bearer",
  "prompt",
  "prompts",
  "promptbody",
  "renderedprompt",
  "diff",
  "diffs",
  "source",
  "sourcetext",
  "finding",
  "findings",
  "rawfinding",
  "modeloutput",
  "output",
  "outputs",
  "transcript",
  "transcripts",
  "content",
  "contents",
  "requestcontent",
]);

// --- primitive validators (matching protocol-v2 / ledger semantics) --------

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

// Parameterized privacy boundary walker. Names the field and the boundary only;
// it never echoes the offending value.
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

// Reject any raw billing payload, provider balance, management credential or
// endpoint, or prompt/finding/model body.
function rejectForbiddenContent(value, field) {
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "usage-reconciliation privacy boundary");
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

function enumValue(value, field, allowed) {
  const normalized = stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES });
  if (!allowed.has(normalized)) {
    throw new Error(`${field} must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function integerValue(value, field, { minimum = 0, maximum = AMOUNT_MAX } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function optionalInteger(value, field, options) {
  return value === undefined ? undefined : integerValue(value, field, options);
}

function falseValue(value, field) {
  if (value !== false) {
    throw new Error(`${field} must be explicitly false`);
  }
  return false;
}

function schemaVersion(value, field) {
  if (value !== USAGE_RECONCILIATION_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${USAGE_RECONCILIATION_SCHEMA_MAJOR}`);
  }
  return value;
}

function digestValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-fA-F0-9]{64}$/u, lower: true });
}

function shaValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$/u, lower: true });
}

function semverLikeValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[0-9]+\.[0-9]+\.[0-9]+$/u });
}

function aliasValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u, lower: true });
}

// An opaque, non-secret reference (a provider usage/settlement handle). The
// contract never carries a resolved billing value, only the handle the private
// control plane resolves.
function referenceValue(value, field) {
  return stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u });
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

export function stableUsageReconciliationJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableUsageReconciliationJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered
// equivalent input produces the same digest; any changed field changes it.
export function deriveUsageReconciliationDigest(fields) {
  return sha256(canonicalize(fields));
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    return Object.freeze(value);
  }
  return value;
}

// --- review identity -------------------------------------------------------

// The complete review identity every reconciliation binds to: tenant,
// repository, PR, exact head, attempt, compiled digest, and candidate. The
// attempt is part of the identity, so a distinct recovery attempt is a distinct
// authorization and can never spend or release this attempt's reservation.
function decodeReviewIdentity(value, field) {
  const identity = objectValue(value, field);
  return {
    tenant: aliasValue(identity.tenant, `${field}.tenant`),
    repository: repositoryValue(identity.repository, `${field}.repository`),
    pullRequest: integerValue(identity.pullRequest, `${field}.pullRequest`, { minimum: 1, maximum: 100_000_000 }),
    head: shaValue(identity.head, `${field}.head`),
    attempt: integerValue(identity.attempt, `${field}.attempt`, { minimum: 1, maximum: 100_000_000 }),
    compiledDigest: digestValue(identity.compiledDigest, `${field}.compiledDigest`),
    candidate: aliasValue(identity.candidate, `${field}.candidate`),
  };
}

function identityCore(identity) {
  return {
    tenant: identity.tenant,
    repository: identity.repository,
    pullRequest: identity.pullRequest,
    head: identity.head,
    attempt: identity.attempt,
    compiledDigest: identity.compiledDigest,
    candidate: identity.candidate,
  };
}

// Derive the deterministic binding digest over the full identity plus the exact
// economics the authorization committed to. It detects an authorization
// fingerprint that is reused across a DIFFERENT identity or economics (a
// cross-attempt collision) and fails that reconcile closed. It binds EVERY
// committed economics field — including the optional hard input/output/cost
// limits (which drive the policy_violation classification) and the lease — so a
// fingerprint replayed with different limits or lease metadata is rejected as a
// collision even on the unresolved->reconciled advance path, where terminal
// immutability alone would not catch it. `canonicalize` drops undefined keys, so
// a reservation that omits an optional limit binds distinctly from one that sets
// it (Copilot review).
function deriveBinding(reservation) {
  return deriveUsageReconciliationDigest({
    identity: identityCore(reservation.identity),
    poolId: reservation.poolId,
    units: reservation.units,
    reservedAmount: reservation.reservedAmount,
    hardRequestLimit: reservation.hardRequestLimit,
    hardInputLimit: reservation.hardInputLimit,
    hardOutputLimit: reservation.hardOutputLimit,
    hardCostLimitMicros: reservation.hardCostLimitMicros,
    leaseExpiresAt: reservation.leaseExpiresAt,
  });
}

// --- authorized reservation --------------------------------------------------

// Decode the already-authorized reservation this reconciliation settles. It
// carries the opaque authorization fingerprint (produced by the budget ledger /
// plan authorization and treated as an opaque identity key here), the full
// review identity, the pool + units, the reserved hold amount, and the HARD
// per-request usage/input/output/cost limits a breach of which is a policy
// violation. Optional hard input/output/cost limits are enforced only when the
// matching reading is present.
export function decodeAuthorizedReservation(value, field = "reservation") {
  rejectForbiddenContent(value, field);
  const reservation = objectValue(value, field);
  const authorizationFingerprint = digestValue(reservation.authorizationFingerprint, `${field}.authorizationFingerprint`);
  const identity = decodeReviewIdentity(reservation.identity, `${field}.identity`);
  const poolId = aliasValue(reservation.poolId, `${field}.poolId`);
  const units = enumValue(reservation.units, `${field}.units`, BUDGET_UNIT_SET);
  const reservedAmount = integerValue(reservation.reservedAmount, `${field}.reservedAmount`, { minimum: 1, maximum: AMOUNT_MAX });
  const hardRequestLimit = integerValue(reservation.hardRequestLimit, `${field}.hardRequestLimit`, { minimum: 1, maximum: AMOUNT_MAX });
  // The reserved hold is a conservative maximum; it can never exceed the hard
  // per-request authorization limit. A reservation that claims more than its own
  // hard limit is incoherent and fails closed.
  if (reservedAmount > hardRequestLimit) {
    throw new Error(`${field}.reservedAmount must not exceed hardRequestLimit`);
  }
  const hardInputLimit = optionalInteger(reservation.hardInputLimit, `${field}.hardInputLimit`, { minimum: 1, maximum: AMOUNT_MAX });
  const hardOutputLimit = optionalInteger(reservation.hardOutputLimit, `${field}.hardOutputLimit`, { minimum: 1, maximum: AMOUNT_MAX });
  const hardCostLimitMicros = optionalInteger(reservation.hardCostLimitMicros, `${field}.hardCostLimitMicros`, { minimum: 1, maximum: AMOUNT_MAX });
  const leaseExpiresAt = timestampValue(reservation.leaseExpiresAt, `${field}.leaseExpiresAt`);
  const normalized = {
    authorizationFingerprint,
    identity,
    poolId,
    units,
    reservedAmount,
    hardRequestLimit,
    leaseExpiresAt,
  };
  if (hardInputLimit !== undefined) normalized.hardInputLimit = hardInputLimit;
  if (hardOutputLimit !== undefined) normalized.hardOutputLimit = hardOutputLimit;
  if (hardCostLimitMicros !== undefined) normalized.hardCostLimitMicros = hardCostLimitMicros;
  return normalized;
}

// --- bounded reviewer outcome ------------------------------------------------

// Decode a KNOWN or UNKNOWN authoritative reading. An unknown reading must NOT
// carry any quantity fields: a partial reading that pairs `unknown` with a
// concrete amount is incoherent and fails closed rather than being silently
// treated as either a known number or a fabricated zero.
function decodeUsageReading(value, field) {
  const usage = objectValue(value, field);
  const confidence = enumValue(usage.confidence, `${field}.confidence`, USAGE_CONFIDENCE_SET);
  if (confidence === "unknown") {
    for (const key of ["amount", "inputUnits", "outputUnits"]) {
      if (usage[key] !== undefined) {
        throw new Error(`${field}.${key} must be absent when usage confidence is unknown`);
      }
    }
    return { confidence: "unknown" };
  }
  const reading = {
    confidence: "known",
    amount: integerValue(usage.amount, `${field}.amount`, { minimum: 0, maximum: AMOUNT_MAX }),
  };
  const inputUnits = optionalInteger(usage.inputUnits, `${field}.inputUnits`, { minimum: 0, maximum: AMOUNT_MAX });
  const outputUnits = optionalInteger(usage.outputUnits, `${field}.outputUnits`, { minimum: 0, maximum: AMOUNT_MAX });
  if (inputUnits !== undefined) reading.inputUnits = inputUnits;
  if (outputUnits !== undefined) reading.outputUnits = outputUnits;
  return reading;
}

function decodeCostReading(value, field) {
  const cost = objectValue(value, field);
  const confidence = enumValue(cost.confidence, `${field}.confidence`, USAGE_CONFIDENCE_SET);
  if (confidence === "unknown") {
    if (cost.amountMicros !== undefined) {
      throw new Error(`${field}.amountMicros must be absent when cost confidence is unknown`);
    }
    return { confidence: "unknown" };
  }
  return {
    confidence: "known",
    amountMicros: integerValue(cost.amountMicros, `${field}.amountMicros`, { minimum: 0, maximum: AMOUNT_MAX }),
  };
}

// Decode the bounded reviewer outcome: the content assurance, the authoritative
// actual usage and cost readings, an optional opaque provider reference, and
// the observed reviewer side effect. It carries no prompt, finding, transcript,
// or raw provider body — the privacy walker enforces that at the boundary.
export function decodeReviewerOutcome(value, field = "outcome") {
  rejectForbiddenContent(value, field);
  const outcome = objectValue(value, field);
  const assurance = enumValue(outcome.assurance, `${field}.assurance`, REVIEW_ASSURANCE_SET);
  const usage = decodeUsageReading(outcome.usage, `${field}.usage`);
  const cost = decodeCostReading(outcome.cost, `${field}.cost`);
  const sideEffects = enumValue(outcome.sideEffects, `${field}.sideEffects`, RECONCILIATION_SIDE_EFFECT_SET);
  const normalized = { assurance, usage, cost, sideEffects };
  if (outcome.providerRef !== undefined) {
    normalized.providerRef = referenceValue(outcome.providerRef, `${field}.providerRef`);
  }
  return normalized;
}

// --- reconciliation input ----------------------------------------------------

function decodeReconciliationInput(value, field = "reconciliation") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  const reservation = decodeAuthorizedReservation(input.reservation, `${field}.reservation`);
  const outcome = decodeReviewerOutcome(input.outcome, `${field}.outcome`);
  const revision = integerValue(input.revision, `${field}.revision`, { minimum: 1, maximum: 1_000_000_000 });
  const settledAt = optionalTimestamp(input.settledAt, `${field}.settledAt`);
  return { reservation, outcome, revision, settledAt };
}

// --- reconciliation ledger state --------------------------------------------

// Decode the initial reconciliation state from a set of authorized pool
// capacities. Each pool declares its usable capacity (the ledger-derived
// capacity actually available to debit against). A pool belongs to exactly one
// poolId.
export function createUsageReconciliationLedger(value, field = "usageReconciliationLedger") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  if (!Array.isArray(input.pools) || input.pools.length === 0) {
    throw new Error(`${field}.pools must be a non-empty array`);
  }
  if (input.pools.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.pools exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const pools = {};
  for (const [index, entry] of input.pools.entries()) {
    const pool = objectValue(entry, `${field}.pools[${index}]`);
    const poolId = aliasValue(pool.poolId, `${field}.pools[${index}].poolId`);
    // Own-property check: an alias like "constructor" would otherwise resolve to
    // an inherited Object.prototype value and be mistaken for a real pool.
    if (Object.hasOwn(pools, poolId)) {
      throw new Error(`${field}.pools[${index}] duplicates pool ${poolId}`);
    }
    pools[poolId] = {
      poolId,
      units: enumValue(pool.units, `${field}.pools[${index}].units`, BUDGET_UNIT_SET),
      usableCapacity: integerValue(pool.usableCapacity, `${field}.pools[${index}].usableCapacity`, { minimum: 0, maximum: AMOUNT_MAX }),
      overdrawn: false,
    };
  }
  return freezeDeep({
    schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
    pools,
    reconciliations: {},
  });
}

function requireState(state) {
  if (
    !isPlainObject(state)
    || state.schemaMajor !== USAGE_RECONCILIATION_SCHEMA_MAJOR
    || !isPlainObject(state.pools)
    || !isPlainObject(state.reconciliations)
  ) {
    throw new Error("a decoded usage reconciliation state is required");
  }
  return state;
}

function requirePool(state, poolId, field) {
  // Own-property lookup so a prototype key (e.g. "constructor") fails closed as
  // an unknown pool instead of returning an inherited Object.prototype value.
  if (!Object.hasOwn(state.pools, poolId)) {
    throw new Error(`${field} references unknown pool ${poolId}`);
  }
  return state.pools[poolId];
}

// Sum the full debited actual usage of every terminal reconciliation plus the
// conservatively held reserve of every still-unresolved (unknown) one against a
// pool. Derived every time so no aggregate can drift from the record log. An
// unresolved unknown HOLDS its reserve so future eligibility can never treat an
// unproven-unused reservation as available capacity.
function poolAggregates(state, poolId) {
  let debitedTotal = 0;
  let heldTotal = 0;
  for (const record of Object.values(state.reconciliations)) {
    if (record.poolId !== poolId) continue;
    if (record.status === "reconciled") {
      debitedTotal += record.debit;
    } else if (record.status === "unresolved") {
      heldTotal += record.heldAmount;
    }
  }
  // Fail closed rather than silently lose precision: per-quantity bounds cap a
  // single amount, but the reconciled log grows without bound over a pool's
  // life, so an accumulated total can still cross the safe-integer boundary. A
  // pool whose totals can no longer be represented exactly must not report new
  // capacity math against them.
  if (!Number.isSafeInteger(debitedTotal) || !Number.isSafeInteger(heldTotal)) {
    throw new Error(`pool ${poolId} aggregate totals exceed the safe-integer bound`);
  }
  return { debitedTotal, heldTotal, remaining: state.pools[poolId].usableCapacity - debitedTotal - heldTotal };
}

// --- classification of a reviewer outcome ------------------------------------

// Build the reconciliation facts from a reservation and a reviewer outcome. An
// UNKNOWN usage stays explicitly unresolved: it debits nothing (never a
// fabricated zero) and holds its reserve. A KNOWN usage debits the FULL actual
// amount even when it exceeds the reserve, classifies soft `budget_overrun`
// versus hard `policy_violation`, and releases only the portion of the reserve
// proven unused.
function buildReconciliation(reservation, outcome, now, settledAt) {
  if (outcome.usage.confidence === "unknown") {
    return {
      status: "unresolved",
      usageConfidence: "unknown",
      costConfidence: outcome.cost.confidence,
      debit: 0,
      heldAmount: reservation.reservedAmount,
      releasedAmount: 0,
      overrunAmount: 0,
      budgetClass: null,
      assuranceHonored: false,
      quarantineRequired: false,
      assurance: outcome.assurance,
      sideEffects: outcome.sideEffects,
      providerRef: outcome.providerRef,
      settledAt: settledAt ?? null,
    };
  }

  const amount = outcome.usage.amount;
  const hardBreach = amount > reservation.hardRequestLimit
    || (reservation.hardInputLimit !== undefined
      && outcome.usage.inputUnits !== undefined
      && outcome.usage.inputUnits > reservation.hardInputLimit)
    || (reservation.hardOutputLimit !== undefined
      && outcome.usage.outputUnits !== undefined
      && outcome.usage.outputUnits > reservation.hardOutputLimit)
    || (reservation.hardCostLimitMicros !== undefined
      && outcome.cost.confidence === "known"
      && outcome.cost.amountMicros > reservation.hardCostLimitMicros);

  let budgetClass;
  if (hardBreach) {
    budgetClass = "policy_violation";
  } else if (amount > reservation.reservedAmount) {
    budgetClass = "budget_overrun";
  } else {
    budgetClass = "within_reserve";
  }

  const quarantineRequired = budgetClass === "policy_violation";
  return {
    status: "reconciled",
    usageConfidence: "known",
    costConfidence: outcome.cost.confidence,
    // The FULL authoritative actual usage is always debited, even above the
    // reserve; it is never clamped to the reservation.
    debit: amount,
    heldAmount: 0,
    // Only the reserve proven unused is released; a usage at or above the
    // reserve releases nothing.
    releasedAmount: amount < reservation.reservedAmount ? reservation.reservedAmount - amount : 0,
    overrunAmount: amount > reservation.reservedAmount ? amount - reservation.reservedAmount : 0,
    budgetClass,
    // A soft `budget_overrun` preserves an otherwise valid review outcome; a
    // hard `policy_violation` can never satisfy review assurance.
    assuranceHonored: outcome.assurance === "completed" && !quarantineRequired,
    quarantineRequired,
    assurance: outcome.assurance,
    sideEffects: outcome.sideEffects,
    providerRef: outcome.providerRef,
    settledAt: settledAt ?? now,
  };
}

// A stable digest over the SEMANTIC facts of a reconciliation. A duplicate
// callback reproducing the same facts is an idempotent replay; a later callback
// changing a final fact is a conflict.
function factsDigestOf(authorizationFingerprint, binding, built, revision) {
  return deriveUsageReconciliationDigest({
    authorizationFingerprint,
    binding,
    revision,
    status: built.status,
    usageConfidence: built.usageConfidence,
    costConfidence: built.costConfidence,
    debit: built.debit,
    heldAmount: built.heldAmount,
    releasedAmount: built.releasedAmount,
    overrunAmount: built.overrunAmount,
    budgetClass: built.budgetClass,
    assuranceHonored: built.assuranceHonored,
    quarantineRequired: built.quarantineRequired,
    assurance: built.assurance,
    sideEffects: built.sideEffects,
    providerRef: built.providerRef,
  });
}

function buildDecision(authorizationFingerprint, poolId, built, remaining, overdrawn, replay) {
  const decision = {
    outcome: built.status,
    replay,
    authorizationFingerprint,
    poolId,
    usageConfidence: built.usageConfidence,
    costConfidence: built.costConfidence,
    debit: built.debit,
    heldAmount: built.heldAmount,
    releasedAmount: built.releasedAmount,
    overrunAmount: built.overrunAmount,
    budgetClass: built.budgetClass,
    assurance: built.assurance,
    assuranceHonored: built.assuranceHonored,
    quarantineRequired: built.quarantineRequired,
    sideEffects: built.sideEffects,
    remaining,
    poolState: overdrawn ? "overdrawn" : "usable",
    overdrawn,
    settledAt: built.settledAt,
  };
  if (built.providerRef !== undefined) decision.providerRef = built.providerRef;
  if (built.quarantineRequired) {
    // A hard policy violation emits a candidate-quarantine requirement bound to
    // the exact candidate identity.
    decision.quarantine = { candidate: built.candidate, state: "quarantined", reason: "policy_violation" };
  }
  return decision;
}

function rejectedResult(state, authorizationFingerprint, poolId, reason, extra = {}) {
  return {
    state,
    decision: freezeDeep({
      outcome: "rejected",
      replay: false,
      reason,
      authorizationFingerprint,
      poolId,
      ...extra,
    }),
  };
}

// Shared monotonic commit used by both reconcileUsage and releaseUnusedReserve.
// It enforces idempotent replay, monotonic revision, terminal immutability, and
// cross-attempt collision protection, then debits/holds against the pool and
// marks it `overdrawn` (sticky) when the full debit drives capacity negative.
function commitReconciliation(state, reservation, built, revision) {
  const key = reservation.authorizationFingerprint;
  const poolId = reservation.poolId;
  const binding = deriveBinding(reservation);
  built.candidate = reservation.identity.candidate;
  const factsDigest = factsDigestOf(key, binding, built, revision);

  const existing = Object.hasOwn(state.reconciliations, key) ? state.reconciliations[key] : undefined;
  if (existing) {
    // A fingerprint reused across a different identity or economics is a
    // collision; it can never touch this stored reconciliation.
    if (existing.binding !== binding) {
      return rejectedResult(state, key, poolId, "conflicting_facts");
    }
    // Idempotent replay: the same facts at the same revision reproduce the
    // stored decision and the same state object.
    if (existing.factsDigest === factsDigest) {
      const { remaining } = poolAggregates(state, poolId);
      return {
        state,
        decision: freezeDeep({ ...existing.decision, replay: true, remaining, poolState: state.pools[poolId].overdrawn ? "overdrawn" : "usable", overdrawn: state.pools[poolId].overdrawn }),
      };
    }
    // Monotonic: a stale or duplicate revision that changes a fact never
    // rewrites reconciled history.
    if (revision <= existing.revision) {
      return rejectedResult(state, key, poolId, "stale_revision", { revision, currentRevision: existing.revision });
    }
    // A terminal reconciled record is immutable: conflicting final facts fail
    // visibly rather than overwriting a settled debit. Only an explicit
    // unresolved unknown may still advance to a resolved terminal.
    if (existing.status === "reconciled") {
      return rejectedResult(state, key, poolId, "conflicting_facts", { revision });
    }
  }

  const next = structuredClone(state);
  next.reconciliations[key] = {
    authorizationFingerprint: key,
    poolId,
    units: reservation.units,
    status: built.status,
    revision,
    debit: built.debit,
    heldAmount: built.heldAmount,
    binding,
    factsDigest,
  };
  const { remaining } = poolAggregates(next, poolId);
  // A full debit that drives usable capacity negative marks the pool overdrawn.
  // Overdrawn is sticky so future eligibility can never treat the negative
  // capacity as available until a separately authorized recovery.
  const overdrawn = remaining < 0 || next.pools[poolId].overdrawn;
  next.pools[poolId].overdrawn = overdrawn;
  const decision = buildDecision(key, poolId, built, remaining, overdrawn, false);
  next.reconciliations[key].decision = decision;
  const frozen = freezeDeep(next);
  return { state: frozen, decision: freezeDeep(decision) };
}

// Reconcile an authorized reservation against a bounded reviewer outcome. The
// FULL authoritative actual usage is debited even when it exceeds the reserve;
// a soft `budget_overrun` preserves an otherwise valid review outcome while a
// hard `policy_violation` cannot satisfy assurance and emits a candidate
// quarantine. Missing usage stays an explicit unresolved unknown, never a
// fabricated zero. The reduce is idempotent on the authorization identity,
// monotonic on revision, and returns the input state unchanged on any rejection.
export function reconcileUsage(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = decodeReconciliationInput(value);
  const pool = requirePool(state, input.reservation.poolId, "reconciliation.reservation.poolId");
  if (input.reservation.units !== pool.units) {
    throw new Error(`reconciliation.reservation.units ${input.reservation.units} does not match pool units ${pool.units}`);
  }
  const built = buildReconciliation(input.reservation, input.outcome, now, input.settledAt);
  return commitReconciliation(state, input.reservation, built, input.revision);
}

// --- proven-unused reserve release ------------------------------------------

// Release a reservation proven fully unused: the review never dispatched and
// left no reviewer side effect. It records a terminal reconciliation that
// debits zero and releases the whole reserve. A dispatched attempt or an
// ambiguous side effect fails closed — that capacity is NOT proven unused and
// must go through reconcileUsage (an ambiguous side effect stays unresolved
// rather than fabricating a release).
export function releaseUnusedReserve(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  rejectForbiddenContent(value, "reserveRelease");
  assertEncodedSize(value, "reserveRelease", CONTRACT_MAX_BYTES);
  const input = objectValue(value, "reserveRelease");
  schemaVersion(input.schemaMajor, "reserveRelease.schemaMajor");
  const reservation = decodeAuthorizedReservation(input.reservation, "reserveRelease.reservation");
  const revision = integerValue(input.revision, "reserveRelease.revision", { minimum: 1, maximum: 1_000_000_000 });
  const proof = objectValue(input.proof, "reserveRelease.proof");
  falseValue(proof.dispatched, "reserveRelease.proof.dispatched");
  const sideEffects = enumValue(proof.sideEffects, "reserveRelease.proof.sideEffects", RECONCILIATION_SIDE_EFFECT_SET);
  if (sideEffects !== "none") {
    throw new Error("reserveRelease requires no reviewer side effect; an ambiguous or published effect must reconcile actual usage instead");
  }
  const pool = requirePool(state, reservation.poolId, "reserveRelease.reservation.poolId");
  if (reservation.units !== pool.units) {
    throw new Error(`reserveRelease.reservation.units ${reservation.units} does not match pool units ${pool.units}`);
  }
  const settledAt = optionalTimestamp(input.settledAt, "reserveRelease.settledAt") ?? now;
  const built = {
    status: "reconciled",
    usageConfidence: "known",
    costConfidence: "known",
    debit: 0,
    heldAmount: 0,
    releasedAmount: reservation.reservedAmount,
    overrunAmount: 0,
    budgetClass: "within_reserve",
    assuranceHonored: false,
    quarantineRequired: false,
    assurance: "incomplete",
    sideEffects: "none",
    providerRef: undefined,
    settledAt,
  };
  return commitReconciliation(state, reservation, built, revision);
}

// --- public projection ------------------------------------------------------

// Build the bounded, credential-free public projection of one pool: its
// identity, units, lifecycle state, usable capacity, the debited/held totals,
// and the remaining capacity. It carries no management credential and no raw
// billing payload — the contract never stored one, and the forbidden-field
// walker enforced that at every decode boundary.
export function projectReconciledPool(state, poolId) {
  requireState(state);
  const pool = requirePool(state, poolId, "projectReconciledPool.poolId");
  const { debitedTotal, heldTotal, remaining } = poolAggregates(state, poolId);
  return freezeDeep({
    schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
    poolId: pool.poolId,
    units: pool.units,
    state: pool.overdrawn ? "overdrawn" : "usable",
    overdrawn: pool.overdrawn,
    usableCapacity: pool.usableCapacity,
    debitedTotal,
    heldTotal,
    remaining,
  });
}

// --- retention classification (leaf boundary) ------------------------------

// Classify a reconciliation, a receipt, an audit trail, or a raw usage/cost
// observation for retention WITHOUT importing the retention module. The returned
// record is shaped exactly for `retention-policy.js#computeRecordLifecycle`,
// which owns the standard-v1 durations (90-day terminal operational detail,
// 180-day force to `expired_unknown`, 13-month receipt/audit, 90-day
// observation). A conflicting subject set fails closed rather than selecting the
// longer duration; an unresolved reconciliation omits `terminalAt` so the
// caller applies the 180-day force, preserving the explicit unknown rather than
// manufacturing final usage.
export function classifyReconciliationRetention(value, field = "reconciliationRetention") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const input = objectValue(value, field);
  if (input.subjects !== undefined) {
    throw new Error(`${field} must declare a single subject, not a subjects set`);
  }
  if (input.secondarySubject !== undefined) {
    throw new Error(`${field} must declare a single subject; a conflicting classification fails closed`);
  }
  const subject = enumValue(input.subject, `${field}.subject`, RECONCILIATION_RETENTION_SUBJECT_SET);
  const dataClass = SUBJECT_TO_DATA_CLASS[subject];
  const createdAt = timestampValue(input.createdAt, `${field}.createdAt`);
  const normalized = {
    dataClass,
    createdAt,
    coverageStart: optionalTimestamp(input.coverageStart, `${field}.coverageStart`) ?? createdAt,
    retentionPolicyId: aliasValue(input.retentionPolicyId, `${field}.retentionPolicyId`),
    version: semverLikeValue(input.version, `${field}.version`),
    digest: digestValue(input.digest, `${field}.digest`),
  };
  if (dataClass === "operational_state") {
    // A terminal reconciliation retains detailed state for 90 days from when it
    // settled; an unresolved one is forced to `expired_unknown` after 180 active
    // days. An explicit terminalAt drives the 90-day window; its absence lets
    // computeRecordLifecycle apply the 180-day force.
    if (input.terminalAt !== undefined) {
      normalized.terminalAt = timestampValue(input.terminalAt, `${field}.terminalAt`);
      if (Date.parse(normalized.terminalAt) < Date.parse(normalized.coverageStart)) {
        throw new Error(`${field}.terminalAt must not precede coverageStart`);
      }
    }
  } else if (dataClass === "adjudication_chain") {
    normalized.newestEventAt = optionalTimestamp(input.newestEventAt, `${field}.newestEventAt`) ?? createdAt;
    if (Date.parse(normalized.newestEventAt) < Date.parse(createdAt)) {
      throw new Error(`${field}.newestEventAt must not precede createdAt`);
    }
  }
  return Object.freeze(normalized);
}
