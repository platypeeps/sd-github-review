// Review budget ledger contract (A-011 companion, budget-ledger scope).
//
// This module owns ONLY the schemas and a deterministic in-memory FAKE for a
// consumer-owned private budget ledger: bounded authoritative budget
// observations (with freshness + uncertainty), idempotent reservations and
// leases bound to the complete review identity, atomic shared-pool decisions,
// explicit `overdrawn` pools + candidate quarantine, a credential-free public
// pool projection, and a retention CLASSIFICATION helper.
//
// It is a pure leaf: it imports no local module and never reads GitHub, the
// checkout, process state, the filesystem, the clock, environment, output
// files, or provider billing systems, and it emits no side effect. Time is
// ALWAYS an injected `nowIso` parameter so fake-clock conformance tests are
// deterministic; this module reads no clock of its own. Every reduce operation
// takes a decoded state and returns a NEW frozen state, so a rejected decision
// (ineligible / stale-revision / replay) returns the input state unchanged and
// no partial mutation can ever escape.
//
// The eventual private implementation owns durable persistence, tenant/PR
// isolation, and the provider billing adapters. Provider billing balances are
// OBSERVATIONS with freshness and confidence, never transactionally locked
// resources; a stale or unknown observation fails closed. Raw billing payloads
// and management credentials never enter this contract; the forbidden-field
// walker rejects them at the boundary. `classifyBudgetRetention` returns a
// record shaped for `retention-policy.js#computeRecordLifecycle`, so a caller
// owns the standard-v1 duration math while this module stays a leaf (no
// contract->contract import edge).

import { createHash } from "node:crypto";

export const BUDGET_LEDGER_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 32 * 1024;
const RESPONSE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const REASON_MAX_BYTES = 512;
const MAX_COLLECTION_ITEMS = 64;
const MAX_NESTING_DEPTH = 32;

// The largest budget quantity any single observation, reservation, or charge
// may declare. This bounds one quantity, not an accumulated total: the settled
// lease log grows without bound over a pool's life, so `poolAggregates` fails
// closed if a running total ever crosses Number.MAX_SAFE_INTEGER rather than
// pretending a fixed lease count keeps every sum exact.
const AMOUNT_MAX = 1_000_000_000_000_000;

// --- controlled vocabularies (mirrored, never imported) --------------------

// Explicit units. A budget quantity is always counted in exactly one of these;
// an unknown unit fails closed rather than being coerced. `usd_micros` keeps
// currency integer-exact (no floating point money).
export const BUDGET_UNITS = Object.freeze(["tokens", "usd_micros", "requests"]);
const BUDGET_UNIT_SET = new Set(BUDGET_UNITS);

// An independent pool serves exactly one candidate; a shared pool serializes
// multiple candidates against one authoritative balance inside the ledger.
export const POOL_KINDS = Object.freeze(["independent", "shared"]);
const POOL_KIND_SET = new Set(POOL_KINDS);

export const POOL_STATES = Object.freeze(["usable", "overdrawn"]);

// An authoritative observation is either a KNOWN reading or an UNKNOWN one. An
// unknown reading never authorizes capacity; it fails closed.
export const OBSERVATION_CONFIDENCE = Object.freeze(["known", "unknown"]);
const OBSERVATION_CONFIDENCE_SET = new Set(OBSERVATION_CONFIDENCE);

// A preflight counts the request input either exactly or as a bounded estimate.
export const PREFLIGHT_METHODS = Object.freeze(["exact", "estimated"]);
const PREFLIGHT_METHOD_SET = new Set(PREFLIGHT_METHODS);

// A lease's lifecycle inside the ledger. `settled` is a reconciled terminal.
export const LEASE_STATES = Object.freeze([
  "reserved",
  "authorized",
  "released",
  "expired",
  "settled",
]);

// A reservation attempt either wins a lease or receives a BOUNDED ineligibility.
export const RESERVATION_OUTCOMES = Object.freeze(["reserved", "ineligible"]);

// The bounded reasons a reservation is refused. Every one is fail-closed: a
// losing concurrent attempt, an overdrawn pool, a quarantined candidate, and a
// stale/unknown observation all deny capacity rather than guessing.
export const INELIGIBILITY_REASONS = Object.freeze([
  "insufficient_usable_capacity",
  "pool_overdrawn",
  "candidate_quarantined",
  "observation_stale",
  "observation_unknown",
  "lease_expiry_not_future",
]);

export const QUARANTINE_STATES = Object.freeze(["quarantined", "released"]);
const QUARANTINE_STATE_SET = new Set(QUARANTINE_STATES);

