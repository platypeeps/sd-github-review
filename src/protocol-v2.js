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

// A reviewer slot selects one fixed candidate or one named chain. There is no
// contextual-default or legacy selector kind.
export const SLOT_SELECTOR_KINDS = Object.freeze(["candidate", "chain"]);
const SLOT_SELECTOR_KIND_SET = new Set(SLOT_SELECTOR_KINDS);
const MAX_REVIEWER_SLOTS = 8;
const MAX_CHAIN_MEMBERS = 8;

export const MERGE_POLICIES = Object.freeze(["block", "allow"]);
const MERGE_POLICY_SET = new Set(MERGE_POLICIES);

export const COST_TIERS = Object.freeze(["free", "low", "medium", "high", "unknown"]);
const COST_TIER_SET = new Set(COST_TIERS);

export const AVAILABILITY_STATES = Object.freeze(["available", "degraded", "unavailable"]);
const AVAILABILITY_STATE_SET = new Set(AVAILABILITY_STATES);

// A local publisher reports one of these raw review results. `awaiting` is
// never publisher-reported; the ingestion boundary derives it when no
// exact-head evidence exists.
export const LOCAL_REVIEW_RESULTS = Object.freeze(["clean", "findings", "error"]);
const LOCAL_REVIEW_RESULT_SET = new Set(LOCAL_REVIEW_RESULTS);

// Durable local-attested review-lane states. Only `completed_local` (clean
// exact-head evidence) may satisfy assurance and pass the gate; every other
// state blocks.
export const LOCAL_REVIEW_OUTCOME_STATES = Object.freeze([
  "completed_local",
  "completed_local_findings",
  "awaiting_local_attestation",
  "failed_local",
]);
const LOCAL_REVIEW_OUTCOME_STATE_SET = new Set(LOCAL_REVIEW_OUTCOME_STATES);
const LOCAL_BLOCKING_REVIEW_STATES = new Set([
  "completed_local_findings",
  "awaiting_local_attestation",
  "failed_local",
]);

// The only discriminant value a usage projection may carry. Usage is advisory
// and never authoritative budget or billing evidence.
export const SELF_REPORTED_LOCAL_SOURCE = "self_reported_local";

export const REVIEW_OUTCOME_STATES = Object.freeze([
  "pending",
  "completed",
  "skipped",
  "failed",
  "not_managed",
  ...LOCAL_REVIEW_OUTCOME_STATES,
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
  "local_clean",
  "local_findings",
  "awaiting_local_attestation",
  "local_head_mismatch",
  "local_evidence_expired",
  "local_unauthorized",
  "local_terminal_error",
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
  // leaves the gate free. EVERY other non-budget failure axis must block the
  // gate, independent of the other axes: a failed review, a failed assurance,
  // or a review skipped for any reason other than the sanctioned budget defer.
  const reviewSkippedNonBudget =
    reviewOutcome.state === "skipped" && reviewOutcome.reasonCode !== "budget_exhausted_deferred";
  // A local-attested review satisfies assurance and the gate ONLY with clean
  // exact-head evidence (`completed_local`). Findings, a missing/new-head
  // (awaiting), or a terminal local failure are non-budget failures: they can
  // never pass assurance and must block the gate.
  const localBlocking = LOCAL_BLOCKING_REVIEW_STATES.has(reviewOutcome.state);
  if (localBlocking && assuranceOutcome.state === "pass") {
    throw new Error("outcomes.assuranceOutcome cannot pass without clean exact-head local review evidence");
  }
  const nonBudgetFailure =
    reviewOutcome.state === "failed"
    || assuranceOutcome.state === "fail"
    || reviewSkippedNonBudget
    || localBlocking;
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

// --- local-attested review contracts ---------------------------------------

// The evidence binding every local-attested contract shares. It binds the exact
// repository, PR, full head, lane, attempt, configuration, local receipt and
// content digests, and the evidence fingerprint. Transport correlations and
// GitHub-derived actor/association fields never appear here.
function decodeLocalEvidenceBinding(source, field) {
  return {
    repository: repositoryValue(source.repository, `${field}.repository`),
    pullRequestNumber: integerValue(source.pullRequestNumber, `${field}.pullRequestNumber`, {
      minimum: 1,
    }),
    headSha: headShaValue(source.headSha, `${field}.headSha`),
    lane: enumValue(source.lane, `${field}.lane`, REVIEW_LANE_SET),
    attempt: integerValue(source.attempt, `${field}.attempt`, { minimum: 1, maximum: 100 }),
    configurationDigest: digestValue(source.configurationDigest, `${field}.configurationDigest`),
    localReceiptDigest: digestValue(source.localReceiptDigest, `${field}.localReceiptDigest`),
    contentDigest: digestValue(source.contentDigest, `${field}.contentDigest`),
    evidenceDigest: digestValue(source.evidenceDigest, `${field}.evidenceDigest`),
  };
}

// The only trust level a repository-attested review may mint. `independent` is
// reserved for a future independent issuer contract and can never be claimed
// here; every other value is rejected.
function decodeAttestedTrustLevel(value, field) {
  const level = stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES, lower: true });
  if (level === "independent") {
    throw new Error(`${field} 'independent' is reserved for a future independent issuer contract and cannot be minted here`);
  }
  if (level !== ATTESTED_TRUST_LEVEL) {
    throw new Error(`${field} must be ${ATTESTED_TRUST_LEVEL}`);
  }
  return ATTESTED_TRUST_LEVEL;
}

