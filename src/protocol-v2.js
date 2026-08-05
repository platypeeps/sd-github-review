// Budget-aware routed-review protocol, version 2 (A-011 contract definition).
//
// This module owns ONLY the version-2 wire and storage shapes, canonical
// identity rules, privacy bounds, compatibility rules, and setup-discovery
// capability declarations. It never reads GitHub, the checkout, process state,
// or output files, and it never emits a side effect. The parent engine owns
// data flow; this module is the pure trust boundary the engine decodes through.
//
// Version 1 (src/protocol.js, src/receipt.js) stays authoritative for v1 and is
// decoded read-only here. v2 never weakens validation to accept a v1 or default
// dispatch selector.

import { createHash } from "node:crypto";
import { decodeReceipt as decodeV1Receipt } from "./protocol.js";

export const PROTOCOL_V2_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 16 * 1024;
const RESPONSE_MAX_BYTES = 32 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const REASON_MAX_BYTES = 512;
const MAX_COLLECTION_ITEMS = 32;
const MAX_NESTING_DEPTH = 32;

// --- controlled vocabularies -----------------------------------------------

export const SOURCE_MODES = Object.freeze(["standalone", "managed"]);
const SOURCE_MODE_SET = new Set(SOURCE_MODES);

// Standalone advertises no managed budget outcome. The only permitted budget
// outcome value for a standalone contract is `not_managed`.
export const NOT_MANAGED_BUDGET_OUTCOME = "not_managed";

export const CAPABILITY_UNAVAILABLE_REASONS = Object.freeze([
  "not_configured",
  "control_plane_unreachable",
  "incompatible_major",
  "disabled",
]);
const CAPABILITY_UNAVAILABLE_SET = new Set(CAPABILITY_UNAVAILABLE_REASONS);

export const STANDALONE_EXECUTIONS = Object.freeze(["direct-handler", "local-attested"]);
const STANDALONE_EXECUTION_SET = new Set(STANDALONE_EXECUTIONS);

export const PROMPT_PROFILE_MODES = Object.freeze(["referenced", "handler-managed"]);
const PROMPT_PROFILE_MODE_SET = new Set(PROMPT_PROFILE_MODES);

// The only trust level a repository-attested local review may claim. A caller
// assertion or a historical v1 local summary can never mint `independent`.
export const ATTESTED_TRUST_LEVEL = "repository_attested";

