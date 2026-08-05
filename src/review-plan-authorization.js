// Budget-aware review plan authorization contract (A-011 companion, plan scope).
//
// This module owns ONLY the pure preparation, control-plane request shaping, and
// durable authorization of an exact-head MANAGED review plan, plus the bounded
// read-only `/review options` discovery and the trusted-command / route-label
// precedence resolution. It sits one layer above the leaf contracts: it imports
// the v2 wire shapes and prompt-profile/preflight/options decoders from
// `protocol-v2.js`, the budget reservation-request identity from
// `review-budget-ledger.js`, and the active compiled manifest facts from
// `routed-review-compiler.js`.
//
// It is pure and side-effect-free: it reads no GitHub, checkout, process state,
// filesystem, clock, environment, or output file, and it emits no side effect.
// Any time is ALWAYS an injected `nowIso`. Preparation freezes an exact head and
// request identity, applies explicit-override rules, binds the selected
// candidate's exact prompt-profile identity, and orders the named-lane chain; the
// engine validates the complete response fingerprint and persists authorization
// before any reviewer side effect. An options query stops before attempt
// identity, reservation, persistence, or dispatch. Every uncertain post-request
// outcome returns reconciliation-required and never advances to another
// candidate.

import { createHash } from "node:crypto";
import {
  PROTOCOL_V2_SCHEMA_MAJOR,
  REVIEW_LANES,
  CANDIDATE_SLOTS,
  MERGE_POLICIES,
  assertReviewerSelectionLabel,
  decodeCandidateOptionsResponse,
  decodeCandidatePreflight,
  decodePromptProfileBinding,
} from "./protocol-v2.js";
import {
  deriveRequestFingerprint,
} from "./review-budget-ledger.js";

export const PLAN_AUTHORIZATION_SCHEMA_MAJOR = PROTOCOL_V2_SCHEMA_MAJOR;

// --- size and shape bounds -------------------------------------------------

const REQUEST_MAX_BYTES = 32 * 1024;
const RESPONSE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const MAX_COLLECTION_ITEMS = 32;
const MAX_NESTING_DEPTH = 32;
const AMOUNT_MAX = 1_000_000_000_000_000;

// --- controlled vocabularies (frozen) --------------------------------------

const REVIEW_LANE_SET = new Set(REVIEW_LANES);
const CANDIDATE_SLOT_SET = new Set(CANDIDATE_SLOTS);
const MERGE_POLICY_SET = new Set(MERGE_POLICIES);

// The one budget unit a managed plan reserves against. An unknown unit fails
// closed rather than being coerced.
export const PLAN_BUDGET_UNITS = Object.freeze(["tokens"]);
const PLAN_BUDGET_UNIT_SET = new Set(PLAN_BUDGET_UNITS);

// The configured selection sources, in strict descending precedence. A fixed
// mode outranks a validated trusted command, which outranks a broad route
// label. A lower-priority conflict never alters a higher-priority decision.
export const PLAN_SELECTION_SOURCES = Object.freeze([
  "fixed_mode",
  "trusted_command",
  "route_label",
]);

// The bounded terminal outcomes of authorizing a prepared plan.
export const PLAN_OUTCOMES = Object.freeze([
  "authorized",
  "deferred",
  "blocked",
  "reconciliation_required",
]);

// Why a considered candidate is pre-dispatch ineligible (side-effect-free
// preflight). Automatic selection may continue within its named lane chain past
// one of these; an explicit candidate blocks without fallback.
export const PREFLIGHT_INELIGIBILITY_REASONS = Object.freeze([
  "capability_unavailable",
  "head_mismatch",
  "oversized",
  "uncountable",
  "unpriced",
  "unit_mismatch",
  "unenforceable",
]);
const PREFLIGHT_INELIGIBILITY_SET = new Set(PREFLIGHT_INELIGIBILITY_REASONS);

// Every non-budget cause blocks regardless of the lane's budget-exhaustion merge
// policy. Only proven pre-dispatch budget exhaustion defers.
export const BLOCKING_CAUSES = Object.freeze([
  "unverifiable",
  "policy",
  "authentication",
  "framework",
  "candidate_unavailable",
  "candidate_unfunded",
  "response_mismatch",
  "prompt_profile_mismatch",
]);
const BLOCKING_CAUSE_SET = new Set(BLOCKING_CAUSES);

export const DEFERRAL_CAUSE = "budget_exhausted_deferred";

