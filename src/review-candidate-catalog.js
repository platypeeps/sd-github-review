// Review candidate catalog contract (A-011 companion, catalog scope).
//
// This module owns ONLY the immutable, content-addressed catalog identity, the
// per-candidate records that bind lane eligibility / handler+model target /
// opaque policy references / hard dispatch limits / counting+pricing evidence /
// same-model failover, the immutable prompt-profile metadata registry, the
// bounded dispatch-safe projection, the mutable quarantine overlay, catalog
// version-transition/rollback facts, and a retention CLASSIFICATION helper.
//
// It is a pure leaf: it imports no local module and never reads GitHub, the
// checkout, process state, the filesystem, the clock, environment, output
// files, or route policy, and it emits no side effect. Time is ALWAYS injected;
// this module derives no lifecycle math itself. `classifyCatalogRetention`
// returns a record shaped for `retention-policy.js#computeRecordLifecycle`, so
// a caller owns the reference-aware 13-month tail while this module stays a
// leaf (no contract->contract import edge).
//
// The private adapter registry owns the actual prompt template / PR-Agent
// configuration bodies, keyed by the SAME identity (alias/version/digest) as
// the metadata here. Bodies never enter this contract; the forbidden-field
// walker rejects them at the boundary.

import { createHash } from "node:crypto";

export const CATALOG_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 32 * 1024;
const RESPONSE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const MAX_COLLECTION_ITEMS = 32;
const MAX_NESTING_DEPTH = 32;

// --- controlled vocabularies (mirrored, never imported) --------------------

// A candidate is either an EXTERNAL PR-Agent candidate (must reference exactly
// one compatible prompt profile) or a NATIVE candidate (must declare
// handler-managed prompting). Provider names (Kimi, Qwen, Copilot, ...) are
// consumer choices carried opaquely as handler/model strings, never protocol
// constants; there is deliberately no provider allow-list.
export const CANDIDATE_KINDS = Object.freeze(["external", "native"]);
const CANDIDATE_KIND_SET = new Set(CANDIDATE_KINDS);

// Mirror of protocol-v2's binding modes. `referenced` binds an external
// candidate to one registry profile; `handler-managed` is native prompting.
export const PROMPT_PROFILE_MODES = Object.freeze(["referenced", "handler-managed"]);
const PROMPT_PROFILE_MODE_SET = new Set(PROMPT_PROFILE_MODES);

export const REVIEW_LANES = Object.freeze(["review", "assurance", "gate"]);
const REVIEW_LANE_SET = new Set(REVIEW_LANES);

export const CANDIDATE_SLOTS = Object.freeze(["managed", "parallel"]);
const CANDIDATE_SLOT_SET = new Set(CANDIDATE_SLOTS);

export const COST_TIERS = Object.freeze(["free", "low", "medium", "high", "unknown"]);
const COST_TIER_SET = new Set(COST_TIERS);

// The only counting unit a catalog candidate may declare. It is an explicit
// vocabulary rather than an inline literal so an unknown unit fails closed.
export const COUNTING_UNITS = Object.freeze(["tokens"]);
const COUNTING_UNIT_SET = new Set(COUNTING_UNITS);

// How a candidate's tokenizer produces the counted input evidence.
export const COUNTING_MODES = Object.freeze(["exact", "estimated"]);
const COUNTING_MODE_SET = new Set(COUNTING_MODES);

// A quarantine overlay is a mutable control-plane state keyed to an immutable
// candidate alias. It never mutates a pinned catalog version.
export const QUARANTINE_STATES = Object.freeze(["quarantined", "released", "replaced"]);
const QUARANTINE_STATE_SET = new Set(QUARANTINE_STATES);