export const TRUSTED_ASSOCIATIONS = Object.freeze([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);
const TRUSTED_ASSOCIATION_SET = new Set(TRUSTED_ASSOCIATIONS);

export const REVIEW_LANES = Object.freeze(["review", "assurance", "gate"]);
const REVIEW_LANE_SET = new Set(REVIEW_LANES);

export const CANDIDATE_SLOTS = Object.freeze(["managed", "parallel"]);
const CANDIDATE_SLOT_SET = new Set(CANDIDATE_SLOTS);

export const MERGE_POLICIES = Object.freeze(["block", "allow"]);
const MERGE_POLICY_SET = new Set(MERGE_POLICIES);

export const COST_TIERS = Object.freeze(["free", "low", "medium", "high", "unknown"]);
const COST_TIER_SET = new Set(COST_TIERS);

export const AVAILABILITY_STATES = Object.freeze(["available", "degraded", "unavailable"]);
const AVAILABILITY_STATE_SET = new Set(AVAILABILITY_STATES);

export const REVIEW_OUTCOME_STATES = Object.freeze([
  "pending",
  "completed",
  "skipped",
  "failed",
  "not_managed",
]);
const REVIEW_OUTCOME_STATE_SET = new Set(REVIEW_OUTCOME_STATES);

export const ASSURANCE_OUTCOME_STATES = Object.freeze([
  "pass",
  "fail",
  "deferred",
  "not_applicable",
]);
const ASSURANCE_OUTCOME_STATE_SET = new Set(ASSURANCE_OUTCOME_STATES);

export const GATE_OUTCOME_STATES = Object.freeze(["pass", "block"]);
const GATE_OUTCOME_STATE_SET = new Set(GATE_OUTCOME_STATES);

// Stable reason codes shared across preflight and the three outcome axes.
export const OUTCOME_REASON_CODES = Object.freeze([
  "completed",
  "not_managed",
  "review_none",
  "input_ineligible",
  "incomplete_token_limit",
  "budget_overrun",
  "policy_violation",
  "candidate_quarantined",
  "pool_overdrawn",
  "budget_exhausted_deferred",
]);
const OUTCOME_REASON_CODE_SET = new Set(OUTCOME_REASON_CODES);

// Stable Check names. The gate is the branch-protection-required Check.
export const ASSURANCE_CHECK_NAME = "sd-review / assurance";
export const GATE_CHECK_NAME = "sd-review / gate";
const CHECK_NAME_SET = new Set([ASSURANCE_CHECK_NAME, GATE_CHECK_NAME]);

export const CHECK_CONCLUSIONS = Object.freeze([
  "success",
  "failure",
  "neutral",
  "action_required",
]);
const CHECK_CONCLUSION_SET = new Set(CHECK_CONCLUSIONS);

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. These protect prompt bodies, PR-Agent configuration values,
// credentials, raw balances, and private policy from ever entering a v2 schema.
const FORBIDDEN_FIELD_NAMES = new Set([
  "prompt",
  "prompts",
  "promptbody",
  "promptbodies",
  "profilebody",
  "profilebodies",
  "configuration",
  "config",
  "configurationvalues",
  "configvalues",
  "source",
  "sourcetext",
  "path",
  "paths",
  "file",
  "files",
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
  "apikey",
  "apikeys",
  "balance",
  "balances",
  "rawbalance",
  "rawbalances",
  "privatepolicy",
  "output",
  "outputs",
  "requestcontent",
  "content",
  "contents",
  "artifact",
  "artifacts",
]);

// --- primitive validators (v2-local, matching v1 semantics) ---------------

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

function rejectForbiddenFields(value, field = "value") {
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
      if (FORBIDDEN_FIELD_NAMES.has(normalizedKey)) {
        // Never echo the value: name the field and the boundary only.
        throw new Error(`${current.field}.${key} is forbidden by the v2 privacy boundary`);
      }
      pending.push({
        value: item,
        field: `${current.field}.${key}`,
        depth: current.depth + 1,
      });
    }
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

function schemaVersion(value, field) {
  if (value !== PROTOCOL_V2_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${PROTOCOL_V2_SCHEMA_MAJOR}`);
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

function stringArray(value, field, {
  maximumItems = MAX_COLLECTION_ITEMS,
  maximumBytes = SHORT_TEXT_MAX_BYTES,
  allowed,
  pattern,
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
    const result = stringValue(item, `${field}[${index}]`, { maximum: maximumBytes, pattern });
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

// --- canonicalization, fingerprints, and bounded output --------------------

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

export function stableV2Json(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableV2Json(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered
// equivalent input produces the same digest; any changed field changes it.
export function deriveV2Fingerprint(fields) {
  return sha256(canonicalize(fields));
}

// Project only the allow-listed keys of an already-normalized object. Bounded
// output helpers never surface a field the caller did not enumerate.
export function boundedOutput(value, allowedKeys) {
  const source = objectValue(value, "boundedOutput");
  const allowed = new Set(allowedKeys);
  const projected = {};
  for (const key of Object.keys(source)) {
    if (allowed.has(key) && source[key] !== undefined) {
      projected[key] = source[key];
    }
  }
  return projected;
}

// --- shared identity binding ------------------------------------------------

function mutableBinding(value, field) {
  const binding = objectValue(value, field);
  return {
    repository: repositoryValue(binding.repository, `${field}.repository`),
    pullRequestNumber: integerValue(binding.pullRequestNumber, `${field}.pullRequestNumber`, {
      minimum: 1,
    }),
    headSha: headShaValue(binding.headSha, `${field}.headSha`),
    attempt: integerValue(binding.attempt, `${field}.attempt`, { minimum: 1, maximum: 100 }),
    sourceDigest: digestValue(binding.sourceDigest, `${field}.sourceDigest`),
    catalogDigest: digestValue(binding.catalogDigest, `${field}.catalogDigest`),
    compiledDigest: digestValue(binding.compiledDigest, `${field}.compiledDigest`),
    candidatePlanFingerprint: digestValue(
      binding.candidatePlanFingerprint,
      `${field}.candidatePlanFingerprint`,
    ),
  };
}

// --- prompt-profile binding (discriminated union) --------------------------

// External candidates carry an exact alias/version/digest reference; native
// candidates carry `handler-managed` and no reference. No field represents a
// lane default, inheritance, fallback, or independent override, and no profile
// body ever appears (forbidden-field rejection covers that).
export function decodePromptProfileBinding(value, field = "promptProfile") {
  const binding = objectValue(value, field);
  // No binding — referenced or handler-managed — may declare a lane default,
  // inheritance, fallback, or a command/runtime override. These fields are
  // rejected, never silently stripped.
  for (const forbidden of ["default", "inheritance", "fallback", "commandOverride", "runtimeOverride"]) {
    if (binding[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; a profile binding declares no default, inheritance, fallback, or command/runtime override`);
    }
  }
  const mode = enumValue(binding.mode, `${field}.mode`, PROMPT_PROFILE_MODE_SET);
  if (mode === "handler-managed") {
    for (const forbidden of ["alias", "version", "digest"]) {
      if (binding[forbidden] !== undefined) {
        throw new Error(`${field}.${forbidden} is forbidden for a handler-managed profile`);
      }
    }
    return { mode };
  }
  return {
    mode,
    alias: aliasValue(binding.alias, `${field}.alias`),
    version: semverLikeValue(binding.version, `${field}.version`),
    digest: digestValue(binding.digest, `${field}.digest`),
  };
}