// The bounded control-plane response outcomes the engine validates.
export const CONTROL_PLANE_OUTCOMES = Object.freeze([
  "authorized",
  "budget_exhausted",
  "blocked",
  "ambiguous",
]);
const CONTROL_PLANE_OUTCOME_SET = new Set(CONTROL_PLANE_OUTCOMES);

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. A prepared control-plane request or a decoded response
// carries only bounded aliases, fingerprints, and economics; a prompt/finding/
// diff/config body, a credential, a raw balance, or provider metadata never
// enters this contract.
const FORBIDDEN_CONTENT_FIELDS = new Set([
  "prompt",
  "prompts",
  "promptbody",
  "promptbodies",
  "profilebody",
  "renderedprompt",
  "configuration",
  "config",
  "configvalues",
  "configurationvalues",
  "source",
  "sourcetext",
  "diff",
  "diffs",
  "finding",
  "findings",
  "rawfinding",
  "transcript",
  "transcripts",
  "modeloutput",
  "output",
  "outputs",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "apikey",
  "apikeys",
  "token",
  "tokens",
  "balance",
  "balances",
  "rawbalance",
  "rawbalances",
  "billingpayload",
  "providerpayload",
  "providermetadata",
  "rawprovider",
  "rawpayload",
  "managementendpoint",
  "managementendpoints",
  "endpoint",
  "endpoints",
  "baseurl",
  "content",
  "contents",
  "requestcontent",
]);

// --- primitive validators (mirrored, never imported) -----------------------

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
        pending.push({ value: current.value[index], field: `${current.field}[${index}]`, depth: current.depth + 1 });
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
      pending.push({ value: item, field: `${current.field}.${key}`, depth: current.depth + 1 });
    }
  }
}