// Retention subjects this ledger classifies, mapped onto the retention policy's
// data classes. Operational reservation/lease/authorization detail is
// `operational_state` (90-day terminal detail, 180-day force to
// `expired_unknown`); a receipt is a 13-month `bounded_event`; an audit trail
// is a 13-month `adjudication_chain`; a raw budget observation / provider
// reference is a 90-day `budget_observation`.
export const BUDGET_RETENTION_SUBJECTS = Object.freeze([
  "reservation",
  "lease",
  "authorization",
  "receipt",
  "audit",
  "budget_observation",
]);
const BUDGET_RETENTION_SUBJECT_SET = new Set(BUDGET_RETENTION_SUBJECTS);
const SUBJECT_TO_DATA_CLASS = Object.freeze({
  reservation: "operational_state",
  lease: "operational_state",
  authorization: "operational_state",
  receipt: "bounded_event",
  audit: "adjudication_chain",
  budget_observation: "budget_observation",
});

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. These protect raw billing payloads, provider balances,
// management credentials/endpoints, and prompt/finding/model bodies from ever
// entering a budget observation, a reservation request, a lease, or a public
// projection.
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

// --- primitive validators (matching protocol-v2 / retention semantics) -----

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

// Parameterized privacy boundary walker. Names the field and the boundary
// only; it never echoes the offending value.
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
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "budget-ledger privacy boundary");
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
  if (value !== BUDGET_LEDGER_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${BUDGET_LEDGER_SCHEMA_MAJOR}`);
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

// An opaque, non-secret reference (a provider-account handle or a billing
// source pointer). The ledger never carries the resolved billing value, only
// the handle the private control plane resolves.
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

export function stableBudgetLedgerJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableBudgetLedgerJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered
// equivalent input produces the same digest; any changed field changes it.
export function deriveBudgetLedgerDigest(fields) {
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

// The complete review identity every observation/reservation binds to: tenant,
// repository, PR, exact head, attempt, compiled digest, and candidate. A
// reservation additionally derives a request fingerprint over this identity
// plus its economics so a replay of the SAME attempt is idempotent while a
// DISTINCT recovery attempt is a different identity (and a different lease).
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

// Derive the deterministic request fingerprint that binds a reservation to the
// full identity plus the exact economics it authorizes. Reordered-equivalent
// input yields the same fingerprint; a distinct attempt, pool, unit, or charge
// yields a distinct one.
export function deriveRequestFingerprint(identity, economics) {
  return deriveBudgetLedgerDigest({
    identity: identityCore(identity),
    poolId: economics.poolId,
    units: economics.units,
    conservativeMaxCharge: economics.conservativeMaxCharge,
    hardRequestLimit: economics.hardRequestLimit,
  });
}

// --- authoritative budget observation --------------------------------------

// Decode one bounded authoritative observation of a pool's usable budget. It
// carries the source, units, the observed amount, a safety margin, when it was
// observed, its freshness deadline, and its confidence. Provider billing is an
// observation, never a locked resource: an `unknown` reading or one past its
// freshness deadline fails closed at reservation time. A raw billing payload or
// provider balance body is rejected by the privacy walker.
export function decodeBudgetObservation(value, field = "budgetObservation") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const observation = objectValue(value, field);
  schemaVersion(observation.schemaMajor, `${field}.schemaMajor`);
  const kind = enumValue(observation.kind, `${field}.kind`, POOL_KIND_SET);
  const units = enumValue(observation.units, `${field}.units`, BUDGET_UNIT_SET);
  const confidence = enumValue(observation.confidence, `${field}.confidence`, OBSERVATION_CONFIDENCE_SET);
  const observedAt = timestampValue(observation.observedAt, `${field}.observedAt`);
  const freshnessDeadline = timestampValue(observation.freshnessDeadline, `${field}.freshnessDeadline`);
  if (Date.parse(freshnessDeadline) <= Date.parse(observedAt)) {
    throw new Error(`${field}.freshnessDeadline must be after observedAt`);
  }
  const amount = integerValue(observation.amount, `${field}.amount`, { minimum: 0, maximum: AMOUNT_MAX });
  const safetyMargin = integerValue(observation.safetyMargin, `${field}.safetyMargin`, { minimum: 0, maximum: AMOUNT_MAX });
  // A safety margin that meets or exceeds the observed amount leaves no usable
  // headroom; a margin larger than the reading is incoherent and fails closed.
  if (safetyMargin > amount) {
    throw new Error(`${field}.safetyMargin must not exceed the observed amount`);
  }
  const candidates = candidateArray(observation.candidates, `${field}.candidates`);
  if (kind === "independent" && candidates.length !== 1) {
    throw new Error(`${field}.candidates must name exactly one candidate for an independent pool`);
  }
  return Object.freeze({
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    poolId: aliasValue(observation.poolId, `${field}.poolId`),
    kind,
    units,
    provider: aliasValue(observation.provider, `${field}.provider`),
    sourceRef: referenceValue(observation.sourceRef, `${field}.sourceRef`),
    amount,
    safetyMargin,
    observedAt,
    freshnessDeadline,
    confidence,
    candidates: Object.freeze(candidates),
  });
}

function candidateArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must name at least one candidate`);
  }
  if (value.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field} exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const normalized = value.map((item, index) => aliasValue(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a candidate`);
  }
  return normalized.sort();
}

// --- reservation request ----------------------------------------------------

// A bounded, side-effect-free request preflight. It declares that the input was
// counted with a bounded method and that computing it required no side effect.
// A missing or unsafe preflight fails closed: the ledger never reserves against
// an unbounded average.
function decodePreflight(value, field) {
  const preflight = objectValue(value, field);
  if (preflight.bounded !== true) {
    throw new Error(`${field}.bounded must be explicitly true; the ledger never reserves against an unbounded preflight`);
  }
  if (preflight.sideEffectFree !== true) {
    throw new Error(`${field}.sideEffectFree must be explicitly true; a request preflight must be side-effect-free`);
  }
  return {
    bounded: true,
    sideEffectFree: true,
    method: enumValue(preflight.method, `${field}.method`, PREFLIGHT_METHOD_SET),
    inputUnits: integerValue(preflight.inputUnits, `${field}.inputUnits`, { minimum: 0, maximum: AMOUNT_MAX }),
  };
}

// Decode an idempotent reservation request. It binds to the full review
// identity, targets one pool in explicit units, carries a bounded
// side-effect-free preflight, and declares the CONSERVATIVE MAXIMUM expected
// charge (the amount capacity is actually held against) plus the HARD
// per-request authorization limit. An optional expected average may be reported
// but can never protect capacity: it must not exceed the conservative maximum,
// and the conservative maximum must not exceed the hard limit.
export function decodeReservationRequest(value, field = "reservationRequest") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const request = objectValue(value, field);
  schemaVersion(request.schemaMajor, `${field}.schemaMajor`);
  const identity = decodeReviewIdentity(request.identity, `${field}.identity`);
  const poolId = aliasValue(request.poolId, `${field}.poolId`);
  const units = enumValue(request.units, `${field}.units`, BUDGET_UNIT_SET);
  const conservativeMaxCharge = integerValue(request.conservativeMaxCharge, `${field}.conservativeMaxCharge`, {
    minimum: 1,
    maximum: AMOUNT_MAX,
  });
  const hardRequestLimit = integerValue(request.hardRequestLimit, `${field}.hardRequestLimit`, {
    minimum: 1,
    maximum: AMOUNT_MAX,
  });
  if (conservativeMaxCharge > hardRequestLimit) {
    throw new Error(`${field}.conservativeMaxCharge must not exceed hardRequestLimit`);
  }
  if (request.expectedAverage !== undefined) {
    const expectedAverage = integerValue(request.expectedAverage, `${field}.expectedAverage`, { minimum: 0, maximum: AMOUNT_MAX });
    if (expectedAverage > conservativeMaxCharge) {
      throw new Error(`${field}.expectedAverage must not exceed conservativeMaxCharge; an average never authorizes capacity`);
    }
  }
  const preflight = decodePreflight(request.preflight, `${field}.preflight`);
  const leaseExpiresAt = timestampValue(request.leaseExpiresAt, `${field}.leaseExpiresAt`);
  const economics = { poolId, units, conservativeMaxCharge, hardRequestLimit };
  const derivedFingerprint = deriveRequestFingerprint(identity, economics);
  if (request.requestFingerprint !== undefined) {
    const declared = digestValue(request.requestFingerprint, `${field}.requestFingerprint`);
    if (declared !== derivedFingerprint) {
      throw new Error(`${field}.requestFingerprint does not match its canonical identity and economics`);
    }
  }
  const normalized = {
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    identity,
    poolId,
    units,
    conservativeMaxCharge,
    hardRequestLimit,
    preflight,
    leaseExpiresAt,
    requestFingerprint: derivedFingerprint,
  };
  if (request.expectedAverage !== undefined) {
    normalized.expectedAverage = request.expectedAverage;
  }
  return freezeDeep(normalized);
}

// --- ledger state -----------------------------------------------------------

// Decode the initial ledger state from a set of authoritative observations plus
// an optional candidate-quarantine overlay. Each observation initializes one
// pool; a candidate belongs to exactly one pool. Shared pools list every
// candidate that serializes against the same balance.
export function createBudgetLedger(value, field = "budgetLedger") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new Error(`${field}.observations must be a non-empty array`);
  }
  if (input.observations.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.observations exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const pools = {};
  const candidateToPool = new Map();
  for (const [index, entry] of input.observations.entries()) {
    const observation = decodeBudgetObservation(entry, `${field}.observations[${index}]`);
    // Own-property check: an alias like "constructor" would otherwise resolve to
    // an inherited Object.prototype value and be mistaken for a real pool.
    if (Object.hasOwn(pools, observation.poolId)) {
      throw new Error(`${field}.observations[${index}] duplicates pool ${observation.poolId}`);
    }
    for (const candidate of observation.candidates) {
      if (candidateToPool.has(candidate)) {
        throw new Error(`${field}.observations[${index}] candidate ${candidate} already belongs to another pool`);
      }
      candidateToPool.set(candidate, observation.poolId);
    }
    pools[observation.poolId] = poolFromObservation(observation);
  }
  const quarantine = {};
  const quarantineInput = input.quarantine === undefined ? [] : input.quarantine;
  if (!Array.isArray(quarantineInput)) {
    throw new Error(`${field}.quarantine must be an array`);
  }
  if (quarantineInput.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.quarantine exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  for (const [index, entry] of quarantineInput.entries()) {
    const record = decodeQuarantineRecord(entry, `${field}.quarantine[${index}]`);
    quarantine[record.candidate] = record;
  }
  return freezeDeep({
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    pools,
    leases: {},
    quarantine,
  });
}

function poolFromObservation(observation) {
  return {
    poolId: observation.poolId,
    kind: observation.kind,
    units: observation.units,
    candidates: [...observation.candidates],
    authorizedCapacity: observation.amount,
    safetyMargin: observation.safetyMargin,
    auditAdjustment: 0,
    overdrawn: false,
    provider: observation.provider,
    sourceRef: observation.sourceRef,
    observedAt: observation.observedAt,
    freshnessDeadline: observation.freshnessDeadline,
    confidence: observation.confidence,
    authorizationRevision: 0,
    reconcileRevision: 0,
    latestAuthorizedAttempt: null,
  };
}

function decodeQuarantineRecord(value, field) {
  const record = objectValue(value, field);
  return {
    candidate: aliasValue(record.candidate, `${field}.candidate`),
    state: enumValue(record.state, `${field}.state`, QUARANTINE_STATE_SET),
    reason: stringValue(record.reason, `${field}.reason`, { maximum: REASON_MAX_BYTES }),
    effectiveAt: timestampValue(record.effectiveAt, `${field}.effectiveAt`),
  };
}

function requireDecodedState(state) {
  if (!isPlainObject(state) || state.schemaMajor !== BUDGET_LEDGER_SCHEMA_MAJOR || !isPlainObject(state.pools)) {
    throw new Error("a decoded budget ledger state is required");
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

// Sum the live reserved holds and the settled charges against a pool. Live =
// reserved or authorized leases; settled = reconciled leases. Derived every
// time so no aggregate can drift out of sync with the lease log.
function poolAggregates(state, poolId) {
  let reservedTotal = 0;
  let settledTotal = 0;
  for (const lease of Object.values(state.leases)) {
    if (lease.poolId !== poolId) continue;
    if (lease.state === "reserved" || lease.state === "authorized") {
      reservedTotal += lease.amount;
    } else if (lease.state === "settled") {
      settledTotal += lease.settledCharge;
    }
  }
  // Fail closed rather than silently lose precision: per-quantity bounds cap a
  // single amount, but the settled log grows without bound over a pool's life,
  // so an accumulated total can still cross the safe-integer boundary. A pool
  // whose totals can no longer be represented exactly must not authorize new
  // capacity math against them.
  if (!Number.isSafeInteger(reservedTotal) || !Number.isSafeInteger(settledTotal)) {
    throw new Error(`pool ${poolId} aggregate totals exceed the safe-integer bound`);
  }
  return { reservedTotal, settledTotal };
}

function realCapacityOf(pool, settledTotal) {
  return pool.authorizedCapacity + pool.auditAdjustment - settledTotal;
}

function usableOf(pool, reservedTotal, settledTotal) {
  return realCapacityOf(pool, settledTotal) - pool.safetyMargin - reservedTotal;
}

// --- reservation decision ---------------------------------------------------

// Attempt an idempotent, atomic reservation against a pool. The decision is
// all-or-nothing: a losing attempt receives a bounded `ineligible` outcome and
// the state is returned UNCHANGED, so a concurrent loser never leaves a partial
// mutation. A replay of the same request fingerprint returns the existing lease
// without double-charging (idempotent). Fail-closed checks run before any
// capacity math: a quarantined candidate, an overdrawn pool, and a stale or
// unknown observation all deny the reservation.
export function reserve(state, requestValue, { nowIso } = {}) {
  requireDecodedState(state);
  const now = timestampValue(nowIso, "nowIso");
  const nowMs = Date.parse(now);
  const request = decodeReservationRequest(requestValue);
  const pool = requirePool(state, request.poolId, "reservationRequest.poolId");
  if (request.units !== pool.units) {
    throw new Error(`reservationRequest.units ${request.units} does not match pool units ${pool.units}`);
  }
  if (!pool.candidates.includes(request.identity.candidate)) {
    throw new Error(`reservationRequest.identity.candidate ${request.identity.candidate} is not a member of pool ${pool.poolId}`);
  }

  const existing = state.leases[request.requestFingerprint];
  if (existing) {
    // Idempotent replay: the same identity+economics reproduces the same lease.
    // A fingerprint that somehow maps to a different pool/amount is a collision
    // and fails closed rather than silently reusing the wrong hold.
    if (existing.poolId !== pool.poolId || existing.amount !== request.conservativeMaxCharge) {
      throw new Error("reservationRequest fingerprint collides with a different reservation");
    }
    return {
      state,
      decision: freezeDeep({
        outcome: "reserved",
        replay: true,
        requestFingerprint: request.requestFingerprint,
        lease: existing,
        pool: projectPool(state, pool.poolId),
      }),
    };
  }

  const ineligible = (reason) => ({
    state,
    decision: freezeDeep({
      outcome: "ineligible",
      replay: false,
      reason,
      requestFingerprint: request.requestFingerprint,
      poolId: pool.poolId,
    }),
  });

  const candidateKey = request.identity.candidate;
  const quarantine = Object.hasOwn(state.quarantine, candidateKey)
    ? state.quarantine[candidateKey]
    : undefined;
  if (quarantine && quarantine.state === "quarantined") {
    return ineligible("candidate_quarantined");
  }
  if (pool.overdrawn) {
    return ineligible("pool_overdrawn");
  }
  if (Date.parse(pool.freshnessDeadline) < nowMs) {
    return ineligible("observation_stale");
  }
  if (pool.confidence === "unknown") {
    return ineligible("observation_unknown");
  }
  // Fail closed on a lease that is already dead on arrival: an expiry at or
  // before the reservation instant would hold capacity until a later
  // expireLeases() sweep, breaking the invariant that a live hold reflects only
  // a lease whose deadline is still ahead.
  if (Date.parse(request.leaseExpiresAt) <= nowMs) {
    return ineligible("lease_expiry_not_future");
  }
  const { reservedTotal, settledTotal } = poolAggregates(state, pool.poolId);
  if (realCapacityOf(pool, settledTotal) < 0) {
    return ineligible("pool_overdrawn");
  }
  const usable = usableOf(pool, reservedTotal, settledTotal);
  if (request.conservativeMaxCharge > usable) {
    return ineligible("insufficient_usable_capacity");
  }

  const lease = {
    requestFingerprint: request.requestFingerprint,
    identity: identityCore(request.identity),
    poolId: pool.poolId,
    units: request.units,
    amount: request.conservativeMaxCharge,
    conservativeMaxCharge: request.conservativeMaxCharge,
    hardRequestLimit: request.hardRequestLimit,
    preflight: request.preflight,
    state: "reserved",
    createdAt: now,
    expiresAt: request.leaseExpiresAt,
    authorizedAttempt: null,
    revision: 0,
  };
  if (request.expectedAverage !== undefined) {
    lease.expectedAverage = request.expectedAverage;
  }
  const next = structuredClone(state);
  next.leases[request.requestFingerprint] = lease;
  const frozen = freezeDeep(next);
  return {
    state: frozen,
    decision: freezeDeep({
      outcome: "reserved",
      replay: false,
      requestFingerprint: request.requestFingerprint,
      lease: frozen.leases[request.requestFingerprint],
      pool: projectPool(frozen, pool.poolId),
    }),
  };
}

// --- authorization (monotonic revision compare-and-swap) --------------------

// Authorize a reserved lease for dispatch. State advances ONLY through a
// monotonic revision compare-and-swap: the request must present a revision
// strictly greater than the pool's current authorization revision, and it
// records the latest-authorized attempt. A stale or duplicate revision (an
// out-of-order recovery attempt) is `rejected` with no partial mutation, so a
// distinct linked recovery attempt can never silently overwrite a newer one.
export function authorize(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "authorization");
  const requestFingerprint = digestValue(input.requestFingerprint, "authorization.requestFingerprint");
  const revision = integerValue(input.revision, "authorization.revision", { minimum: 1, maximum: 1_000_000_000 });
  const authorizedAttempt = integerValue(input.authorizedAttempt, "authorization.authorizedAttempt", { minimum: 1, maximum: 100_000_000 });
  const lease = state.leases[requestFingerprint];
  if (!lease) {
    throw new Error(`authorization references unknown lease ${requestFingerprint}`);
  }
  const pool = requirePool(state, lease.poolId, "authorization.lease.poolId");

  // The attempt is already bound into the lease identity via its request
  // fingerprint. Fail closed if the caller presents a different one rather than
  // writing an inconsistent latestAuthorizedAttempt into the lease and pool.
  if (authorizedAttempt !== lease.identity.attempt) {
    throw new Error(
      `authorization.authorizedAttempt ${authorizedAttempt} does not match the lease identity attempt ${lease.identity.attempt}`,
    );
  }

  // Idempotent re-authorization of the same lease at the same revision/attempt.
  if (lease.state === "authorized" && lease.revision === revision && lease.authorizedAttempt === authorizedAttempt) {
    return {
      state,
      decision: freezeDeep({ outcome: "authorized", replay: true, requestFingerprint, revision, authorizedAttempt }),
    };
  }
  if (lease.state !== "reserved") {
    throw new Error(`authorization requires a reserved lease; ${requestFingerprint} is ${lease.state}`);
  }
  if (revision <= pool.authorizationRevision) {
    // Compare-and-swap failure: a newer authorization already won.
    return {
      state,
      decision: freezeDeep({
        outcome: "rejected",
        reason: "stale_revision",
        requestFingerprint,
        revision,
        currentRevision: pool.authorizationRevision,
      }),
    };
  }
  const next = structuredClone(state);
  const nextLease = next.leases[requestFingerprint];
  nextLease.state = "authorized";
  nextLease.revision = revision;
  nextLease.authorizedAttempt = authorizedAttempt;
  next.pools[pool.poolId].authorizationRevision = revision;
  next.pools[pool.poolId].latestAuthorizedAttempt = authorizedAttempt;
  const frozen = freezeDeep(next);
  return {
    state: frozen,
    decision: freezeDeep({ outcome: "authorized", replay: false, requestFingerprint, revision, authorizedAttempt }),
  };
}

// Release a live (reserved or authorized) lease, returning its held capacity to
// the pool. Releasing an already-terminal lease is a no-op replay.
export function releaseReservation(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "release");
  const requestFingerprint = digestValue(input.requestFingerprint, "release.requestFingerprint");
  const lease = state.leases[requestFingerprint];
  if (!lease) {
    throw new Error(`release references unknown lease ${requestFingerprint}`);
  }
  if (lease.state !== "reserved" && lease.state !== "authorized") {
    return { state, decision: freezeDeep({ outcome: "released", replay: true, requestFingerprint }) };
  }
  const next = structuredClone(state);
  next.leases[requestFingerprint].state = "released";
  return { state: freezeDeep(next), decision: freezeDeep({ outcome: "released", replay: false, requestFingerprint }) };
}

// Expire every live lease whose expiry deadline is at or before the injected
// instant, returning its held capacity to the pool. Time is injected; the
// module never reads a clock.
export function expireLeases(state, { nowIso } = {}) {
  requireDecodedState(state);
  const now = timestampValue(nowIso, "nowIso");
  const nowMs = Date.parse(now);
  const expired = [];
  for (const lease of Object.values(state.leases)) {
    if ((lease.state === "reserved" || lease.state === "authorized") && Date.parse(lease.expiresAt) <= nowMs) {
      expired.push(lease.requestFingerprint);
    }
  }
  if (expired.length === 0) {
    return { state, expired: freezeDeep([]) };
  }
  const next = structuredClone(state);
  for (const fingerprint of expired) {
    next.leases[fingerprint].state = "expired";
  }
  return { state: freezeDeep(next), expired: freezeDeep([...expired].sort()) };
}

// --- reconciliation ---------------------------------------------------------

// Reconcile a lease against an authoritative charge. The full charge is
// recorded even when it exceeds the reserved hold; if it drives the pool's real
// capacity negative the pool becomes `overdrawn`, blocking new reservations
// until a fresh authoritative observation or an audited adjustment restores
// usable capacity. Reconciliation advances through a monotonic revision CAS so
// an out-of-order settlement is rejected with no partial mutation.
export function reconcile(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "reconciliation");
  const requestFingerprint = digestValue(input.requestFingerprint, "reconciliation.requestFingerprint");
  const revision = integerValue(input.revision, "reconciliation.revision", { minimum: 1, maximum: 1_000_000_000 });
  const actualCharge = integerValue(input.actualCharge, "reconciliation.actualCharge", { minimum: 0, maximum: AMOUNT_MAX });
  const lease = state.leases[requestFingerprint];
  if (!lease) {
    throw new Error(`reconciliation references unknown lease ${requestFingerprint}`);
  }
  if (lease.state === "settled" && lease.settledCharge === actualCharge && lease.reconcileRevision === revision) {
    return {
      state,
      decision: freezeDeep({ outcome: "settled", replay: true, requestFingerprint, actualCharge, overdrawn: state.pools[lease.poolId].overdrawn }),
    };
  }
  if (lease.state !== "authorized") {
    throw new Error(`reconciliation requires an authorized lease; ${requestFingerprint} is ${lease.state}`);
  }
  const pool = requirePool(state, lease.poolId, "reconciliation.lease.poolId");
  if (revision <= pool.reconcileRevision) {
    return {
      state,
      decision: freezeDeep({
        outcome: "rejected",
        reason: "stale_revision",
        requestFingerprint,
        revision,
        currentRevision: pool.reconcileRevision,
      }),
    };
  }
  const next = structuredClone(state);
  const nextLease = next.leases[requestFingerprint];
  nextLease.state = "settled";
  nextLease.settledCharge = actualCharge;
  nextLease.reconcileRevision = revision;
  next.pools[pool.poolId].reconcileRevision = revision;
  const { settledTotal } = poolAggregates(next, pool.poolId);
  const overdrawn = realCapacityOf(next.pools[pool.poolId], settledTotal) < 0;
  if (overdrawn) {
    next.pools[pool.poolId].overdrawn = true;
  }
  const frozen = freezeDeep(next);
  return {
    state: frozen,
    decision: freezeDeep({ outcome: "settled", replay: false, requestFingerprint, actualCharge, overdrawn }),
  };
}

// --- pool recovery ----------------------------------------------------------

// Apply a fresh authoritative observation to an existing pool. A KNOWN,
// non-stale observation whose amount restores non-negative real capacity clears
// an `overdrawn` pool (verified replenishment). A stale or unknown observation
// updates the reading but can NEVER clear overdrawn — the pool keeps failing
// closed. Conversely, any observation whose amount no longer covers settled
// charges (real capacity negative) drives the pool overdrawn regardless of
// freshness. Clearing an overdrawn pool never touches candidate quarantine.
export function applyObservation(state, observationValue, { nowIso } = {}) {
  requireDecodedState(state);
  const now = timestampValue(nowIso, "nowIso");
  const nowMs = Date.parse(now);
  const observation = decodeBudgetObservation(observationValue);
  const pool = requirePool(state, observation.poolId, "budgetObservation.poolId");
  if (observation.units !== pool.units) {
    throw new Error(`budgetObservation.units ${observation.units} does not match pool units ${pool.units}`);
  }
  if (observation.kind !== pool.kind) {
    throw new Error(`budgetObservation.kind ${observation.kind} does not match pool kind ${pool.kind}`);
  }
  // The candidate set is part of a pool's identity. A fresh reading may update
  // capacity/provider, but a disagreement about which candidates serialize
  // against this pool is a pool-identity mismatch and fails closed rather than
  // silently overwriting the balance under a different membership.
  const observed = [...observation.candidates].sort();
  const configured = [...pool.candidates].sort();
  if (observed.length !== configured.length || observed.some((c, i) => c !== configured[i])) {
    throw new Error(`budgetObservation.candidates do not match pool ${pool.poolId} candidates`);
  }
  const next = structuredClone(state);
  const nextPool = next.pools[pool.poolId];
  nextPool.authorizedCapacity = observation.amount;
  nextPool.safetyMargin = observation.safetyMargin;
  nextPool.provider = observation.provider;
  nextPool.sourceRef = observation.sourceRef;
  nextPool.observedAt = observation.observedAt;
  nextPool.freshnessDeadline = observation.freshnessDeadline;
  nextPool.confidence = observation.confidence;
  const fresh = Date.parse(observation.freshnessDeadline) >= nowMs && observation.confidence === "known";
  const { settledTotal } = poolAggregates(next, pool.poolId);
  const restored = realCapacityOf(nextPool, settledTotal) >= 0;
  let cleared = false;
  if (!restored) {
    // A new reading that no longer covers settled charges drives the pool
    // overdrawn regardless of freshness, so projectPool().state can never
    // report "usable" while realCapacity is negative. Fail closed.
    nextPool.overdrawn = true;
  } else if (nextPool.overdrawn && fresh) {
    // Only a KNOWN, non-stale reading that restores non-negative capacity
    // clears overdrawn (verified replenishment).
    nextPool.overdrawn = false;
    cleared = true;
  }
  const frozen = freezeDeep(next);
  return {
    state: frozen,
    decision: freezeDeep({ outcome: "observed", poolId: pool.poolId, clearedOverdrawn: cleared, pool: projectPool(frozen, pool.poolId) }),
  };
}

// Apply an explicit, audited capacity adjustment to a pool. An audited
// adjustment (a verified billing correction) may restore capacity and clear an
// overdrawn pool without a fresh observation. It requires an explicit audit
// flag, actor, and reason, and it never clears candidate quarantine.
export function adjustPool(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "poolAdjustment");
  const poolId = aliasValue(input.poolId, "poolAdjustment.poolId");
  trueValue(input.audited, "poolAdjustment.audited");
  const actor = aliasValue(input.actor, "poolAdjustment.actor");
  const reason = stringValue(input.reason, "poolAdjustment.reason", { maximum: REASON_MAX_BYTES });
  const capacityDelta = integerValue(input.capacityDelta, "poolAdjustment.capacityDelta", { minimum: -AMOUNT_MAX, maximum: AMOUNT_MAX });
  requirePool(state, poolId, "poolAdjustment.poolId");
  const next = structuredClone(state);
  const nextPool = next.pools[poolId];
  nextPool.auditAdjustment += capacityDelta;
  nextPool.lastAudit = { actor, reason, at: now };
  const { settledTotal } = poolAggregates(next, poolId);
  const restored = realCapacityOf(nextPool, settledTotal) >= 0;
  let cleared = false;
  if (!restored) {
    // A negative adjustment that pushes real capacity below zero fails closed
    // to overdrawn, keeping projectPool().state consistent with realCapacity.
    nextPool.overdrawn = true;
  } else if (nextPool.overdrawn) {
    nextPool.overdrawn = false;
    cleared = true;
  }
  const frozen = freezeDeep(next);
  return {
    state: frozen,
    decision: freezeDeep({ outcome: "adjusted", poolId, clearedOverdrawn: cleared, pool: projectPool(frozen, poolId) }),
  };
}

// --- candidate quarantine ---------------------------------------------------

// Quarantine a candidate. Quarantine is a policy state independent of pool
// balance: it blocks reservations for that candidate regardless of usable
// capacity, and pool recovery never clears it. Releasing quarantine is a
// separate, explicit action.
export function quarantineCandidate(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "candidateQuarantine");
  const record = {
    candidate: aliasValue(input.candidate, "candidateQuarantine.candidate"),
    state: "quarantined",
    reason: stringValue(input.reason, "candidateQuarantine.reason", { maximum: REASON_MAX_BYTES }),
    effectiveAt: timestampValue(input.effectiveAt, "candidateQuarantine.effectiveAt"),
  };
  const next = structuredClone(state);
  next.quarantine[record.candidate] = record;
  return { state: freezeDeep(next), decision: freezeDeep({ outcome: "quarantined", candidate: record.candidate }) };
}

export function releaseQuarantine(state, value, { nowIso } = {}) {
  requireDecodedState(state);
  timestampValue(nowIso, "nowIso");
  const input = objectValue(value, "candidateQuarantineRelease");
  const candidate = aliasValue(input.candidate, "candidateQuarantineRelease.candidate");
  const effectiveAt = timestampValue(input.effectiveAt, "candidateQuarantineRelease.effectiveAt");
  const reason = stringValue(input.reason, "candidateQuarantineRelease.reason", { maximum: REASON_MAX_BYTES });
  const next = structuredClone(state);
  next.quarantine[candidate] = { candidate, state: "released", reason, effectiveAt };
  return { state: freezeDeep(next), decision: freezeDeep({ outcome: "quarantine_released", candidate }) };
}

// --- public projection ------------------------------------------------------

// Build the bounded, credential-free public projection of one pool. It exposes
// only the pool identity, units, lifecycle state, usable/real capacity, the
// live reserved and settled totals, the observation freshness/confidence, the
// opaque source reference, and the current revisions. It carries no management
// credential and no raw billing payload — the ledger never stored one, and the
// forbidden-field walker enforced that at every decode boundary.
export function projectPool(state, poolId) {
  requireDecodedState(state);
  const pool = requirePool(state, poolId, "projectPool.poolId");
  const { reservedTotal, settledTotal } = poolAggregates(state, poolId);
  return freezeDeep({
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    poolId: pool.poolId,
    kind: pool.kind,
    units: pool.units,
    state: pool.overdrawn ? "overdrawn" : "usable",
    candidates: [...pool.candidates].sort(),
    authorizedCapacity: pool.authorizedCapacity,
    safetyMargin: pool.safetyMargin,
    auditAdjustment: pool.auditAdjustment,
    reservedTotal,
    settledTotal,
    realCapacity: realCapacityOf(pool, settledTotal),
    usable: usableOf(pool, reservedTotal, settledTotal),
    observedAt: pool.observedAt,
    freshnessDeadline: pool.freshnessDeadline,
    confidence: pool.confidence,
    sourceRef: pool.sourceRef,
    authorizationRevision: pool.authorizationRevision,
    reconcileRevision: pool.reconcileRevision,
    latestAuthorizedAttempt: pool.latestAuthorizedAttempt,
  });
}

// --- retention classification (leaf boundary) ------------------------------

// Classify a reservation/lease/authorization, a receipt, an audit trail, or a
// raw budget observation for retention WITHOUT importing the retention module.
// The returned record is shaped exactly for
// `retention-policy.js#computeRecordLifecycle`, which owns the standard-v1
// durations (90-day terminal operational detail, 180-day force to
// `expired_unknown`, 13-month receipt/audit, 90-day observation). A conflicting
// subject set fails closed rather than selecting the longer duration.
export function classifyBudgetRetention(value, field = "budgetRetention") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const input = objectValue(value, field);
  if (input.subjects !== undefined) {
    throw new Error(`${field} must declare a single subject, not a subjects set`);
  }
  if (input.secondarySubject !== undefined) {
    throw new Error(`${field} must declare a single subject; a conflicting classification fails closed`);
  }
  const subject = enumValue(input.subject, `${field}.subject`, BUDGET_RETENTION_SUBJECT_SET);
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
    // A terminal reservation/lease/authorization retains detailed state for 90
    // days from when it went terminal; an unresolved one is forced to
    // `expired_unknown` after 180 active days. An explicit terminalAt drives the
    // 90-day window; its absence lets computeRecordLifecycle apply the 180-day
    // force.
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