// Self-reported usage is a separately discriminated, advisory projection. It
// carries only a coarse token/tier estimate, never a monetary balance
// (forbidden-field rejection covers balance names), and is stamped
// non-authoritative so it can never be mistaken for budget or billing evidence.
export function decodeSelfReportedUsage(value, field = "usage") {
  rejectForbiddenFields(value, field);
  const usage = objectValue(value, field);
  for (const forbidden of ["authoritative", "billed", "billing", "charge", "managed", "budget"]) {
    if (usage[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; self-reported usage is never authoritative budget or billing evidence`);
    }
  }
  const kind = enumValue(usage.kind, `${field}.kind`, new Set([SELF_REPORTED_LOCAL_SOURCE]));
  const normalized = { kind, authoritative: false };
  if (usage.inputTokens !== undefined) {
    normalized.inputTokens = integerValue(usage.inputTokens, `${field}.inputTokens`, {
      maximum: 100_000_000,
    });
  }
  if (usage.outputTokens !== undefined) {
    normalized.outputTokens = integerValue(usage.outputTokens, `${field}.outputTokens`, {
      maximum: 100_000_000,
    });
  }
  if (usage.costTier !== undefined) {
    normalized.costTier = enumValue(usage.costTier, `${field}.costTier`, COST_TIER_SET);
  }
  return normalized;
}

// The authenticated GitHub publication context. Every field here is derived by
// the ingestion boundary from GitHub, never asserted by the caller.
function decodeLocalPublicationContext(value, field) {
  const context = objectValue(value, field);
  return {
    publisher: aliasValue(context.publisher, `${field}.publisher`),
    association: enumValue(context.association, `${field}.association`, TRUSTED_ASSOCIATION_SET),
    isPrAuthor: booleanValue(context.isPrAuthor, `${field}.isPrAuthor`),
    workflowRef: stringValue(context.workflowRef, `${field}.workflowRef`, {
      maximum: SHORT_TEXT_MAX_BYTES,
    }),
    runId: integerValue(context.runId, `${field}.runId`, { minimum: 1 }),
    runAttempt: integerValue(context.runAttempt, `${field}.runAttempt`, { minimum: 1, maximum: 1000 }),
  };
}

// Fields the ingestion boundary derives from GitHub. A local attestation
// request that pre-asserts any of them is rejected: a caller can never mint its
// own actor, association, workflow, authorization, or trust level.
const REQUEST_DERIVED_FORBIDDEN = Object.freeze([
  "actor",
  "association",
  "publisher",
  "publicationContext",
  "workflow",
  "workflowRef",
  "runId",
  "runAttempt",
  "authorization",
  "authorized",
  "authorizationResult",
  "trustLevel",
  "trusted",
]);

// The bounded attestation request a local publisher submits. It binds the exact
// evidence identity and the raw review result, and may carry only self-reported
// usage. It never carries GitHub-derived publication context or authorization.
export function decodeLocalAttestationRequest(value) {
  rejectForbiddenFields(value, "localAttestationRequest");
  assertEncodedSize(value, "localAttestationRequest", CONTRACT_MAX_BYTES);
  const request = objectValue(value, "localAttestationRequest");
  schemaVersion(request.schemaVersion, "localAttestationRequest.schemaVersion");
  for (const forbidden of REQUEST_DERIVED_FORBIDDEN) {
    if (request[forbidden] !== undefined) {
      throw new Error(`localAttestationRequest.${forbidden} is forbidden; the ingestion boundary derives publication context and authorization from GitHub`);
    }
  }
  const binding = decodeLocalEvidenceBinding(request, "localAttestationRequest");
  const reviewResult = enumValue(request.reviewResult, "localAttestationRequest.reviewResult", LOCAL_REVIEW_RESULT_SET);
  const producedAt = timestampValue(request.producedAt, "localAttestationRequest.producedAt");
  const normalized = {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    ...binding,
    reviewResult,
    producedAt,
  };
  if (request.usage !== undefined) {
    normalized.usage = decodeSelfReportedUsage(request.usage, "localAttestationRequest.usage");
  }
  return normalized;
}

// The ingestion-derived authorization result. This is where repository-attested
// trust is minted from the authenticated publisher plus policy. Self-reported
// usage never enters authorization, and only clean exact-head evidence may be
// authorized. A derived attempt token binds the whole authorized identity.
export function decodeLocalReviewAuthorization(value) {
  rejectForbiddenFields(value, "localReviewAuthorization");
  assertEncodedSize(value, "localReviewAuthorization", CONTRACT_MAX_BYTES);
  const auth = objectValue(value, "localReviewAuthorization");
  schemaVersion(auth.schemaVersion, "localReviewAuthorization.schemaVersion");
  if (auth.usage !== undefined) {
    throw new Error("localReviewAuthorization.usage is forbidden; self-reported usage never enters managed authorization or balance");
  }
  const binding = decodeLocalEvidenceBinding(auth, "localReviewAuthorization");
  const trustLevel = decodeAttestedTrustLevel(auth.trustLevel, "localReviewAuthorization.trustLevel");
  const publicationContext = decodeLocalPublicationContext(
    auth.publicationContext,
    "localReviewAuthorization.publicationContext",
  );
  const authorized = booleanValue(auth.authorized, "localReviewAuthorization.authorized");
  const reviewResult = enumValue(auth.reviewResult, "localReviewAuthorization.reviewResult", LOCAL_REVIEW_RESULT_SET);
  const attestationDigest = digestValue(auth.attestationDigest, "localReviewAuthorization.attestationDigest");
  const policyDigest = digestValue(auth.policyDigest, "localReviewAuthorization.policyDigest");
  // Only authorized, exact-head clean evidence may authorize a pass. Findings,
  // a terminal error, or an unauthorized publisher can never be an authorized
  // pass.
  if (authorized && reviewResult !== "clean") {
    throw new Error("localReviewAuthorization may authorize only clean local review evidence");
  }
  const attemptToken = deriveV2Fingerprint({
    ...binding,
    attestationDigest,
    trustLevel,
    policyDigest,
    publicationContext,
  });
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    ...binding,
    trustLevel,
    authorized,
    reviewResult,
    attestationDigest,
    policyDigest,
    publicationContext,
    attemptToken,
  };
}

// The immutable durable receipt for an ingested local review. It records the
// repository-attested trust level, the governing policy digest, the authenticated
// publication context, and only a clean outcome class satisfies the gate.
export function decodeLocalReviewReceipt(value) {
  rejectForbiddenFields(value, "localReviewReceipt");
  assertEncodedSize(value, "localReviewReceipt", CONTRACT_MAX_BYTES);
  const receipt = objectValue(value, "localReviewReceipt");
  schemaVersion(receipt.schemaVersion, "localReviewReceipt.schemaVersion");
  if (receipt.usage !== undefined) {
    throw new Error("localReviewReceipt.usage is forbidden; a durable receipt records no self-reported usage");
  }
  const binding = decodeLocalEvidenceBinding(receipt, "localReviewReceipt");
  const trustLevel = decodeAttestedTrustLevel(receipt.trustLevel, "localReviewReceipt.trustLevel");
  const outcomeClass = enumValue(receipt.outcomeClass, "localReviewReceipt.outcomeClass", LOCAL_REVIEW_OUTCOME_STATE_SET);
  const policyDigest = digestValue(receipt.policyDigest, "localReviewReceipt.policyDigest");
  const attestationDigest = digestValue(receipt.attestationDigest, "localReviewReceipt.attestationDigest");
  const publicationContext = decodeLocalPublicationContext(
    receipt.publicationContext,
    "localReviewReceipt.publicationContext",
  );
  const recordedAt = timestampValue(receipt.recordedAt, "localReviewReceipt.recordedAt");
  return Object.freeze({
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    ...binding,
    trustLevel,
    outcomeClass,
    gateSatisfied: outcomeClass === "completed_local",
    policyDigest,
    attestationDigest,
    publicationContext,
    recordedAt,
  });
}

// The bounded local-attestation status projection. It carries only identities,
// counts, timestamps, and (for a settled state) the evidence digest. While
// awaiting exact-head evidence, no evidence digest is bound.
export function decodeLocalAttestationStatus(value) {
  rejectForbiddenFields(value, "localAttestationStatus");
  assertEncodedSize(value, "localAttestationStatus", CONTRACT_MAX_BYTES);
  const status = objectValue(value, "localAttestationStatus");
  schemaVersion(status.schemaVersion, "localAttestationStatus.schemaVersion");
  const state = enumValue(status.state, "localAttestationStatus.state", LOCAL_REVIEW_OUTCOME_STATE_SET);
  const normalized = {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    repository: repositoryValue(status.repository, "localAttestationStatus.repository"),
    pullRequestNumber: integerValue(status.pullRequestNumber, "localAttestationStatus.pullRequestNumber", {
      minimum: 1,
    }),
    headSha: headShaValue(status.headSha, "localAttestationStatus.headSha"),
    lane: enumValue(status.lane, "localAttestationStatus.lane", REVIEW_LANE_SET),
    attempt: integerValue(status.attempt, "localAttestationStatus.attempt", { minimum: 1, maximum: 100 }),
    state,
    updatedAt: timestampValue(status.updatedAt, "localAttestationStatus.updatedAt"),
  };
  // Awaiting means no exact-head evidence exists yet: an evidence digest must be
  // absent. Every settled state must bind the evidence it projects.
  if (state === "awaiting_local_attestation") {
    if (status.evidenceDigest !== undefined) {
      throw new Error("localAttestationStatus.evidenceDigest must be absent while awaiting local attestation");
    }
  } else {
    normalized.evidenceDigest = digestValue(status.evidenceDigest, "localAttestationStatus.evidenceDigest");
  }
  return normalized;
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
  if (current.headSha === candidate.headSha) {
    // Same-head recovery continues the current attempt: the presented token is a
    // compare-and-swap witness that must match the current projection's latest
    // authorized attempt token, not merely the token copied into the candidate.
    // Without this a caller holding a stale token could recover the same head.
    if (current.latestAuthorizedAttemptToken !== token) {
      throw new Error("same-head checkProjection recovery must reuse the current authorized attempt token");
    }
    return { authorized: true, reason: "same-head-recovery", projection: candidate };
  }
  return { authorized: true, reason: "changed-head-supersession", projection: candidate };
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

// --- parallel reviewer plan compiler ---------------------------------------

// One slot selector: a fixed candidate digest OR one named chain. The two arms
// are mutually exclusive; carrying the other arm's field is rejected.
function decodeSlotSelector(value, field) {
  const selector = objectValue(value, field);
  const kind = enumValue(selector.kind, `${field}.kind`, SLOT_SELECTOR_KIND_SET);
  if (kind === "candidate") {
    if (selector.chain !== undefined) {
      throw new Error(`${field}.chain is forbidden for a candidate selector`);
    }
    return { kind, candidateDigest: digestValue(selector.candidateDigest, `${field}.candidateDigest`) };
  }
  if (selector.candidateDigest !== undefined) {
    throw new Error(`${field}.candidateDigest is forbidden for a chain selector`);
  }
  return { kind, chain: aliasValue(selector.chain, `${field}.chain`) };
}

// One reviewer slot declaration. A slot never carries attempt identity or
// reservation state — compilation stops before any dispatch or reservation.
function decodeReviewerSlot(value, field) {
  const slot = objectValue(value, field);
  for (const forbidden of ["headSha", "attempt", "logicalDispatchId", "reservation", "reserved"]) {
    if (slot[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; a slot declaration cannot reserve or identify an attempt`);
    }
  }
  return {
    slotId: aliasValue(slot.slotId, `${field}.slotId`),
    lane: enumValue(slot.lane, `${field}.lane`, REVIEW_LANE_SET),
    selector: decodeSlotSelector(slot.selector, `${field}.selector`),
    required: booleanValue(slot.required, `${field}.required`),
    overridable: booleanValue(slot.overridable, `${field}.overridable`),
    timeoutSeconds: integerValue(slot.timeoutSeconds, `${field}.timeoutSeconds`, {
      minimum: 1,
      maximum: 86_400,
    }),
    minSuccesses: integerValue(slot.minSuccesses, `${field}.minSuccesses`, {
      minimum: 1,
      maximum: MAX_CHAIN_MEMBERS,
    }),
  };
}