// Retention subjects this catalog classifies. They map onto the retention
// policy's `catalog_policy_version` / `static_prompt_profile` data classes.
export const CATALOG_RETENTION_SUBJECTS = Object.freeze(["catalog_version", "prompt_profile"]);
const CATALOG_RETENTION_SUBJECT_SET = new Set(CATALOG_RETENTION_SUBJECTS);
const SUBJECT_TO_DATA_CLASS = Object.freeze({
  catalog_version: "catalog_policy_version",
  prompt_profile: "static_prompt_profile",
});

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. These protect prompt/profile bodies, PR-Agent
// configuration values, credentials, billing payloads, raw provider metadata,
// and management endpoints from ever entering a catalog record or a projection.
const FORBIDDEN_CONTENT_FIELDS = new Set([
  "prompt",
  "prompts",
  "promptbody",
  "promptbodies",
  "profilebody",
  "profilebodies",
  "renderedprompt",
  "renderedprompts",
  "configuration",
  "configurations",
  "config",
  "configvalues",
  "configurationvalues",
  "template",
  "templates",
  "templatebody",
  "source",
  "sourcetext",
  "diff",
  "diffs",
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
  "providermetadata",
  "rawprovider",
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
  "balance",
  "balances",
  "privatepolicy",
  "managementendpoint",
  "managementendpoints",
  "endpoint",
  "endpoints",
  "baseurl",
  "content",
  "contents",
  "requestcontent",
]);

// PR-specific identifiers rejected from prompt-profile metadata and from a
// retention classification of a static prompt profile (which must carry no
// PR-specific data).
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

// Reject any prompt/profile/config body, credential, secret, billing payload,
// raw provider metadata, or management endpoint.
function rejectForbiddenContent(value, field) {
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "catalog privacy boundary");
}

// Reject any repository/PR/attempt/finding/actor/provider identifier.
function rejectIdentifyingFields(value, field) {
  rejectFieldNames(value, field, IDENTIFYING_FIELDS, "catalog anonymization boundary");
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
  if (value !== CATALOG_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${CATALOG_SCHEMA_MAJOR}`);
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

// An opaque, non-secret reference (credential/budget/policy/pricing/rule/
// capability handle). The catalog never carries the resolved value, only the
// handle the private control plane resolves.
function referenceValue(value, field) {
  return stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u });
}

// A handler/model target is an opaque consumer-chosen string, never a protocol
// constant. Kimi/Qwen/Copilot/etc. flow through here without an allow-list.
function targetValue(value, field) {
  return stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u });
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

function laneArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must contain at least one lane`);
  }
  if (value.length > REVIEW_LANES.length) {
    throw new Error(`${field} exceeds the ${REVIEW_LANES.length}-lane limit`);
  }
  const normalized = value.map((item, index) => enumValue(item, `${field}[${index}]`, REVIEW_LANE_SET));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a lane`);
  }
  return normalized.sort();
}

function slotArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must contain at least one slot`);
  }
  if (value.length > CANDIDATE_SLOTS.length) {
    throw new Error(`${field} exceeds the ${CANDIDATE_SLOTS.length}-slot limit`);
  }
  const normalized = value.map((item, index) => enumValue(item, `${field}[${index}]`, CANDIDATE_SLOT_SET));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a slot`);
  }
  return normalized.sort();
}

function handlerArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must list at least one compatible handler`);
  }
  if (value.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field} exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const normalized = value.map((item, index) => targetValue(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a handler`);
  }
  return normalized.sort();
}

function capabilityArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field} exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const normalized = value.map((item, index) => aliasValue(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not repeat a capability`);
  }
  return normalized.sort();
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

export function stableCatalogJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableCatalogJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered
// equivalent input produces the same digest; any changed field changes it.
export function deriveCatalogDigest(fields) {
  return sha256(canonicalize(fields));
}

// Numeric semver comparison for transition/rollback direction.
function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

// --- capability + policy evidence ------------------------------------------

// A verifiable capability fact. `verified` records whether the evidence is
// provable; a projection later refuses to expose an unverifiable fact.
function capabilityEvidence(value, field) {
  const evidence = objectValue(value, field);
  return {
    supported: booleanValue(evidence.supported, `${field}.supported`),
    verified: booleanValue(evidence.verified, `${field}.verified`),
  };
}