function rejectForbiddenContent(value, field) {
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "review-plan privacy boundary");
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
  if (value !== PLAN_AUTHORIZATION_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${PLAN_AUTHORIZATION_SCHEMA_MAJOR}`);
  }
  return value;
}

function digestValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-fA-F0-9]{64}$/u, lower: true });
}

function headShaValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u, lower: true });
}

function semverLikeValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[0-9]+\.[0-9]+\.[0-9]+$/u });
}

function aliasValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u, lower: true });
}

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

function repositoryValue(value, field) {
  const repository = objectValue(value, field);
  return {
    owner: stringValue(repository.owner, `${field}.owner`, { maximum: 100, pattern: /^[A-Za-z0-9_.-]+$/u, lower: true }),
    name: stringValue(repository.name, `${field}.name`, { maximum: 100, pattern: /^[A-Za-z0-9_.-]+$/u, lower: true }),
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

export function stablePlanJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stablePlanJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered equivalent
// input produces the same digest; any changed field changes it.
export function derivePlanFingerprint(fields) {
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

// --- prompt-profile identity ------------------------------------------------

// The stable content digest of a bound prompt profile. A referenced binding IS
// its declared content digest; a handler-managed profile digests its mode.
function promptProfileDigestOf(binding) {
  return binding.mode === "referenced" ? binding.digest : derivePlanFingerprint({ mode: binding.mode });
}

function bindingsEqual(left, right) {
  if (left.mode !== right.mode) return false;
  if (left.mode === "handler-managed") return true;
  return left.alias === right.alias && left.version === right.version && left.digest === right.digest;
}

// --- compiled manifest facts (managed only) --------------------------------

// Read the active compiled managed manifest and project the requested lane. A
// standalone manifest is rejected here: standalone planning belongs to a
// separate child and is never selected because a control-plane request failed.
function projectManagedLane(compiled, lane, field = "compiled") {
  const manifest = objectValue(compiled, field);
  if (manifest.mode !== "managed") {
    throw new Error(`${field}.mode must be managed; standalone planning is never selected here`);
  }
  const outputDigest = digestValue(manifest.outputDigest, `${field}.outputDigest`);
  const catalogDigest = digestValue(manifest.catalogDigest, `${field}.catalogDigest`);
  const configurationDigest = digestValue(manifest.configurationDigest, `${field}.configurationDigest`);
  const lanes = objectValue(manifest.lanes, `${field}.lanes`);
  const laneName = enumValue(lane, "lane", REVIEW_LANE_SET);
  if (!Object.hasOwn(lanes, laneName)) {
    throw new Error(`${field}.lanes has no lane ${laneName}`);
  }
  const laneRecord = objectValue(lanes[laneName], `${field}.lanes.${laneName}`);
  const slot = enumValue(laneRecord.slot, `${field}.lanes.${laneName}.slot`, CANDIDATE_SLOT_SET);
  const merge = enumValue(
    objectValue(laneRecord.budgetExhaustion, `${field}.lanes.${laneName}.budgetExhaustion`).merge,
    `${field}.lanes.${laneName}.budgetExhaustion.merge`,
    MERGE_POLICY_SET,
  );
  const candidate = objectValue(laneRecord.candidate, `${field}.lanes.${laneName}.candidate`);
  const boundBinding = decodePromptProfileBinding(candidate.promptProfile, `${field}.lanes.${laneName}.candidate.promptProfile`);
  return {
    lane: laneName,
    slot,
    mergePolicy: merge,
    outputDigest,
    catalogDigest,
    configurationDigest,
    boundCandidateDigest: digestValue(candidate.candidateDigest, `${field}.lanes.${laneName}.candidate.candidateDigest`),
    boundPromptProfile: boundBinding,
  };
}

// --- considered candidate (named-chain member) -----------------------------

// Decode one considered candidate: its alias/digest identity, its OWN authored
// prompt-profile binding, its bounded side-effect-free candidate preflight, and
// its budget reservation economics. A candidate command selects WHICH candidate;
// it can never replace this candidate's authored profile.
function decodeConsideredCandidate(value, field, laneProjection) {
  const entry = objectValue(value, field);
  const alias = aliasValue(entry.alias, `${field}.alias`);
  const candidateDigest = digestValue(entry.candidateDigest, `${field}.candidateDigest`);
  const promptProfile = decodePromptProfileBinding(entry.promptProfile, `${field}.promptProfile`);
  const promptProfileDigest = promptProfileDigestOf(promptProfile);
  // A chain member claiming the lane's bound candidate identity must carry that
  // candidate's exact authored prompt-profile. A profile substitution on the
  // bound candidate is a hard prompt-profile mismatch and can never authorize
  // dispatch or another candidate.
  if (candidateDigest === laneProjection.boundCandidateDigest
    && !bindingsEqual(promptProfile, laneProjection.boundPromptProfile)) {
    throw new Error(`${field}.promptProfile does not match the compiled lane's exact prompt-profile identity`);
  }

  const preflight = decodeCandidatePreflight(entry.candidatePreflight);
  if (preflight.candidateDigest !== candidateDigest) {
    throw new Error(`${field}.candidatePreflight.candidateDigest does not match the candidate identity`);
  }
  // A referenced profile's preflight digest must equal the exact bound profile
  // digest. A drift here is a prompt-profile mismatch, never a silent accept.
  if (promptProfile.mode === "referenced" && preflight.promptProfileDigest !== promptProfile.digest) {
    throw new Error(`${field}.candidatePreflight.promptProfileDigest does not match the exact bound prompt-profile digest`);
  }

  const reservation = objectValue(entry.reservation, `${field}.reservation`);
  const poolId = aliasValue(reservation.poolId, `${field}.reservation.poolId`);
  const units = enumValue(reservation.units, `${field}.reservation.units`, PLAN_BUDGET_UNIT_SET);
  const conservativeMaxCharge = integerValue(reservation.conservativeMaxCharge, `${field}.reservation.conservativeMaxCharge`, { minimum: 1 });
  const hardRequestLimit = integerValue(reservation.hardRequestLimit, `${field}.reservation.hardRequestLimit`, { minimum: 1 });
  const leaseExpiresAt = timestampValue(reservation.leaseExpiresAt, `${field}.reservation.leaseExpiresAt`);
  const reservePreflight = objectValue(reservation.preflight, `${field}.reservation.preflight`);
  trueValue(reservePreflight.bounded, `${field}.reservation.preflight.bounded`);
  trueValue(reservePreflight.sideEffectFree, `${field}.reservation.preflight.sideEffectFree`);
  const method = enumValue(reservePreflight.method, `${field}.reservation.preflight.method`, new Set(["exact", "estimated"]));
  const inputUnits = integerValue(reservePreflight.inputUnits, `${field}.reservation.preflight.inputUnits`, { minimum: 0 });

  return {
    alias,
    candidateDigest,
    promptProfile,
    promptProfileDigest,
    pricingVerified: booleanValue(entry.pricingVerified, `${field}.pricingVerified`),
    enforceable: booleanValue(entry.enforceable, `${field}.enforceable`),
    preflight,
    reservation: { poolId, units, conservativeMaxCharge, hardRequestLimit, leaseExpiresAt, preflight: { bounded: true, sideEffectFree: true, method, inputUnits } },
    policyDigest: preflight.policyDigest,
    configurationDigest: preflight.configurationDigest,
  };
}

// Classify one considered candidate's side-effect-free preflight eligibility
// against the frozen bound head. A structural/type problem already threw during
// decode; here every check is a bounded capacity/eligibility fact.
function classifyEligibility(candidate, boundHead) {
  if (candidate.preflight.headSha !== boundHead) return "head_mismatch";
  if (candidate.preflight.capabilityEvidence.available !== true) return "capability_unavailable";
  if (candidate.preflight.inputCounted !== true) return "uncountable";
  if (candidate.pricingVerified !== true) return "unpriced";
  if (candidate.enforceable !== true) return "unenforceable";
  if (candidate.reservation.units !== candidate.preflight.units) return "unit_mismatch";
  // A conservative maximum above the hard per-request limit is an oversized
  // request; it fails before reservation rather than truncating context.
  if (candidate.reservation.conservativeMaxCharge > candidate.reservation.hardRequestLimit) return "oversized";
  if (candidate.reservation.conservativeMaxCharge > candidate.preflight.maxExpectedCharge) return "oversized";
  return null;
}

// --- command interpretation -------------------------------------------------