// The source-side reviewer plan: one lane and a bounded, variable-length set of
// slots. Slot IDs are unique and every slot references the plan's lane.
export function decodeReviewerPlanSource(value) {
  rejectForbiddenFields(value, "reviewerPlanSource");
  assertEncodedSize(value, "reviewerPlanSource", CONTRACT_MAX_BYTES);
  const source = objectValue(value, "reviewerPlanSource");
  schemaVersion(source.schemaVersion, "reviewerPlanSource.schemaVersion");
  const lane = enumValue(source.lane, "reviewerPlanSource.lane", REVIEW_LANE_SET);
  if (!Array.isArray(source.slots)) {
    throw new Error("reviewerPlanSource.slots must be an array");
  }
  // A plan never synthesizes a contextual default: at least one explicit slot,
  // and no more than the bounded maximum.
  if (source.slots.length === 0) {
    throw new Error("reviewerPlanSource.slots must declare at least one slot");
  }
  if (source.slots.length > MAX_REVIEWER_SLOTS) {
    throw new Error(`reviewerPlanSource.slots exceeds the ${MAX_REVIEWER_SLOTS}-slot limit`);
  }
  const slots = source.slots.map((slot, index) =>
    decodeReviewerSlot(slot, `reviewerPlanSource.slots[${index}]`));
  const slotIds = slots.map((slot) => slot.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    throw new Error("reviewerPlanSource.slots must use unique slot IDs");
  }
  for (const slot of slots) {
    if (slot.lane !== lane) {
      throw new Error(`reviewerPlanSource slot ${slot.slotId} must reference the plan lane ${lane}`);
    }
  }
  slots.sort((left, right) => (left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0));
  return { schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR, lane, slots };
}