function decodeCandidatePolicy(value, field) {
  const policy = objectValue(value, field);
  const tokenizerInput = objectValue(policy.tokenizer, `${field}.tokenizer`);
  const pricingInput = objectValue(policy.pricing, `${field}.pricing`);
  const hardInputLimit = integerValue(policy.hardInputLimit, `${field}.hardInputLimit`, {
    minimum: 1,
    maximum: 100_000_000,
  });
  const hardOutputLimit = integerValue(policy.hardOutputLimit, `${field}.hardOutputLimit`, {
    minimum: 1,
    maximum: 100_000_000,
  });
  const hardRequestCostLimit = integerValue(policy.hardRequestCostLimit, `${field}.hardRequestCostLimit`, {
    minimum: 1,
    maximum: 100_000_000,
  });
  const safetyMargin = integerValue(policy.safetyMargin, `${field}.safetyMargin`, {
    minimum: 0,
    maximum: 100_000_000,
  });
  // A safety margin at or above the hard per-request limit leaves no headroom;
  // a policy-incomplete candidate fails closed rather than dispatching blind.
  if (safetyMargin >= hardRequestCostLimit) {
    throw new Error(`${field}.safetyMargin must be below hardRequestCostLimit`);
  }
  return {
    units: enumValue(policy.units, `${field}.units`, COUNTING_UNIT_SET),
    tokenizer: {
      tokenizerId: aliasValue(tokenizerInput.tokenizerId, `${field}.tokenizer.tokenizerId`),
      counting: enumValue(tokenizerInput.counting, `${field}.tokenizer.counting`, COUNTING_MODE_SET),
      verified: booleanValue(tokenizerInput.verified, `${field}.tokenizer.verified`),
    },
    pricing: {
      pricingRef: referenceValue(pricingInput.pricingRef, `${field}.pricing.pricingRef`),
      verified: booleanValue(pricingInput.verified, `${field}.pricing.verified`),
    },
    hardInputLimit,
    hardOutputLimit,
    hardRequestCostLimit,
    safetyMargin,
    finishReason: capabilityEvidence(policy.finishReason, `${field}.finishReason`),
    usage: capabilityEvidence(policy.usage, `${field}.usage`),
  };
}

function decodeFailover(value, field) {
  const failover = objectValue(value, field);
  // Only same-model endpoint failover is permitted; a cross-model failover
  // would silently change review behavior and fails closed.
  if (failover.sameModelOnly !== true) {
    throw new Error(`${field}.sameModelOnly must be explicitly true; only same-model endpoint failover is permitted`);
  }
  return {
    sameModelOnly: true,
    maxAlternates: integerValue(failover.maxAlternates, `${field}.maxAlternates`, { minimum: 0, maximum: 8 }),
  };
}

function decodeRules(value, field) {
  const rules = objectValue(value, field);
  // The prompt-rule key is named `promptRule` (not `prompt`) so it never trips
  // the forbidden-content walker that protects prompt bodies.
  return {
    price: referenceValue(rules.price, `${field}.price`),
    data: referenceValue(rules.data, `${field}.data`),
    promptRule: referenceValue(rules.promptRule, `${field}.promptRule`),
    reasoning: referenceValue(rules.reasoning, `${field}.reasoning`),
  };
}

// --- prompt-profile binding (discriminated union) --------------------------

// Reject every forbidden binding lever: a lane default, inheritance, merging,
// fallback profile, runtime substitution, or an independent profile override.
const FORBIDDEN_BINDING_LEVERS = Object.freeze([
  "default",
  "laneDefault",
  "inheritance",
  "inherit",
  "merge",
  "fallback",
  "substitute",
  "substitution",
  "commandOverride",
  "runtimeOverride",
  "override",
]);