function suggestionsFor(laneProjectionLanes, lane, availability) {
  const suggestions = { lanes: [...laneProjectionLanes].sort() };
  if (lane && availability) {
    suggestions.candidates = availability.options
      .filter((option) => option.eligibleLanes.includes(lane))
      .map((option) => option.alias)
      .sort();
  }
  return suggestions;
}

// Interpret an exact `/review` comment command. Only a trusted author's exact
// grammar is honored. Options and candidate-selection commands are supported;
// an invalid lane/slot/candidate produces bounded deterministic suggestions and
// never a fuzzy match. A reserved candidate/slot/chain control label fails
// visibly. A non-`/review` body is ignored, not rejected.
export function interpretReviewCommand({ body, trusted, compiled, availability } = {}) {
  const raw = stringValue(body, "body", { maximum: 512 });
  const laneKeys = Object.keys(objectValue(objectValue(compiled, "compiled").lanes, "compiled.lanes"));
  const decodedAvailability = availability === undefined ? undefined : decodeCandidateOptionsResponse(availability);
  const tokens = raw.split(/\s+/u).filter(Boolean);
  if (tokens[0] !== "/review") {
    return freezeDeep({ status: "ignored" });
  }
  if (trusted !== true) {
    return freezeDeep({ status: "rejected", reason: "untrusted", suggestions: suggestionsFor(laneKeys) });
  }
  if (tokens.length < 2) {
    return freezeDeep({ status: "rejected", reason: "malformed", suggestions: suggestionsFor(laneKeys) });
  }

  if (tokens[1] === "options") {
    if (tokens.length === 2) {
      return freezeDeep({ status: "command", command: { kind: "options", lane: null, slot: null } });
    }
    const lane = tokens[2].toLowerCase();
    if (!laneKeys.includes(lane)) {
      return freezeDeep({ status: "rejected", reason: "invalid_lane", suggestions: suggestionsFor(laneKeys) });
    }
    if (tokens.length === 3) {
      return freezeDeep({ status: "command", command: { kind: "options", lane, slot: null } });
    }
    if (tokens[3] !== "--slot" || tokens.length !== 5) {
      return freezeDeep({ status: "rejected", reason: "malformed", suggestions: suggestionsFor(laneKeys, lane, decodedAvailability) });
    }
    const slot = tokens[4].toLowerCase();
    if (!CANDIDATE_SLOT_SET.has(slot)) {
      return freezeDeep({ status: "rejected", reason: "invalid_slot", suggestions: { ...suggestionsFor(laneKeys, lane, decodedAvailability), slots: [...CANDIDATE_SLOTS].sort() } });
    }
    return freezeDeep({ status: "command", command: { kind: "options", lane, slot } });
  }

  // Candidate-selection command: /review <lane> --candidate <alias>. A reserved
  // candidate/slot/chain control label fails visibly.
  const laneToken = tokens[1].toLowerCase();
  for (const prefix of ["candidate:", "slot:", "chain:"]) {
    if (laneToken.startsWith(prefix)) {
      return freezeDeep({ status: "rejected", reason: "reserved_selection_label", suggestions: suggestionsFor(laneKeys) });
    }
  }
  if (!laneKeys.includes(laneToken)) {
    return freezeDeep({ status: "rejected", reason: "invalid_lane", suggestions: suggestionsFor(laneKeys) });
  }
  if (tokens[2] !== "--candidate" || tokens.length !== 4) {
    return freezeDeep({ status: "rejected", reason: "malformed", suggestions: suggestionsFor(laneKeys, laneToken, decodedAvailability) });
  }
  const alias = tokens[3].toLowerCase();
  const eligible = decodedAvailability === undefined
    ? []
    : decodedAvailability.options.filter((option) => option.eligibleLanes.includes(laneToken)).map((option) => option.alias);
  if (!eligible.includes(alias)) {
    return freezeDeep({ status: "rejected", reason: "invalid_candidate", suggestions: suggestionsFor(laneKeys, laneToken, decodedAvailability) });
  }
  return freezeDeep({ status: "command", command: { kind: "candidate_selection", lane: laneToken, candidate: alias } });
}

// --- selection precedence (audit A-011) -------------------------------------