// --- source / compiled contract (standalone | managed) ---------------------

function decodeAttestationPolicy(value, field) {
  const policy = objectValue(value, field);
  const allowedAssociations = stringArray(
    policy.allowedAssociations,
    `${field}.allowedAssociations`,
    { allowed: TRUSTED_ASSOCIATION_SET, maximumItems: 8, allowEmpty: false },
  );
  return {
    trustPolicyRef: stringValue(policy.trustPolicyRef, `${field}.trustPolicyRef`, {
      maximum: SHORT_TEXT_MAX_BYTES,
    }),
    allowedAssociations,
    allowPrAuthor: booleanValue(policy.allowPrAuthor, `${field}.allowPrAuthor`),
    maxAgeSeconds: integerValue(policy.maxAgeSeconds, `${field}.maxAgeSeconds`, {
      minimum: 1,
      maximum: 31_536_000,
    }),
  };
}

function decodeStandaloneRoute(value, field) {
  const route = objectValue(value, field);
  const execution = enumValue(route.execution, `${field}.execution`, STANDALONE_EXECUTION_SET);
  if (execution === "direct-handler") {
    // A direct handler uses one setup-discovered profile. No trust-policy or
    // attestation fields may appear.
    for (const forbidden of ["trustPolicyRef", "attestation", "slot"]) {
      if (route[forbidden] !== undefined) {
        throw new Error(`${field}.${forbidden} is forbidden for a direct-handler route`);
      }
    }
    return {
      execution,
      handler: stringValue(route.handler, `${field}.handler`, { maximum: SHORT_TEXT_MAX_BYTES }),
      promptProfile: decodePromptProfileBinding(route.promptProfile, `${field}.promptProfile`),
    };
  }
  // local-attested carries one explicit trust policy and no handler/provider or
  // prompt-profile fields, and no managed/parallel slot in the initial contract.
  for (const forbidden of ["handler", "provider", "promptProfile", "slot"]) {
    if (route[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden for a local-attested route`);
    }
  }
  return {
    execution,
    attestation: decodeAttestationPolicy(route.attestation, `${field}.attestation`),
  };
}

function decodeManagedLane(value, field) {
  const lane = objectValue(value, field);
  // Managed lanes must carry an explicit merge policy. There is no runtime
  // default; a legacy exhaustion value (boolean, "defer", "skip", ...) fails.
  const exhaustion = objectValue(lane.budgetExhaustion, `${field}.budgetExhaustion`);
  if (typeof exhaustion.merge !== "string") {
    throw new Error(`${field}.budgetExhaustion.merge must be a string`);
  }
  const merge = enumValue(exhaustion.merge, `${field}.budgetExhaustion.merge`, MERGE_POLICY_SET);
  return {
    slot: enumValue(lane.slot, `${field}.slot`, CANDIDATE_SLOT_SET),
    budgetExhaustion: { merge },
    candidate: {
      candidateDigest: digestValue(lane.candidate?.candidateDigest, `${field}.candidate.candidateDigest`),
      promptProfile: decodePromptProfileBinding(
        lane.candidate?.promptProfile,
        `${field}.candidate.promptProfile`,
      ),
    },
  };
}

export function decodeSourceContract(value) {
  rejectForbiddenFields(value, "sourceContract");
  assertEncodedSize(value, "sourceContract", CONTRACT_MAX_BYTES);
  const contract = objectValue(value, "sourceContract");
  schemaVersion(contract.schemaVersion, "sourceContract.schemaVersion");
  if (typeof contract.mode !== "string") {
    throw new Error("sourceContract.mode must be a string");
  }
  const mode = enumValue(contract.mode, "sourceContract.mode", SOURCE_MODE_SET);

  if (mode === "standalone") {
    // Standalone advertises no control plane. It must declare not_managed and
    // must not carry managed lanes or catalog/control-plane bindings.
    if (contract.budgetOutcome !== NOT_MANAGED_BUDGET_OUTCOME) {
      throw new Error(`sourceContract.budgetOutcome must be ${NOT_MANAGED_BUDGET_OUTCOME} for standalone mode`);
    }
    for (const forbidden of ["lanes", "catalogDigest", "controlPlane"]) {
      if (contract[forbidden] !== undefined) {
        throw new Error(`sourceContract.${forbidden} is forbidden for standalone mode`);
      }
    }
    const routeEntries = Object.entries(objectValue(contract.routes, "sourceContract.routes"));
    if (routeEntries.length === 0) {
      throw new Error("sourceContract.routes must declare at least one route");
    }
    const routes = {};
    for (const [name, routeValue] of routeEntries) {
      const routeName = enumValue(name, "sourceContract.routes key", REVIEW_LANE_SET);
      routes[routeName] = decodeStandaloneRoute(routeValue, `sourceContract.routes.${routeName}`);
    }
    const normalized = {
      schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
      mode,
      budgetOutcome: NOT_MANAGED_BUDGET_OUTCOME,
      routes,
    };
    if (contract.capabilityUnavailableReason !== undefined) {
      normalized.capabilityUnavailableReason = enumValue(
        contract.capabilityUnavailableReason,
        "sourceContract.capabilityUnavailableReason",
        CAPABILITY_UNAVAILABLE_SET,
      );
    }
    return normalized;
  }

  // managed
  // `capabilityUnavailableReason` is emitted only in the standalone branch;
  // a managed contract carrying it is a mixed/invalid mode.
  for (const forbidden of ["routes", "budgetOutcome", "capabilityUnavailableReason"]) {
    if (contract[forbidden] !== undefined) {
      throw new Error(`sourceContract.${forbidden} is forbidden for managed mode`);
    }
  }
  const laneEntries = Object.entries(objectValue(contract.lanes, "sourceContract.lanes"));
  if (laneEntries.length === 0) {
    throw new Error("sourceContract.lanes must declare at least one lane");
  }
  const lanes = {};
  for (const [name, laneValue] of laneEntries) {
    const laneName = enumValue(name, "sourceContract.lanes key", REVIEW_LANE_SET);
    lanes[laneName] = decodeManagedLane(laneValue, `sourceContract.lanes.${laneName}`);
  }
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    mode,
    catalogDigest: digestValue(contract.catalogDigest, "sourceContract.catalogDigest"),
    configurationDigest: digestValue(contract.configurationDigest, "sourceContract.configurationDigest"),
    lanes,
  };
}

// --- candidate request preflight (side-effect-free) ------------------------

export function decodeCandidatePreflight(value) {
  rejectForbiddenFields(value, "preflight");
  assertEncodedSize(value, "preflight", CONTRACT_MAX_BYTES);
  const preflight = objectValue(value, "preflight");
  schemaVersion(preflight.schemaVersion, "preflight.schemaVersion");
  const units = enumValue(preflight.units, "preflight.units", new Set(["tokens"]));
  const countedInputTokens = integerValue(
    preflight.countedInputTokens,
    "preflight.countedInputTokens",
    { maximum: 100_000_000 },
  );
  const inputCounted = booleanValue(preflight.inputCounted, "preflight.inputCounted");
  const outputCap = integerValue(preflight.outputCap, "preflight.outputCap", {
    minimum: 1,
    maximum: 100_000_000,
  });
  const maxExpectedCharge = integerValue(preflight.maxExpectedCharge, "preflight.maxExpectedCharge", {
    minimum: 1,
    maximum: 100_000_000,
  });
  const hardRequestLimit = integerValue(preflight.hardRequestLimit, "preflight.hardRequestLimit", {
    minimum: 1,
    maximum: 100_000_000,
  });
  const safetyMargin = integerValue(preflight.safetyMargin, "preflight.safetyMargin", {
    maximum: 100_000_000,
  });
  if (maxExpectedCharge > hardRequestLimit) {
    throw new Error("preflight.maxExpectedCharge must not exceed hardRequestLimit");
  }
  const capability = objectValue(preflight.capabilityEvidence, "preflight.capabilityEvidence");
  const available = booleanValue(capability.available, "preflight.capabilityEvidence.available");
  const reason = capability.reason === undefined
    ? undefined
    : enumValue(capability.reason, "preflight.capabilityEvidence.reason", CAPABILITY_UNAVAILABLE_SET);
  if (available && reason !== undefined) {
    throw new Error("preflight.capabilityEvidence.reason is valid only when capability is unavailable");
  }
  if (!available && reason === undefined) {
    throw new Error("preflight.capabilityEvidence.reason is required when capability is unavailable");
  }
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    headSha: headShaValue(preflight.headSha, "preflight.headSha"),
    candidateDigest: digestValue(preflight.candidateDigest, "preflight.candidateDigest"),
    promptProfileDigest: digestValue(preflight.promptProfileDigest, "preflight.promptProfileDigest"),
    policyDigest: digestValue(preflight.policyDigest, "preflight.policyDigest"),
    configurationDigest: digestValue(preflight.configurationDigest, "preflight.configurationDigest"),
    units,
    countedInputTokens,
    inputCounted,
    outputCap,
    maxExpectedCharge,
    hardRequestLimit,
    safetyMargin,
    capabilityEvidence: { available, ...(reason === undefined ? {} : { reason }) },
  };
}

// --- candidate-options response (bounded, unauthenticated) -----------------

function decodeCandidateOption(value, field) {
  const option = objectValue(value, field);
  // A candidate option must not carry any attempt-identifying binding.
  for (const forbidden of ["headSha", "logicalDispatchId", "attempt", "pullRequestNumber"]) {
    if (option[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; candidate options cannot identify an attempt`);
    }
  }
  const availability = objectValue(option.availability, `${field}.availability`);
  const state = enumValue(availability.state, `${field}.availability.state`, AVAILABILITY_STATE_SET);
  const availabilityReason = optionalString(availability.reason, `${field}.availability.reason`, {
    maximum: REASON_MAX_BYTES,
  });
  if (state === "available" && availabilityReason !== undefined) {
    throw new Error(`${field}.availability.reason is valid only for a non-available state`);
  }
  return {
    alias: aliasValue(option.alias, `${field}.alias`),
    displayName: stringValue(option.displayName, `${field}.displayName`, { maximum: SHORT_TEXT_MAX_BYTES }),
    handler: stringValue(option.handler, `${field}.handler`, { maximum: SHORT_TEXT_MAX_BYTES }),
    costTier: enumValue(option.costTier, `${field}.costTier`, COST_TIER_SET),
    eligibleLanes: stringArray(option.eligibleLanes, `${field}.eligibleLanes`, {
      allowed: REVIEW_LANE_SET,
      allowEmpty: false,
    }),
    eligibleSlots: stringArray(option.eligibleSlots, `${field}.eligibleSlots`, {
      allowed: CANDIDATE_SLOT_SET,
      allowEmpty: false,
    }),
    availability: { state, ...(availabilityReason === undefined ? {} : { reason: availabilityReason }) },
  };
}