function decodePromptProfileBinding(value, field) {
  const binding = objectValue(value, field);
  for (const forbidden of FORBIDDEN_BINDING_LEVERS) {
    if (binding[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; a profile binding declares no lane default, inheritance, merge, fallback, substitution, or override`);
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

// --- prompt-profile registry ------------------------------------------------

function profileIdentity(alias, version) {
  return `${alias}@${version}`;
}

function decodeProfileEntry(value, field) {
  rejectIdentifyingFields(value, field);
  const profile = objectValue(value, field);
  return {
    alias: aliasValue(profile.alias, `${field}.alias`),
    version: semverLikeValue(profile.version, `${field}.version`),
    digest: digestValue(profile.digest, `${field}.digest`),
    compatibleHandlers: handlerArray(profile.compatibleHandlers, `${field}.compatibleHandlers`),
    capabilities: capabilityArray(profile.capabilities, `${field}.capabilities`),
  };
}

// Decode the immutable prompt-profile metadata registry. It carries ONLY
// alias/version/digest + compatible handler/capabilities; the actual template
// or PR-Agent configuration is adapter-owned and keyed by the same identity.
export function decodePromptProfileRegistry(value, field = "promptProfileRegistry") {
  const isTopLevel = field === "promptProfileRegistry";
  if (isTopLevel) {
    rejectForbiddenContent(value, field);
    assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  }
  let entries;
  if (Array.isArray(value)) {
    entries = value;
  } else {
    const registry = objectValue(value, field);
    if (registry.schemaMajor !== undefined) {
      schemaVersion(registry.schemaMajor, `${field}.schemaMajor`);
    }
    if (!Array.isArray(registry.profiles)) {
      throw new Error(`${field}.profiles must be an array`);
    }
    entries = registry.profiles;
  }
  if (entries.length === 0) {
    throw new Error(`${field} must declare at least one prompt profile`);
  }
  if (entries.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field} exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const byIdentity = new Map();
  const profiles = entries.map((entry, index) => {
    const decoded = decodeProfileEntry(entry, `${field}[${index}]`);
    const identity = profileIdentity(decoded.alias, decoded.version);
    if (byIdentity.has(identity)) {
      throw new Error(`${field}[${index}] duplicates prompt profile ${identity}`);
    }
    byIdentity.set(identity, decoded);
    return Object.freeze({ ...decoded, compatibleHandlers: Object.freeze(decoded.compatibleHandlers), capabilities: Object.freeze(decoded.capabilities) });
  });
  profiles.sort((left, right) => {
    const leftId = profileIdentity(left.alias, left.version);
    const rightId = profileIdentity(right.alias, right.version);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return Object.freeze({ schemaMajor: CATALOG_SCHEMA_MAJOR, profiles: Object.freeze(profiles) });
}

function indexRegistry(registry) {
  const byIdentity = new Map();
  const byAlias = new Map();
  for (const profile of registry.profiles) {
    const identity = profileIdentity(profile.alias, profile.version);
    byIdentity.set(identity, profile);
    byIdentity.set(`${identity}@${profile.digest}`, profile);
    if (!byAlias.has(profile.alias)) byAlias.set(profile.alias, []);
    byAlias.get(profile.alias).push(profile);
  }
  return { byIdentity, byAlias };
}

// Resolve an external candidate's binding against the registry, proving the
// referenced profile exists with the exact digest and is handler-compatible.
function resolveProfileBinding(binding, handler, field, registryIndex) {
  const identity = profileIdentity(binding.alias, binding.version);
  const exact = registryIndex.byIdentity.get(`${identity}@${binding.digest}`);
  if (!exact) {
    const sameAliasVersion = registryIndex.byIdentity.get(identity);
    if (sameAliasVersion) {
      throw new Error(`${field} references a substituted digest for prompt profile ${identity}; a mismatched profile is rejected`);
    }
    throw new Error(`${field} references unknown prompt profile ${identity}`);
  }
  if (!exact.compatibleHandlers.includes(handler)) {
    throw new Error(`${field} handler is not compatible with prompt profile ${identity}`);
  }
  return exact;
}

// --- candidate record -------------------------------------------------------

// Decode one immutable candidate record. `options.registryIndex` (supplied by
// the catalog decode) cross-checks an external candidate's profile reference;
// omitted, only the binding SHAPE is validated.
export function decodeCandidateRecord(value, field = "candidate", options = {}) {
  const isTopLevel = field === "candidate";
  if (isTopLevel) {
    rejectForbiddenContent(value, field);
    assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  }
  const record = objectValue(value, field);
  // Disablement is a control-plane overlay, never an embedded flag mutating a
  // pinned version. An embedded disabled candidate fails closed.
  if (record.disabled !== undefined) {
    throw new Error(`${field}.disabled is forbidden; disablement is a quarantine overlay, not an embedded flag`);
  }
  const kind = enumValue(record.kind, `${field}.kind`, CANDIDATE_KIND_SET);
  const handler = targetValue(record.handler, `${field}.handler`);
  const binding = decodePromptProfileBinding(record.promptProfile, `${field}.promptProfile`);
  if (kind === "external" && binding.mode !== "referenced") {
    throw new Error(`${field}.promptProfile must reference a prompt profile for an external candidate`);
  }
  if (kind === "native" && binding.mode !== "handler-managed") {
    throw new Error(`${field}.promptProfile must be handler-managed for a native candidate`);
  }
  let profileFacts;
  if (kind === "external" && options.registryIndex) {
    profileFacts = resolveProfileBinding(binding, handler, `${field}.promptProfile`, options.registryIndex);
  }
  const normalized = {
    alias: aliasValue(record.alias, `${field}.alias`),
    kind,
    displayName: stringValue(record.displayName, `${field}.displayName`, { maximum: SHORT_TEXT_MAX_BYTES }),
    handler,
    model: targetValue(record.model, `${field}.model`),
    costTier: enumValue(record.costTier, `${field}.costTier`, COST_TIER_SET),
    eligibleLanes: laneArray(record.eligibleLanes, `${field}.eligibleLanes`),
    eligibleSlots: slotArray(record.eligibleSlots, `${field}.eligibleSlots`),
    credentialRef: referenceValue(record.credentialRef, `${field}.credentialRef`),
    budgetRef: referenceValue(record.budgetRef, `${field}.budgetRef`),
    policyRef: referenceValue(record.policyRef, `${field}.policyRef`),
    reserve: integerValue(record.reserve, `${field}.reserve`, { minimum: 0, maximum: 100_000_000 }),
    capability: aliasValue(record.capability, `${field}.capability`),
    rules: decodeRules(record.rules, `${field}.rules`),
    failover: decodeFailover(record.failover, `${field}.failover`),
    policy: decodeCandidatePolicy(record.policy, `${field}.policy`),
    promptProfile: binding,
  };
  if (profileFacts) {
    normalized.promptProfileCompatibility = Object.freeze({
      compatibleHandlers: profileFacts.compatibleHandlers,
      capabilities: profileFacts.capabilities,
    });
  }
  return Object.freeze({
    ...normalized,
    eligibleLanes: Object.freeze(normalized.eligibleLanes),
    eligibleSlots: Object.freeze(normalized.eligibleSlots),
    rules: Object.freeze(normalized.rules),
    failover: Object.freeze(normalized.failover),
    policy: Object.freeze({
      ...normalized.policy,
      tokenizer: Object.freeze(normalized.policy.tokenizer),
      pricing: Object.freeze(normalized.policy.pricing),
      finishReason: Object.freeze(normalized.policy.finishReason),
      usage: Object.freeze(normalized.policy.usage),
    }),
    promptProfile: Object.freeze(normalized.promptProfile),
  });
}

// --- immutable catalog ------------------------------------------------------

// Decode the immutable, content-addressed catalog: a name/version/digest
// identity, an embedded prompt-profile registry, and stable candidate aliases.
// A supplied digest MUST match the canonical content, so a pinned version can
// never be mutated in place.
export function decodeCandidateCatalog(value, field = "candidateCatalog") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const catalog = objectValue(value, field);
  schemaVersion(catalog.schemaMajor, `${field}.schemaMajor`);
  const name = aliasValue(catalog.name, `${field}.name`);
  const version = semverLikeValue(catalog.version, `${field}.version`);
  const registry = decodePromptProfileRegistry(catalog.promptProfiles, `${field}.promptProfiles`);
  const registryIndex = indexRegistry(registry);
  if (!Array.isArray(catalog.candidates)) {
    throw new Error(`${field}.candidates must be an array`);
  }
  if (catalog.candidates.length === 0) {
    throw new Error(`${field}.candidates must declare at least one candidate`);
  }
  if (catalog.candidates.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.candidates exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const seenAliases = new Set();
  const candidates = catalog.candidates.map((entry, index) => {
    const decoded = decodeCandidateRecord(entry, `${field}.candidates[${index}]`, { registryIndex });
    if (seenAliases.has(decoded.alias)) {
      throw new Error(`${field}.candidates[${index}] duplicates candidate alias ${decoded.alias}`);
    }
    seenAliases.add(decoded.alias);
    return decoded;
  });
  candidates.sort((left, right) => (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0));

  // The canonical body is the content the digest addresses. profiles/candidates
  // are already normalized+sorted, so the digest is stable and reproducible.
  const body = {
    schemaMajor: CATALOG_SCHEMA_MAJOR,
    name,
    version,
    candidates,
    promptProfiles: registry.profiles,
  };
  const digest = deriveCatalogDigest(body);
  if (catalog.digest !== undefined && digestValue(catalog.digest, `${field}.digest`) !== digest) {
    throw new Error(`${field}.digest does not match its canonical content`);
  }
  return Object.freeze({
    schemaMajor: CATALOG_SCHEMA_MAJOR,
    name,
    version,
    digest,
    candidates: Object.freeze(candidates),
    promptProfiles: registry.profiles,
  });
}

// --- bounded dispatch-safe projection --------------------------------------

// A verifiable capability fact for the projection. It refuses to expose an
// unverifiable token/price/finish-reason/usage capability: a dispatch-safe
// projection carries only proven facts.
function verifiedCapability(value, field) {
  const evidence = capabilityEvidence(value, field);
  if (!evidence.verified) {
    throw new Error(`${field} must be verified; a projection never exposes an unverifiable capability`);
  }
  return evidence;
}

// Decode the bounded projection consumed publicly for request preflight and
// hard-limit enforcement. It exposes ONLY compile/dispatch-safe facts plus the
// prompt-profile identity and compatibility; it excludes credential/budget/
// policy references, management endpoints, raw provider metadata, and any
// prompt/config body (the forbidden-field walker enforces the last three).
export function decodeCandidateSafeProjection(value, field = "candidateSafeProjection") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const projection = objectValue(value, field);
  schemaVersion(projection.schemaMajor, `${field}.schemaMajor`);
  const tokenizerInput = objectValue(projection.tokenizer, `${field}.tokenizer`);
  const tokenizerVerified = booleanValue(tokenizerInput.verified, `${field}.tokenizer.verified`);
  if (!tokenizerVerified) {
    throw new Error(`${field}.tokenizer must be verified; a projection never exposes an unverifiable token capability`);
  }
  const pricingInput = objectValue(projection.pricing, `${field}.pricing`);
  const pricingVerified = booleanValue(pricingInput.verified, `${field}.pricing.verified`);
  if (!pricingVerified) {
    throw new Error(`${field}.pricing must be verified; a projection never exposes an unverifiable price capability`);
  }
  const hardRequestCostLimit = integerValue(projection.hardRequestCostLimit, `${field}.hardRequestCostLimit`, {
    minimum: 1,
    maximum: 100_000_000,
  });
  const safetyMargin = integerValue(projection.safetyMargin, `${field}.safetyMargin`, {
    minimum: 0,
    maximum: 100_000_000,
  });
  if (safetyMargin >= hardRequestCostLimit) {
    throw new Error(`${field}.safetyMargin must be below hardRequestCostLimit`);
  }
  const binding = decodePromptProfileBinding(projection.promptProfile, `${field}.promptProfile`);
  const profileProjection = { mode: binding.mode };
  if (binding.mode === "referenced") {
    profileProjection.alias = binding.alias;
    profileProjection.version = binding.version;
    profileProjection.digest = binding.digest;
    profileProjection.compatibleHandlers = handlerArray(
      objectValue(projection.promptProfile, `${field}.promptProfile`).compatibleHandlers,
      `${field}.promptProfile.compatibleHandlers`,
    );
    profileProjection.capabilities = capabilityArray(
      projection.promptProfile.capabilities,
      `${field}.promptProfile.capabilities`,
    );
  }
  const normalized = {
    schemaMajor: CATALOG_SCHEMA_MAJOR,
    catalogDigest: digestValue(projection.catalogDigest, `${field}.catalogDigest`),
    alias: aliasValue(projection.alias, `${field}.alias`),
    kind: enumValue(projection.kind, `${field}.kind`, CANDIDATE_KIND_SET),
    handler: targetValue(projection.handler, `${field}.handler`),
    model: targetValue(projection.model, `${field}.model`),
    costTier: enumValue(projection.costTier, `${field}.costTier`, COST_TIER_SET),
    eligibleLanes: laneArray(projection.eligibleLanes, `${field}.eligibleLanes`),
    eligibleSlots: slotArray(projection.eligibleSlots, `${field}.eligibleSlots`),
    units: enumValue(projection.units, `${field}.units`, COUNTING_UNIT_SET),
    hardInputLimit: integerValue(projection.hardInputLimit, `${field}.hardInputLimit`, { minimum: 1, maximum: 100_000_000 }),
    hardOutputLimit: integerValue(projection.hardOutputLimit, `${field}.hardOutputLimit`, { minimum: 1, maximum: 100_000_000 }),
    hardRequestCostLimit,
    safetyMargin,
    tokenizer: Object.freeze({
      tokenizerId: aliasValue(tokenizerInput.tokenizerId, `${field}.tokenizer.tokenizerId`),
      counting: enumValue(tokenizerInput.counting, `${field}.tokenizer.counting`, COUNTING_MODE_SET),
      verified: true,
    }),
    pricing: Object.freeze({
      pricingRef: referenceValue(pricingInput.pricingRef, `${field}.pricing.pricingRef`),
      verified: true,
    }),
    finishReason: Object.freeze(verifiedCapability(projection.finishReason, `${field}.finishReason`)),
    usage: Object.freeze(verifiedCapability(projection.usage, `${field}.usage`)),
    promptProfile: Object.freeze({
      ...profileProjection,
      ...(profileProjection.compatibleHandlers ? { compatibleHandlers: Object.freeze(profileProjection.compatibleHandlers) } : {}),
      ...(profileProjection.capabilities ? { capabilities: Object.freeze(profileProjection.capabilities) } : {}),
    }),
  };
  return Object.freeze({
    ...normalized,
    eligibleLanes: Object.freeze(normalized.eligibleLanes),
    eligibleSlots: Object.freeze(normalized.eligibleSlots),
  });
}

// --- quarantine overlay -----------------------------------------------------

// Decode a mutable quarantine overlay tied to an immutable candidate alias. It
// never carries catalog content (candidates/profiles) and so cannot mutate a
// pinned version. A `replaced` state carries the portable replacement model.
export function decodeCandidateQuarantine(value, field = "candidateQuarantine") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const overlay = objectValue(value, field);
  schemaVersion(overlay.schemaMajor, `${field}.schemaMajor`);
  for (const forbidden of ["candidates", "promptProfiles", "policy"]) {
    if (overlay[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; a quarantine overlay never mutates a pinned catalog version`);
    }
  }
  const state = enumValue(overlay.state, `${field}.state`, QUARANTINE_STATE_SET);
  const normalized = {
    schemaMajor: CATALOG_SCHEMA_MAJOR,
    catalogDigest: digestValue(overlay.catalogDigest, `${field}.catalogDigest`),
    alias: aliasValue(overlay.alias, `${field}.alias`),
    state,
    reason: stringValue(overlay.reason, `${field}.reason`, { maximum: SHORT_TEXT_MAX_BYTES }),
    effectiveAt: timestampValue(overlay.effectiveAt, `${field}.effectiveAt`),
    mutatesPinnedVersion: false,
  };
  if (state === "replaced") {
    // Portable model replacement: swap the model target without mutating the
    // pinned version. The replacement is same-alias, new-model.
    normalized.replacementModel = targetValue(overlay.replacementModel, `${field}.replacementModel`);
  } else if (overlay.replacementModel !== undefined) {
    throw new Error(`${field}.replacementModel is valid only for a replaced overlay`);
  }
  return Object.freeze(normalized);
}