// Resolve the configured mode and a validated trusted command BEFORE any broad
// route-label selection. A fixed mode outranks a trusted command, which outranks
// a route label. A conflicting lower-priority label cannot block or alter a
// higher-priority decision. Automatic mode with conflicting broad labels and no
// higher-priority decision fails visibly. A reserved candidate/slot/chain label
// always fails visibly regardless of mode.
export function resolveSelectionPrecedence({ mode, trustedCommand, routeLabels } = {}) {
  const configured = objectValue(mode, "mode");
  const kind = enumValue(configured.kind, "mode.kind", new Set(["fixed", "automatic"]));

  // Reserved labels fail visibly first; broad labels reduce to their lanes.
  const rawLabels = routeLabels === undefined ? [] : routeLabels;
  if (!Array.isArray(rawLabels)) {
    throw new Error("routeLabels must be an array");
  }
  const labelLanes = rawLabels.map((label, index) => assertReviewerSelectionLabel(label, `routeLabels[${index}]`).lane);
  const distinctLabelLanes = [...new Set(labelLanes)];

  let command;
  if (trustedCommand !== undefined && trustedCommand !== null) {
    const decoded = objectValue(trustedCommand, "trustedCommand");
    command = {
      lane: enumValue(decoded.lane, "trustedCommand.lane", REVIEW_LANE_SET),
      candidate: decoded.candidate === undefined ? undefined : aliasValue(decoded.candidate, "trustedCommand.candidate"),
    };
  }

  if (kind === "fixed") {
    const lane = enumValue(configured.lane, "mode.lane", REVIEW_LANE_SET);
    // A trusted candidate command may still pick WHICH candidate for the fixed
    // lane, but the fixed lane and the fixed decision are authoritative. A
    // conflicting broad label is recorded as ignored, never applied.
    const candidate = command && command.candidate ? command.candidate : undefined;
    return freezeDeep({
      source: candidate ? "trusted_command" : "fixed_mode",
      lane,
      candidate,
      ignoredLabelLanes: distinctLabelLanes.filter((laneName) => laneName !== lane),
    });
  }

  // automatic
  if (command) {
    return freezeDeep({
      source: "trusted_command",
      lane: command.lane,
      candidate: command.candidate,
      ignoredLabelLanes: distinctLabelLanes.filter((laneName) => laneName !== command.lane),
    });
  }
  if (distinctLabelLanes.length === 0) {
    throw new Error("automatic mode has no trusted command or route label to select a lane");
  }
  if (distinctLabelLanes.length > 1) {
    throw new Error("automatic mode has conflicting broad route labels; the ambiguous selection fails visibly");
  }
  return freezeDeep({ source: "route_label", lane: distinctLabelLanes[0], candidate: undefined, ignoredLabelLanes: [] });
}

// --- bounded read-only options query ---------------------------------------

// Answer a bounded `/review options` query over the active compiled contract and
// the current safe availability projection. It is a pure read: it creates no
// attempt identity, reservation, durable authorization, or dispatch, and returns
// only deterministic bounded choices.
export function answerOptionsQuery({ command, compiled, availability } = {}) {
  const decodedCommand = objectValue(command, "command");
  if (decodedCommand.kind !== "options") {
    throw new Error("command.kind must be options");
  }
  const manifest = objectValue(compiled, "compiled");
  if (manifest.mode !== "managed") {
    throw new Error("compiled.mode must be managed for an options query");
  }
  const lanes = objectValue(manifest.lanes, "compiled.lanes");
  const laneKeys = Object.keys(lanes).sort();
  const decodedAvailability = availability === undefined ? undefined : decodeCandidateOptionsResponse(availability);

  if (decodedCommand.lane === null || decodedCommand.lane === undefined) {
    return freezeDeep({ schemaMajor: PLAN_AUTHORIZATION_SCHEMA_MAJOR, kind: "options", lanes: laneKeys });
  }
  const lane = enumValue(decodedCommand.lane, "command.lane", REVIEW_LANE_SET);
  if (!Object.hasOwn(lanes, lane)) {
    throw new Error(`compiled.lanes has no lane ${lane}`);
  }
  const laneSlot = enumValue(objectValue(lanes[lane], `compiled.lanes.${lane}`).slot, `compiled.lanes.${lane}.slot`, CANDIDATE_SLOT_SET);
  const slot = decodedCommand.slot === null || decodedCommand.slot === undefined
    ? null
    : enumValue(decodedCommand.slot, "command.slot", CANDIDATE_SLOT_SET);
  const options = decodedAvailability === undefined ? [] : decodedAvailability.options;
  const candidates = options
    .filter((option) => option.eligibleLanes.includes(lane))
    .filter((option) => (slot === null ? true : option.eligibleSlots.includes(slot)))
    .map((option) => ({ alias: option.alias, availability: option.availability.state, costTier: option.costTier }))
    .sort((left, right) => (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0));
  return freezeDeep({
    schemaMajor: PLAN_AUTHORIZATION_SCHEMA_MAJOR,
    kind: "options",
    lane,
    slot: slot === null ? laneSlot : slot,
    candidates,
  });
}

// --- plan preparation -------------------------------------------------------