// The pinned catalog used to expand chains and prove lane eligibility. It binds
// candidate aliases to digests and eligible lanes, and named chains to members.
export function decodeReviewerCatalog(value) {
  rejectForbiddenFields(value, "reviewerCatalog");
  assertEncodedSize(value, "reviewerCatalog", RESPONSE_MAX_BYTES);
  const catalog = objectValue(value, "reviewerCatalog");
  schemaVersion(catalog.schemaVersion, "reviewerCatalog.schemaVersion");
  if (!Array.isArray(catalog.candidates) || catalog.candidates.length === 0) {
    throw new Error("reviewerCatalog.candidates must be a non-empty array");
  }
  if (catalog.candidates.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`reviewerCatalog.candidates exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const byAlias = new Map();
  const byDigest = new Map();
  for (const [index, entry] of catalog.candidates.entries()) {
    const field = `reviewerCatalog.candidates[${index}]`;
    const candidate = objectValue(entry, field);
    const alias = aliasValue(candidate.alias, `${field}.alias`);
    const candidateDigest = digestValue(candidate.candidateDigest, `${field}.candidateDigest`);
    const eligibleLanes = stringArray(candidate.eligibleLanes, `${field}.eligibleLanes`, {
      allowed: REVIEW_LANE_SET,
      allowEmpty: false,
    });
    if (byAlias.has(alias)) {
      throw new Error(`reviewerCatalog.candidates alias ${alias} is duplicated`);
    }
    if (byDigest.has(candidateDigest)) {
      throw new Error(`reviewerCatalog.candidates digest for ${alias} is duplicated`);
    }
    const record = { alias, candidateDigest, eligibleLanes };
    byAlias.set(alias, record);
    byDigest.set(candidateDigest, record);
  }
  const chains = new Map();
  const chainEntries = catalog.chains === undefined
    ? []
    : Object.entries(objectValue(catalog.chains, "reviewerCatalog.chains"));
  if (chainEntries.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`reviewerCatalog.chains exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  for (const [name, membersValue] of chainEntries) {
    const chainName = aliasValue(name, "reviewerCatalog.chains key");
    // Chain names are case-normalized; two keys that collapse to the same alias
    // are a duplicate, not a silent overwrite.
    if (chains.has(chainName)) {
      throw new Error(`reviewerCatalog.chains name ${chainName} is duplicated`);
    }
    const members = stringArray(membersValue, `reviewerCatalog.chains.${chainName}`, {
      maximumItems: MAX_CHAIN_MEMBERS,
      allowEmpty: false,
      pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
      lower: true,
    });
    for (const member of members) {
      if (!byAlias.has(member)) {
        throw new Error(`reviewerCatalog.chains.${chainName} references unknown candidate ${member}`);
      }
    }
    chains.set(chainName, members);
  }
  return {
    catalogDigest: digestValue(catalog.catalogDigest, "reviewerCatalog.catalogDigest"),
    byAlias,
    byDigest,
    chains,
  };
}

// Expand one resolved slot selector to its ordered set of candidate digests,
// proving each candidate exists in the catalog and is eligible for the lane.
function expandSlot(slot, catalog, lane) {
  let digests;
  if (slot.selector.kind === "candidate") {
    const record = catalog.byDigest.get(slot.selector.candidateDigest);
    if (!record) {
      throw new Error(`slot ${slot.slotId} references a candidate absent from the pinned catalog`);
    }
    digests = [record.candidateDigest];
  } else {
    const members = catalog.chains.get(slot.selector.chain);
    if (!members) {
      throw new Error(`slot ${slot.slotId} references unknown chain ${slot.selector.chain}`);
    }
    digests = members.map((alias) => catalog.byAlias.get(alias).candidateDigest);
  }
  for (const digest of digests) {
    const record = catalog.byDigest.get(digest);
    if (!record.eligibleLanes.includes(lane)) {
      throw new Error(`slot ${slot.slotId} references a candidate not eligible for lane ${lane}`);
    }
  }
  if (slot.minSuccesses > digests.length) {
    throw new Error(`slot ${slot.slotId} minSuccesses exceeds its ${digests.length} possible candidate(s)`);
  }
  const sorted = [...digests].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return sorted;
}

// Apply explicit overrides. An override names one overridable slot ID; omitting
// the slot ID is permitted only when exactly one slot is overridable. An
// override targeting a fixed (non-overridable) slot is rejected.
function applyOverrides(slots, overrides) {
  if (overrides === undefined) {
    return slots;
  }
  if (!Array.isArray(overrides)) {
    throw new Error("overrides must be an array");
  }
  const overridable = slots.filter((slot) => slot.overridable);
  const bySlotId = new Map(slots.map((slot) => [slot.slotId, slot]));
  const applied = new Map();
  const resolved = new Map(slots.map((slot) => [slot.slotId, slot]));
  for (const [index, entry] of overrides.entries()) {
    const field = `overrides[${index}]`;
    const override = objectValue(entry, field);
    let target;
    if (override.slotId === undefined) {
      if (overridable.length !== 1) {
        throw new Error(`${field} omits slotId but ${overridable.length} slots are overridable; the shorthand is ambiguous`);
      }
      target = overridable[0];
    } else {
      const slotId = aliasValue(override.slotId, `${field}.slotId`);
      target = bySlotId.get(slotId);
      if (!target) {
        throw new Error(`${field} names unknown slot ${slotId}`);
      }
      if (!target.overridable) {
        throw new Error(`${field} targets slot ${slotId}, which is not overridable`);
      }
    }
    if (applied.has(target.slotId)) {
      throw new Error(`${field} re-overrides slot ${target.slotId}`);
    }
    applied.set(target.slotId, true);
    resolved.set(target.slotId, {
      ...target,
      selector: decodeSlotSelector(override.selector, `${field}.selector`),
    });
  }
  return slots.map((slot) => resolved.get(slot.slotId));
}

// Compile a source reviewer plan against a pinned catalog and one exact head
// into an immutable parent plan with stable child identities. Pure: no budget
// reservation, no reviewer dispatch. Overlapping possible candidate sets,
// invalid thresholds, wrong-lane references, unknown selectors, and ambiguous
// overrides all fail here, before any reservation.
export function compileReviewerPlan({ source, catalog, headSha, compiledDigest, overrides } = {}) {
  const decodedSource = decodeReviewerPlanSource(source);
  const decodedCatalog = decodeReviewerCatalog(catalog);
  const boundHead = headShaValue(headSha, "headSha");
  const boundCompiledDigest = digestValue(compiledDigest, "compiledDigest");
  const resolvedSlots = applyOverrides(decodedSource.slots, overrides);
  const seenDigests = new Map();
  const children = resolvedSlots.map((slot) => {
    const candidateDigests = expandSlot(slot, decodedCatalog, decodedSource.lane);
    for (const digest of candidateDigests) {
      if (seenDigests.has(digest)) {
        throw new Error(
          `slot ${slot.slotId} shares candidate with slot ${seenDigests.get(digest)}; possible candidate sets must be pairwise disjoint`,
        );
      }
      seenDigests.set(digest, slot.slotId);
    }
    return {
      slotId: slot.slotId,
      candidateDigests,
      minSuccesses: slot.minSuccesses,
      required: slot.required,
      timeoutSeconds: slot.timeoutSeconds,
    };
  });
  // Parent identity binds its documented inputs: lane, exact head, compiled
  // digest, and every per-slot field that resolves the plan's behavior —
  // candidate set, success threshold, required flag, and timeout. Two plans
  // that differ in any of these are distinct identities; only representation
  // (slot order) is canonicalized away.
  const identitySlots = children.map((child) => ({
    slotId: child.slotId,
    candidateDigests: child.candidateDigests,
    minSuccesses: child.minSuccesses,
    required: child.required,
    timeoutSeconds: child.timeoutSeconds,
  }));
  const parentId = deriveV2Fingerprint({
    lane: decodedSource.lane,
    headSha: boundHead,
    compiledDigest: boundCompiledDigest,
    slots: identitySlots,
  });
  const bySlotId = new Map(identitySlots.map((slot) => [slot.slotId, slot]));
  const withChildIds = children.map((child) => ({
    ...child,
    childId: deriveV2Fingerprint({ parentId, ...bySlotId.get(child.slotId) }),
  }));
  return Object.freeze({
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    lane: decodedSource.lane,
    headSha: boundHead,
    compiledDigest: boundCompiledDigest,
    catalogDigest: decodedCatalog.catalogDigest,
    parentId,
    children: withChildIds,
  });
}

// Slot-aware `/review options` view: report the overridable slots and their
// deterministic safe candidate aliases for a lane. It never binds an attempt
// and never produces a plan or child identity.
export function decodeReviewerPlanOptions(value) {
  rejectForbiddenFields(value, "reviewerPlanOptions");
  assertEncodedSize(value, "reviewerPlanOptions", RESPONSE_MAX_BYTES);
  const options = objectValue(value, "reviewerPlanOptions");
  schemaVersion(options.schemaVersion, "reviewerPlanOptions.schemaVersion");
  for (const forbidden of ["headSha", "attempt", "logicalDispatchId", "parentId", "childId"]) {
    if (options[forbidden] !== undefined) {
      throw new Error(`reviewerPlanOptions.${forbidden} is forbidden; an options view cannot identify an attempt or plan`);
    }
  }
  const lane = enumValue(options.lane, "reviewerPlanOptions.lane", REVIEW_LANE_SET);
  if (!Array.isArray(options.overridableSlots)) {
    throw new Error("reviewerPlanOptions.overridableSlots must be an array");
  }
  if (options.overridableSlots.length > MAX_REVIEWER_SLOTS) {
    throw new Error(`reviewerPlanOptions.overridableSlots exceeds the ${MAX_REVIEWER_SLOTS}-slot limit`);
  }
  const overridableSlots = options.overridableSlots.map((entry, index) => {
    const field = `reviewerPlanOptions.overridableSlots[${index}]`;
    const slot = objectValue(entry, field);
    return {
      slotId: aliasValue(slot.slotId, `${field}.slotId`),
      safeCandidates: stringArray(slot.safeCandidates, `${field}.safeCandidates`, {
        pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
        lower: true,
        allowEmpty: false,
      }),
    };
  });
  const slotIds = overridableSlots.map((slot) => slot.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    throw new Error("reviewerPlanOptions.overridableSlots must use unique slot IDs");
  }
  overridableSlots.sort((left, right) => (left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0));
  return {
    schemaVersion: PROTOCOL_V2_SCHEMA_MAJOR,
    lane,
    catalogDigest: digestValue(options.catalogDigest, "reviewerPlanOptions.catalogDigest"),
    overridableSlots,
  };
}

// A comment-command selection label may name a broad review lane and nothing
// finer. Reserved candidate/slot/chain control labels are unsupported.
export function assertReviewerSelectionLabel(value, field = "selectionLabel") {
  const label = stringValue(value, field, { lower: true });
  for (const prefix of ["candidate:", "slot:", "chain:"]) {
    if (label.startsWith(prefix)) {
      throw new Error(`${field} '${label}' is unsupported; candidate and slot selection is not label-controlled`);
    }
  }
  if (!REVIEW_LANE_SET.has(label)) {
    throw new Error(`${field} must be a broad review lane label`);
  }
  return { lane: label };
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