// --- version transition / rollback -----------------------------------------

// Describe the transition between two decoded catalogs and enforce
// immutability: a pinned version may never change content (same version,
// different digest fails closed). A change creates a new version+digest; a
// rollback restores an earlier version rather than mutating history. Changing a
// profile's digest invalidates every candidate/profile tuple that references
// it, reported as `invalidatedTuples`.
export function describeCatalogTransition(previous, next) {
  if (!isPlainObject(previous) || !isPlainObject(next) || previous.schemaMajor !== CATALOG_SCHEMA_MAJOR || next.schemaMajor !== CATALOG_SCHEMA_MAJOR) {
    throw new Error("describeCatalogTransition requires two decoded catalogs");
  }
  if (previous.version === next.version && previous.digest !== next.digest) {
    throw new Error("a pinned catalog version must not mutate in place; a change requires a new version");
  }
  const versionOrder = compareSemver(next.version, previous.version);
  const nextProfilesByIdentity = new Map(
    next.promptProfiles.map((profile) => [profileIdentity(profile.alias, profile.version), profile]),
  );
  const invalidatedTuples = [];
  for (const candidate of previous.candidates) {
    if (candidate.promptProfile.mode !== "referenced") continue;
    const identity = profileIdentity(candidate.promptProfile.alias, candidate.promptProfile.version);
    const nextProfile = nextProfilesByIdentity.get(identity);
    if (nextProfile && nextProfile.digest !== candidate.promptProfile.digest) {
      invalidatedTuples.push(Object.freeze({
        candidateAlias: candidate.alias,
        profileAlias: candidate.promptProfile.alias,
        profileVersion: candidate.promptProfile.version,
        previousDigest: candidate.promptProfile.digest,
        nextDigest: nextProfile.digest,
      }));
    }
  }
  return Object.freeze({
    versionChanged: previous.version !== next.version,
    digestChanged: previous.digest !== next.digest,
    rollback: versionOrder < 0,
    invalidatedTuples: Object.freeze(invalidatedTuples),
  });
}