// Prepare an exact-head managed plan without side effects. It freezes the head
// and request identity, validates a side-effect-free preflight for EVERY
// considered candidate, applies explicit-override rules, binds the selected
// candidate's exact prompt-profile identity, and emits a bounded control-plane
// request. It never reserves, persists, or dispatches. An explicit candidate
// that is unavailable blocks without fallback; automatic selection continues
// only within the named lane chain past a proven pre-dispatch ineligibility.
export function prepareManagedPlan({ compiled, lane, slot, identity, chain, candidateOverride, nowIso } = {}) {
  const now = timestampValue(nowIso, "nowIso");
  const laneProjection = projectManagedLane(compiled, lane);
  if (slot !== undefined && slot !== laneProjection.slot) {
    throw new Error(`slot ${slot} does not match the compiled lane slot ${laneProjection.slot}`);
  }

  const decodedIdentity = objectValue(identity, "identity");
  const boundIdentity = {
    tenant: aliasValue(decodedIdentity.tenant, "identity.tenant"),
    repository: repositoryValue(decodedIdentity.repository, "identity.repository"),
    pullRequest: integerValue(decodedIdentity.pullRequest, "identity.pullRequest", { minimum: 1, maximum: 100_000_000 }),
    headSha: headShaValue(decodedIdentity.headSha, "identity.headSha"),
    attempt: integerValue(decodedIdentity.attempt, "identity.attempt", { minimum: 1, maximum: 100_000_000 }),
  };

  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error("chain must declare at least one considered candidate in the named lane order");
  }
  if (chain.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`chain exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  rejectForbiddenContent(chain, "chain");

  const overrideAlias = candidateOverride === undefined || candidateOverride === null
    ? undefined
    : aliasValue(candidateOverride, "candidateOverride");

  // Decode + classify EVERY considered candidate before any selection. A
  // structural fault already threw; here each carries a bounded eligibility fact.
  const seenAliases = new Set();
  const proposals = chain.map((entry, index) => {
    const candidate = decodeConsideredCandidate(entry, `chain[${index}]`, laneProjection);
    if (seenAliases.has(candidate.alias)) {
      throw new Error(`chain[${index}] duplicates candidate alias ${candidate.alias}`);
    }
    seenAliases.add(candidate.alias);
    const ineligibleReason = classifyEligibility(candidate, boundIdentity.headSha);
    return { candidate, ineligibleReason };
  });

  // Select. An explicit override bypasses ordering but never falls through: an
  // absent or ineligible explicit candidate blocks. Automatic selection walks
  // the named chain and takes the first eligible candidate, continuing past a
  // proven pre-dispatch ineligibility.
  let selected;
  let explicitOverride = false;
  if (overrideAlias !== undefined) {
    explicitOverride = true;
    const match = proposals.find((proposal) => proposal.candidate.alias === overrideAlias);
    if (!match) {
      return freezeDeep({ status: "blocked", cause: "candidate_unavailable", explicitOverride: true, requestedCandidate: overrideAlias, lane: laneProjection.lane });
    }
    if (match.ineligibleReason) {
      return freezeDeep({ status: "blocked", cause: "candidate_unavailable", explicitOverride: true, requestedCandidate: overrideAlias, lane: laneProjection.lane, ineligibleReason: match.ineligibleReason });
    }
    selected = match.candidate;
  } else {
    const first = proposals.find((proposal) => proposal.ineligibleReason === null);
    if (!first) {
      return freezeDeep({ status: "blocked", cause: "candidate_unavailable", explicitOverride: false, lane: laneProjection.lane, chainIneligibility: proposals.map((p) => ({ alias: p.candidate.alias, reason: p.ineligibleReason })) });
    }
    selected = first.candidate;
  }

  // Derive the selected candidate's budget reservation fingerprint over the full
  // review identity and the exact economics it authorizes.
  const ledgerIdentity = {
    tenant: boundIdentity.tenant,
    repository: boundIdentity.repository,
    pullRequest: boundIdentity.pullRequest,
    head: boundIdentity.headSha,
    attempt: boundIdentity.attempt,
    compiledDigest: laneProjection.outputDigest,
    candidate: selected.alias,
  };
  const requestFingerprint = deriveRequestFingerprint(ledgerIdentity, {
    poolId: selected.reservation.poolId,
    units: selected.reservation.units,
    conservativeMaxCharge: selected.reservation.conservativeMaxCharge,
    hardRequestLimit: selected.reservation.hardRequestLimit,
  });

  const orderedProposals = proposals.map((proposal) => ({
    alias: proposal.candidate.alias,
    candidateDigest: proposal.candidate.candidateDigest,
    promptProfileDigest: proposal.candidate.promptProfileDigest,
    poolId: proposal.candidate.reservation.poolId,
    units: proposal.candidate.reservation.units,
    maxExpectedCharge: proposal.candidate.preflight.maxExpectedCharge,
    hardRequestLimit: proposal.candidate.reservation.hardRequestLimit,
    reserveRequirement: proposal.candidate.reservation.conservativeMaxCharge,
    eligible: proposal.ineligibleReason === null,
    ...(proposal.ineligibleReason ? { ineligibleReason: proposal.ineligibleReason } : {}),
  }));

  const planFingerprint = derivePlanFingerprint({
    identity: ledgerIdentity,
    lane: laneProjection.lane,
    slot: laneProjection.slot,
    compiledDigest: laneProjection.outputDigest,
    selectedCandidateDigest: selected.candidateDigest,
    selectedPromptProfileDigest: selected.promptProfileDigest,
    explicitOverride,
    chain: orderedProposals.map((proposal) => proposal.candidateDigest),
  });

  // Bounded control-plane request: only aliases, fingerprints, policy/budget
  // references, preflight facts, maximum expected charge, hard request limit, and
  // reserve requirements. No request content ever crosses this boundary.
  const controlPlaneRequest = {
    schemaMajor: PLAN_AUTHORIZATION_SCHEMA_MAJOR,
    requestFingerprint,
    planFingerprint,
    mode: "managed",
    lane: laneProjection.lane,
    slot: laneProjection.slot,
    mergePolicy: laneProjection.mergePolicy,
    compiledDigest: laneProjection.outputDigest,
    catalogDigest: laneProjection.catalogDigest,
    configurationDigest: laneProjection.configurationDigest,
    identity: {
      tenant: boundIdentity.tenant,
      repository: boundIdentity.repository,
      pullRequest: boundIdentity.pullRequest,
      headSha: boundIdentity.headSha,
      attempt: boundIdentity.attempt,
    },
    explicitOverride,
    selected: {
      alias: selected.alias,
      candidateDigest: selected.candidateDigest,
      promptProfileMode: selected.promptProfile.mode,
      promptProfileDigest: selected.promptProfileDigest,
      ...(selected.promptProfile.mode === "referenced"
        ? { promptProfileAlias: selected.promptProfile.alias, promptProfileVersion: selected.promptProfile.version }
        : {}),
      policyDigest: selected.policyDigest,
      poolId: selected.reservation.poolId,
      units: selected.reservation.units,
      maxExpectedCharge: selected.preflight.maxExpectedCharge,
      hardRequestLimit: selected.reservation.hardRequestLimit,
      reserveRequirement: selected.reservation.conservativeMaxCharge,
      leaseExpiresAt: selected.reservation.leaseExpiresAt,
    },
    proposals: orderedProposals,
  };
  rejectForbiddenContent(controlPlaneRequest, "controlPlaneRequest");
  assertEncodedSize(controlPlaneRequest, "controlPlaneRequest", REQUEST_MAX_BYTES);

  return freezeDeep({
    status: "prepared",
    preparedAt: now,
    requestFingerprint,
    planFingerprint,
    lane: laneProjection.lane,
    slot: laneProjection.slot,
    mergePolicy: laneProjection.mergePolicy,
    explicitOverride,
    identity: controlPlaneRequest.identity,
    selected: {
      alias: selected.alias,
      candidateDigest: selected.candidateDigest,
      promptProfileMode: selected.promptProfile.mode,
      promptProfileDigest: selected.promptProfileDigest,
    },
    controlPlaneRequest,
  });
}

// --- durable authorization --------------------------------------------------

// The initial in-memory authorization state. Every authorize call returns a NEW
// frozen state; a rejected or reconciliation outcome persists nothing new and no
// partial mutation escapes.
export function createPlanAuthorizationState() {
  return freezeDeep({ schemaMajor: PLAN_AUTHORIZATION_SCHEMA_MAJOR, authorizations: {} });
}

function requireState(state) {
  if (!isPlainObject(state) || state.schemaMajor !== PLAN_AUTHORIZATION_SCHEMA_MAJOR || !isPlainObject(state.authorizations)) {
    throw new Error("a decoded plan authorization state is required");
  }
  return state;
}

// Decode the trusted control-plane response, binding it to the COMPLETE prepared
// request identity. A response that fails to echo the exact request/plan
// fingerprint, candidate, or prompt-profile identity is rejected; a stale-head
// response is a reconciliation, not an authorization.
function decodeControlPlaneResponse(value, prepared) {
  rejectForbiddenContent(value, "controlPlaneResponse");
  assertEncodedSize(value, "controlPlaneResponse", RESPONSE_MAX_BYTES);
  const response = objectValue(value, "controlPlaneResponse");
  schemaVersion(response.schemaMajor, "controlPlaneResponse.schemaMajor");
  const outcome = enumValue(response.outcome, "controlPlaneResponse.outcome", CONTROL_PLANE_OUTCOME_SET);
  const requestFingerprint = digestValue(response.requestFingerprint, "controlPlaneResponse.requestFingerprint");
  const planFingerprint = digestValue(response.planFingerprint, "controlPlaneResponse.planFingerprint");
  const candidateDigest = digestValue(response.candidateDigest, "controlPlaneResponse.candidateDigest");
  const promptProfileDigest = digestValue(response.promptProfileDigest, "controlPlaneResponse.promptProfileDigest");
  const headSha = headShaValue(response.headSha, "controlPlaneResponse.headSha");
  const attempt = integerValue(response.attempt, "controlPlaneResponse.attempt", { minimum: 1, maximum: 100_000_000 });
  return { outcome, requestFingerprint, planFingerprint, candidateDigest, promptProfileDigest, headSha, attempt, raw: response };
}

// Validate a prepared plan against its trusted control-plane response and persist
// durable authorization BEFORE returning dispatch permission. Persistence is
// idempotent: a replay returns the stored decision and the same state object.
//
// Only proven pre-dispatch budget exhaustion defers (recording deferred
// assurance plus the lane's explicit merge gate policy). Every other cause —
// authentication, policy, framework, unverifiable, response mismatch, prompt-
// profile mismatch — blocks regardless of merge policy. A changed head or an
// ambiguous possible dispatch returns reconciliation-required and never advances
// to another candidate.
export function authorizePlan({ prepared, response, state, nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const plan = objectValue(prepared, "prepared");
  if (plan.status !== "prepared") {
    throw new Error("authorizePlan requires a prepared plan");
  }
  const requestFingerprint = digestValue(plan.requestFingerprint, "prepared.requestFingerprint");
  const decoded = decodeControlPlaneResponse(response, plan);

  // A changed head is never authorized: reconcile without touching the old-head
  // receipt, and never advance to another candidate.
  if (decoded.headSha !== plan.identity.headSha) {
    return { state, decision: freezeDeep({ outcome: "reconciliation_required", reason: "changed_head", dispatchAllowed: false, requestFingerprint }) };
  }

  // The response must echo the complete request identity. A mismatch is a fail-
  // closed rejection, never a compatibility acceptance.
  if (decoded.requestFingerprint !== requestFingerprint) {
    throw new Error("controlPlaneResponse.requestFingerprint does not match the prepared request identity");
  }
  if (decoded.planFingerprint !== plan.planFingerprint) {
    throw new Error("controlPlaneResponse.planFingerprint does not match the prepared plan identity");
  }
  if (decoded.candidateDigest !== plan.selected.candidateDigest) {
    throw new Error("controlPlaneResponse.candidateDigest does not match the selected candidate identity");
  }
  if (decoded.promptProfileDigest !== plan.selected.promptProfileDigest) {
    throw new Error("controlPlaneResponse.promptProfileDigest does not match the selected prompt-profile identity");
  }
  if (decoded.attempt !== plan.identity.attempt) {
    throw new Error("controlPlaneResponse.attempt does not match the prepared attempt");
  }

  // Idempotent replay: an already-persisted authorization must reproduce the same
  // decision. A response that would change it is a replay conflict and fails
  // closed rather than authorizing a second, different dispatch.
  if (Object.hasOwn(state.authorizations, requestFingerprint)) {
    const stored = state.authorizations[requestFingerprint];
    if (stored.outcome !== decoded.outcome) {
      throw new Error("controlPlaneResponse conflicts with the persisted authorization for this request");
    }
    return { state, decision: freezeDeep({ ...stored, replay: true }) };
  }

  let record;
  if (decoded.outcome === "authorized") {
    trueValue(decoded.raw.reserved, "controlPlaneResponse.reserved");
    const revision = integerValue(decoded.raw.revision, "controlPlaneResponse.revision", { minimum: 1, maximum: 1_000_000_000 });
    record = {
      outcome: "authorized",
      dispatchAllowed: true,
      requestFingerprint,
      planFingerprint: plan.planFingerprint,
      candidate: plan.selected.alias,
      lane: plan.lane,
      revision,
      authorizedAt: now,
    };
  } else if (decoded.outcome === "budget_exhausted") {
    // A terminal deferral is valid ONLY when the response proves pre-dispatch
    // budget exhaustion. An unproven exhaustion blocks; it never defers.
    const proven = decoded.raw.proven === true;
    if (!proven) {
      record = { outcome: "blocked", dispatchAllowed: false, requestFingerprint, cause: "unverifiable", lane: plan.lane, blockedAt: now };
    } else {
      const poolId = aliasValue(decoded.raw.poolId, "controlPlaneResponse.poolId");
      record = {
        outcome: "deferred",
        dispatchAllowed: false,
        requestFingerprint,
        cause: DEFERRAL_CAUSE,
        lane: plan.lane,
        poolId,
        assurance: "deferred",
        gatePolicy: plan.mergePolicy,
        deferredAt: now,
      };
    }
  } else if (decoded.outcome === "blocked") {
    const cause = enumValue(decoded.raw.cause, "controlPlaneResponse.cause", BLOCKING_CAUSE_SET);
    record = { outcome: "blocked", dispatchAllowed: false, requestFingerprint, cause, lane: plan.lane, blockedAt: now };
  } else {
    // Ambiguous possible dispatch: stop and reconcile; never advance to another
    // candidate and never persist an authorization.
    return { state, decision: freezeDeep({ outcome: "reconciliation_required", reason: "ambiguous", dispatchAllowed: false, requestFingerprint }) };
  }

  const nextState = freezeDeep({
    schemaMajor: PLAN_AUTHORIZATION_SCHEMA_MAJOR,
    authorizations: { ...state.authorizations, [requestFingerprint]: record },
  });
  return { state: nextState, decision: freezeDeep({ ...record, replay: false }) };
}