export function decodeCandidateOptionsResponse(value) {
  rejectForbiddenFields(value, "candidateOptions");
  assertEncodedSize(value, "candidateOptions", RESPONSE_MAX_BYTES);
  const response = objectValue(value, "candidateOptions");
  schemaVersion(response.schemaVersion, "candidateOptions.schemaVersion");
  // The response is not attempt-bound: it must not carry a head or dispatch ID.
  for (const forbidden of ["headSha", "logicalDispatchId", "attempt"]) {
    if (response[forbidden] !== undefined) {
      throw new Error(`candidateOptions.${forbidden} is forbidden; a catalog view cannot authorize an attempt`);
    }
  }
  if (!Array.isArray(response.options)) {
    throw new Error("candidateOptions.options must be an array");
  }
  if (response.options.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`candidateOptions.options exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const options = response.options.map((option, index) =>
    decodeCandidateOption(option, `candidateOptions.options[${index}]`));
  const aliases = options.map((option) => option.alias);
  if (new Set(aliases).size !== aliases.length) {
    throw new Error("candidateOptions.options must use unique aliases");
  }
  // Deterministic ordering by alias.
  options.sort((left, right) => (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0));
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    catalogDigest: digestValue(response.catalogDigest, "candidateOptions.catalogDigest"),
    configurationDigest: digestValue(response.configurationDigest, "candidateOptions.configurationDigest"),
    options,
  };
}

// --- three-axis review outcomes --------------------------------------------

function decodeOutcomeAxis(value, field, allowedStates) {
  const axis = objectValue(value, field);
  return {
    state: enumValue(axis.state, `${field}.state`, allowedStates),
    reasonCode: enumValue(axis.reasonCode, `${field}.reasonCode`, OUTCOME_REASON_CODE_SET),
  };
}

export function decodeReviewOutcomes(value) {
  rejectForbiddenFields(value, "outcomes");
  assertEncodedSize(value, "outcomes", CONTRACT_MAX_BYTES);
  const outcomes = objectValue(value, "outcomes");
  schemaVersion(outcomes.schemaVersion, "outcomes.schemaVersion");
  const reviewOutcome = decodeOutcomeAxis(
    outcomes.reviewOutcome,
    "outcomes.reviewOutcome",
    REVIEW_OUTCOME_STATE_SET,
  );
  const assuranceOutcome = decodeOutcomeAxis(
    outcomes.assuranceOutcome,
    "outcomes.assuranceOutcome",
    ASSURANCE_OUTCOME_STATE_SET,
  );
  const gateOutcome = decodeOutcomeAxis(
    outcomes.gateOutcome,
    "outcomes.gateOutcome",
    GATE_OUTCOME_STATE_SET,
  );
  // Proven pre-dispatch budget exhaustion is the ONLY failure that may defer
  // assurance while leaving the gate free to pass. Every other non-pass
  // assurance outcome must block the gate.
  if (assuranceOutcome.state === "deferred") {
    if (assuranceOutcome.reasonCode !== "budget_exhausted_deferred") {
      throw new Error("outcomes.assuranceOutcome deferred requires the budget_exhausted_deferred reason");
    }
  }
  // Deferred assurance (proven budget exhaustion) is the sole failure that
  // leaves the gate free. EVERY other non-budget failure axis — a failed review
  // or a failed assurance — must block the gate, independent of the other axes.
  const nonBudgetFailure = reviewOutcome.state === "failed" || assuranceOutcome.state === "fail";
  if (nonBudgetFailure && gateOutcome.state !== "block") {
    throw new Error("outcomes.gateOutcome must block when a non-budget failure occurs");
  }
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    headSha: headShaValue(outcomes.headSha, "outcomes.headSha"),
    attempt: integerValue(outcomes.attempt, "outcomes.attempt", { minimum: 1, maximum: 100 }),
    logicalDispatchId: digestValue(outcomes.logicalDispatchId, "outcomes.logicalDispatchId"),
    reviewOutcome,
    assuranceOutcome,
    gateOutcome,
  };
}

// --- exact-head Check projection + compare-and-swap ------------------------

export function decodeCheckProjection(value) {
  rejectForbiddenFields(value, "checkProjection");
  assertEncodedSize(value, "checkProjection", CONTRACT_MAX_BYTES);
  const projection = objectValue(value, "checkProjection");
  schemaVersion(projection.schemaVersion, "checkProjection.schemaVersion");
  const checkName = enumValue(projection.checkName, "checkProjection.checkName", CHECK_NAME_SET);
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    checkName,
    headSha: headShaValue(projection.headSha, "checkProjection.headSha"),
    conclusion: enumValue(projection.conclusion, "checkProjection.conclusion", CHECK_CONCLUSION_SET),
    revision: integerValue(projection.revision, "checkProjection.revision", {
      minimum: 1,
      maximum: 1_000_000,
    }),
    attempt: integerValue(projection.attempt, "checkProjection.attempt", { minimum: 1, maximum: 100 }),
    latestAuthorizedAttemptToken: digestValue(
      projection.latestAuthorizedAttemptToken,
      "checkProjection.latestAuthorizedAttemptToken",
    ),
  };
}

// Pure compare-and-swap authorization for a projection write. Same-head
// recovery reuses the head; a changed head supersedes only with a higher
// revision; a stale or equal revision is rejected. The next write must carry
// the latest authorized attempt token.
export function authorizeProjectionWrite(previous, next, { authorizedAttemptToken } = {}) {
  const candidate = decodeCheckProjection(next);
  const token = digestValue(authorizedAttemptToken, "authorizedAttemptToken");
  if (candidate.latestAuthorizedAttemptToken !== token) {
    throw new Error("checkProjection write must carry the latest authorized attempt token");
  }
  if (previous === null || previous === undefined) {
    if (candidate.revision !== 1) {
      throw new Error("initial checkProjection revision must be 1");
    }
    return { authorized: true, reason: "initial", projection: candidate };
  }
  const current = decodeCheckProjection(previous);
  if (current.checkName !== candidate.checkName) {
    throw new Error("checkProjection write must target the same Check name");
  }
  if (candidate.revision <= current.revision) {
    throw new Error("checkProjection revision must strictly increase");
  }
  const reason = current.headSha === candidate.headSha ? "same-head-recovery" : "changed-head-supersession";
  return { authorized: true, reason, projection: candidate };
}

// --- setup discovery (v2) ---------------------------------------------------

function decodeCheckDescriptor(value, field, expectedName) {
  const descriptor = objectValue(value, field);
  const name = enumValue(descriptor.name, `${field}.name`, new Set([expectedName]));
  return {
    name,
    branchProtectionRequired: booleanValue(
      descriptor.branchProtectionRequired,
      `${field}.branchProtectionRequired`,
    ),
  };
}

export function decodeSetupDiscoveryV2(value) {
  rejectForbiddenFields(value, "setupDiscovery");
  assertEncodedSize(value, "setupDiscovery", CONTRACT_MAX_BYTES);
  const discovery = objectValue(value, "setupDiscovery");
  schemaVersion(discovery.schemaVersion, "setupDiscovery.schemaVersion");
  const activeMajor = integerValue(discovery.activeMajor, "setupDiscovery.activeMajor", {
    minimum: PROTOCOL_V2_SCHEMA_MAJOR,
    maximum: PROTOCOL_V2_SCHEMA_MAJOR,
  });
  const checks = objectValue(discovery.checks, "setupDiscovery.checks");
  const assurance = decodeCheckDescriptor(checks.assurance, "setupDiscovery.checks.assurance", ASSURANCE_CHECK_NAME);
  const gate = decodeCheckDescriptor(checks.gate, "setupDiscovery.checks.gate", GATE_CHECK_NAME);
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    activeMajor,
    checks: { assurance, gate },
    gateOnlyBranchProtection: gate.branchProtectionRequired && !assurance.branchProtectionRequired,
    optionalCapabilities: discovery.optionalCapabilities === undefined
      ? []
      : stringArray(discovery.optionalCapabilities, "setupDiscovery.optionalCapabilities", {
          pattern: /^[a-z0-9][a-z0-9._-]*$/u,
          lower: true,
        }),
  };
}

// --- historical v1 read-only decoding + v2 dispatch selector ---------------

// Read a historical v1 receipt for display/reconciliation only. The returned
// record is frozen and tagged read-only; it can never authorize v2 dispatch.
export function decodeHistoricalV1Receipt(value) {
  const receipt = decodeV1Receipt(value);
  return Object.freeze({ readOnly: true, schemaMajor: 1, receipt });
}

// Guard the v2 dispatch boundary. A v1 selector, a default/absent selector, or
// any non-2 major is rejected before new v2 work begins.
export function assertV2DispatchSelector(value, field = "dispatchSelector") {
  if (value === undefined || value === null) {
    throw new Error(`${field} must select an explicit v2 contract major`);
  }
  const selector = objectValue(value, field);
  if (selector.contractMajor === undefined) {
    throw new Error(`${field}.contractMajor must select an explicit v2 contract major`);
  }
  if (selector.contractMajor === 1) {
    throw new Error(`${field}.contractMajor 1 cannot authorize v2 dispatch`);
  }
  if (selector.contractMajor !== PROTOCOL_V2_SCHEMA_MAJOR) {
    throw new Error(`${field}.contractMajor must be ${PROTOCOL_V2_SCHEMA_MAJOR}`);
  }
  if (selector.default === true) {
    throw new Error(`${field} must not rely on a default selector for v2 dispatch`);
  }
  return { contractMajor: PROTOCOL_V2_SCHEMA_MAJOR };
}

export { mutableBinding as decodeMutableBinding };