// --- retention classification (leaf boundary) ------------------------------

// Classify a catalog version or a static prompt profile for retention WITHOUT
// importing the retention module. The returned record is shaped exactly for
// `retention-policy.js#computeRecordLifecycle`, which owns the reference-aware
// 13-month tail (retain while referenced, then 13 months after the final
// reference, then digest_only). A conflicting subject fails closed rather than
// selecting the longer duration.
export function classifyCatalogRetention(value, field = "catalogRetention") {
  rejectForbiddenContent(value, field);
  const input = objectValue(value, field);
  if (input.subjects !== undefined) {
    throw new Error(`${field} must declare a single subject, not a subjects set`);
  }
  if (input.secondarySubject !== undefined) {
    throw new Error(`${field} must declare a single subject; a conflicting classification fails closed`);
  }
  const subject = enumValue(input.subject, `${field}.subject`, CATALOG_RETENTION_SUBJECT_SET);
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
  // A static prompt profile classification must carry no PR-specific content.
  if (subject === "prompt_profile") {
    rejectIdentifyingFields(input, field);
  }
  normalized.referenced = input.referenced === undefined
    ? true
    : booleanValue(input.referenced, `${field}.referenced`);
  if (!normalized.referenced) {
    // The 13-month tail must anchor on the final reference. Defaulting a missing
    // anchor to createdAt would start the deletion clock at creation and could
    // purge a version months before its policy allows, so an unreferenced
    // classification fails closed until it names when the last reference left.
    if (input.lastReferencedAt === undefined) {
      throw new Error(`${field}.lastReferencedAt is required once the version is no longer referenced`);
    }
    normalized.lastReferencedAt = timestampValue(input.lastReferencedAt, `${field}.lastReferencedAt`);
    if (Date.parse(normalized.lastReferencedAt) < Date.parse(createdAt)) {
      throw new Error(`${field}.lastReferencedAt must not precede createdAt`);
    }
  } else if (input.lastReferencedAt !== undefined) {
    throw new Error(`${field}.lastReferencedAt is valid only once the version is no longer referenced`);
  }
  return Object.freeze(normalized);
}
