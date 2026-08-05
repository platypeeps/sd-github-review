// Routed review configuration compiler (A-011 companion, compile scope).
//
// This module owns ONLY the pure, deterministic compilation of a versioned
// explicit-mode v2 human source into a canonical compiled manifest with stable
// source, catalog, and output digests. It is a higher layer than the leaf
// contracts: it imports the v2 source decoder and prompt-profile binding from
// `protocol-v2.js` and the immutable candidate safe projection from
// `review-candidate-catalog.js`, but it performs no network, credential,
// filesystem, clock, environment, or output access and emits no side effect.
//
// Managed mode requires a digest-matching bounded catalog SAFE PROJECTION and
// validates each lane's candidate reference, exact prompt-profile identity, and
// handler/lane/slot compatibility. Standalone mode requires only the
// setup-discovered fixed handler profiles and rejects every catalog, candidate,
// and budget field. The mode is taken solely from the source; it is never
// inferred or rewritten from the presence of an endpoint, credential, catalog,
// or handler-profile input.

import {
  PROTOCOL_V2_SCHEMA_MAJOR,
  decodePromptProfileBinding,
  decodeSourceContract,
  deriveV2Fingerprint,
} from "./protocol-v2.js";
import {
  decodeCandidateSafeProjection,
  deriveCatalogDigest,
} from "./review-candidate-catalog.js";

export const COMPILER_SCHEMA_MAJOR = PROTOCOL_V2_SCHEMA_MAJOR;

// --- size and shape bounds -------------------------------------------------

const SOURCE_MAX_BYTES = 32 * 1024;
const CATALOG_MAX_BYTES = 64 * 1024;
const HANDLER_PROFILE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const MAX_COLLECTION_ITEMS = 32;
const MAX_NESTING_DEPTH = 32;

// Composition levers a compiled v2 configuration never supports: imports,
// inheritance, presets/runtime presets, independent overrides, candidate/slot
// LABEL configuration (including the unsupported `overrides.labels` field), and
// chain references. They are rejected by NORMALIZED key at any depth so a
// case/separator variant (e.g. `Overrides`, `runtime_presets`, `LABELS`) cannot
// slip a lever past the boundary. Legitimate source keys (mode, routes, lanes,
// slot, handler, promptProfile, budgetExhaustion, candidate, catalogDigest,
// configurationDigest, alias, version, digest) deliberately do not appear here.
const FORBIDDEN_COMPOSITION_LEVERS = new Set([
  "import",
  "imports",
  "extends",
  "inheritance",
  "inherit",
  "inherits",
  "preset",
  "presets",
  "runtimepreset",
  "runtimepresets",
  "override",
  "overrides",
  "label",
  "labels",
  "candidatelabel",
  "candidatelabels",
  "slotlabel",
  "slotlabels",
  "chain",
  "chains",
]);

// --- primitive validators (locally mirrored, never imported) ---------------

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

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

// Reject every forbidden composition lever by normalized key at any depth. It
// names the field and the boundary only; it never echoes the offending value,
// so a compiler diagnostic can never leak a secret or raw catalog value.
function rejectCompositionLevers(value, field) {
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
      if (FORBIDDEN_COMPOSITION_LEVERS.has(normalizeKey(key))) {
        throw new Error(`${current.field}.${key} is forbidden; a compiled v2 configuration declares no import, inheritance, preset, override, candidate/slot label, or chain reference`);
      }
      pending.push({ value: item, field: `${current.field}.${key}`, depth: current.depth + 1 });
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

function stringValue(value, field, { maximum = SHORT_TEXT_MAX_BYTES, pattern } = {}) {
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
  return normalized;
}

function schemaMajorValue(value, field) {
  if (value !== COMPILER_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${COMPILER_SCHEMA_MAJOR}`);
  }
  return value;
}

function digestValue(value, field) {
  return stringValue(value, field, { maximum: 64, pattern: /^[a-f0-9]{64}$/u });
}

function handlerValue(value, field) {
  return stringValue(value, field, { maximum: SHORT_TEXT_MAX_BYTES, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u });
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

// Stable canonical JSON of a compiled manifest. Reordered equivalent input
// serializes byte-for-byte identically.
export function stableCompiledJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Canonical fingerprint over any allow-listed field record. Shares the v2
// fingerprint algorithm, so equivalent input yields the same digest and any
// changed field changes it.
function deriveDigest(fields) {
  return deriveV2Fingerprint(canonicalize(fields));
}

// The content-addressed digest of one decoded catalog safe projection. Managed
// source lanes reference a candidate by exactly this digest.
export function candidateProjectionDigest(value) {
  return deriveCatalogDigest(decodeCandidateSafeProjection(value));
}

// --- prompt-profile binding equality ---------------------------------------

// Two normalized bindings are equal when they share a mode and, for a
// referenced binding, the exact alias, version, and digest. Any mismatch is a
// substituted or unknown profile, never a silent acceptance.
function bindingsEqual(left, right) {
  if (left.mode !== right.mode) return false;
  if (left.mode === "handler-managed") return true;
  return left.alias === right.alias && left.version === right.version && left.digest === right.digest;
}

function frozenBinding(binding) {
  return binding.mode === "handler-managed"
    ? Object.freeze({ mode: "handler-managed" })
    : Object.freeze({ mode: binding.mode, alias: binding.alias, version: binding.version, digest: binding.digest });
}

// --- standalone handler profiles (setup-discovered, fixed) -----------------

// Decode the setup-discovered fixed handler profiles. Each pins one handler to
// one fixed prompt-profile binding; a direct-handler route must match a
// discovered profile exactly. This is the only profile source a standalone
// compilation consults; it carries no catalog, candidate, or budget field.
function decodeHandlerProfiles(value, field) {
  rejectCompositionLevers(value, field);
  assertEncodedSize(value, field, HANDLER_PROFILE_MAX_BYTES);
  const input = objectValue(value, field);
  schemaMajorValue(input.schemaMajor, `${field}.schemaMajor`);
  for (const forbidden of ["catalogDigest", "candidates", "lanes", "budgetExhaustion"]) {
    if (input[forbidden] !== undefined) {
      throw new Error(`${field}.${forbidden} is forbidden; standalone handler profiles carry no catalog, candidate, or budget field`);
    }
  }
  if (!Array.isArray(input.handlers) || input.handlers.length === 0) {
    throw new Error(`${field}.handlers must be a non-empty array`);
  }
  if (input.handlers.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.handlers exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const byHandler = new Map();
  input.handlers.forEach((entry, index) => {
    const entryField = `${field}.handlers[${index}]`;
    const profile = objectValue(entry, entryField);
    const handler = handlerValue(profile.handler, `${entryField}.handler`);
    const binding = decodePromptProfileBinding(profile.promptProfile, `${entryField}.promptProfile`);
    if (byHandler.has(handler)) {
      throw new Error(`${entryField}.handler ${handler} is duplicated`);
    }
    byHandler.set(handler, frozenBinding(binding));
  });
  return byHandler;
}

// --- managed catalog safe projection ----------------------------------------

// Decode the bounded managed catalog safe projection and index each candidate
// by its content digest. Every candidate must carry the source's exact catalog
// digest, so a stale or substituted projection can never satisfy a managed
// compilation.
function decodeCatalogProjection(value, field, expectedCatalogDigest) {
  assertEncodedSize(value, field, CATALOG_MAX_BYTES);
  const input = objectValue(value, field);
  schemaMajorValue(input.schemaMajor, `${field}.schemaMajor`);
  const catalogDigest = digestValue(input.catalogDigest, `${field}.catalogDigest`);
  if (catalogDigest !== expectedCatalogDigest) {
    throw new Error(`${field}.catalogDigest does not match the source catalog digest; a managed compilation requires the exact catalog projection`);
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error(`${field}.candidates must be a non-empty array`);
  }
  if (input.candidates.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${field}.candidates exceeds the ${MAX_COLLECTION_ITEMS}-item limit`);
  }
  const byDigest = new Map();
  input.candidates.forEach((entry, index) => {
    const candidateField = `${field}.candidates[${index}]`;
    const projection = decodeCandidateSafeProjection(entry, candidateField);
    if (projection.catalogDigest !== expectedCatalogDigest) {
      throw new Error(`${candidateField}.catalogDigest does not match the source catalog digest`);
    }
    const digest = deriveCatalogDigest(projection);
    if (byDigest.has(digest)) {
      throw new Error(`${candidateField} duplicates candidate content digest ${digest}`);
    }
    byDigest.set(digest, projection);
  });
  return { catalogDigest, byDigest };
}

// --- compilation ------------------------------------------------------------

function compileStandalone(source, catalog, handlerProfiles) {
  // No mode inference: a standalone source never accepts a catalog projection,
  // and the presence of one must never upgrade it to managed.
  if (catalog !== undefined) {
    throw new Error("routedReviewSource is standalone; a candidate catalog projection is forbidden and never upgrades the mode");
  }
  const requiresHandlerProfiles = Object.values(source.routes).some(
    (route) => route.execution === "direct-handler",
  );
  let discovered;
  if (requiresHandlerProfiles) {
    if (handlerProfiles === undefined) {
      throw new Error("routedReviewSource declares a direct-handler route; setup-discovered handler profiles are required");
    }
    discovered = decodeHandlerProfiles(handlerProfiles, "handlerProfiles");
  } else if (handlerProfiles !== undefined) {
    discovered = decodeHandlerProfiles(handlerProfiles, "handlerProfiles");
  }

  const routes = {};
  for (const [lane, route] of Object.entries(source.routes)) {
    const routeField = `routedReviewSource.routes.${lane}`;
    if (route.execution === "direct-handler") {
      const fixed = discovered.get(route.handler);
      if (fixed === undefined) {
        throw new Error(`${routeField}.handler ${route.handler} is not a setup-discovered handler profile`);
      }
      if (!bindingsEqual(route.promptProfile, fixed)) {
        throw new Error(`${routeField}.promptProfile does not match the fixed setup-discovered profile for handler ${route.handler}`);
      }
      routes[lane] = Object.freeze({
        execution: route.execution,
        handler: route.handler,
        promptProfile: frozenBinding(route.promptProfile),
      });
    } else {
      routes[lane] = Object.freeze({
        execution: route.execution,
        attestation: Object.freeze({
          ...route.attestation,
          allowedAssociations: Object.freeze([...route.attestation.allowedAssociations]),
        }),
      });
    }
  }

  const body = {
    schemaVersion: COMPILER_SCHEMA_MAJOR,
    mode: "standalone",
    budgetOutcome: source.budgetOutcome,
    routes,
    ...(source.capabilityUnavailableReason === undefined
      ? {}
      : { capabilityUnavailableReason: source.capabilityUnavailableReason }),
  };
  const sourceDigest = deriveDigest(source);
  const manifest = { ...body, sourceDigest };
  const outputDigest = deriveDigest(manifest);
  return Object.freeze({ ...manifest, routes: Object.freeze(routes), outputDigest });
}

function compileManaged(source, catalog, handlerProfiles) {
  // No mode inference: a managed source never accepts standalone handler
  // profiles, and their absence never downgrades it to standalone.
  if (handlerProfiles !== undefined) {
    throw new Error("routedReviewSource is managed; standalone handler profiles are forbidden and never downgrade the mode");
  }
  if (catalog === undefined) {
    throw new Error("routedReviewSource is managed; the exact catalog safe projection is required");
  }
  const projection = decodeCatalogProjection(catalog, "catalogProjection", source.catalogDigest);

  const lanes = {};
  const boundDigests = new Map();
  for (const [lane, laneValue] of Object.entries(source.lanes)) {
    const laneField = `routedReviewSource.lanes.${lane}`;
    const candidateDigest = laneValue.candidate.candidateDigest;
    const candidate = projection.byDigest.get(candidateDigest);
    if (candidate === undefined) {
      throw new Error(`${laneField}.candidate references a candidate absent from the catalog projection`);
    }
    // Overlap: one candidate binds to at most one lane, so a compiled plan
    // never double-books the same content-addressed candidate.
    if (boundDigests.has(candidateDigest)) {
      throw new Error(`${laneField}.candidate overlaps lane ${boundDigests.get(candidateDigest)}; a candidate binds to at most one lane`);
    }
    boundDigests.set(candidateDigest, lane);
    if (!candidate.eligibleLanes.includes(lane)) {
      throw new Error(`${laneField}.candidate is not eligible for lane ${lane}`);
    }
    if (!candidate.eligibleSlots.includes(laneValue.slot)) {
      throw new Error(`${laneField}.slot ${laneValue.slot} is not an eligible slot for the candidate`);
    }
    // Exact prompt-profile identity: the lane's declared binding must equal the
    // candidate's authored binding. A referenced binding matches only on exact
    // alias/version/digest and native only on handler-managed; a substituted or
    // unknown profile fails closed. Handler compatibility for a referenced
    // profile is already proven by the safe projection decode.
    if (!bindingsEqual(laneValue.candidate.promptProfile, candidate.promptProfile)) {
      throw new Error(`${laneField}.candidate.promptProfile does not match the catalog candidate's exact prompt-profile identity`);
    }
    lanes[lane] = Object.freeze({
      slot: laneValue.slot,
      budgetExhaustion: Object.freeze({ merge: laneValue.budgetExhaustion.merge }),
      candidate: Object.freeze({
        candidateDigest,
        alias: candidate.alias,
        kind: candidate.kind,
        handler: candidate.handler,
        model: candidate.model,
        costTier: candidate.costTier,
        eligibleLanes: Object.freeze([...candidate.eligibleLanes]),
        eligibleSlots: Object.freeze([...candidate.eligibleSlots]),
        promptProfile: frozenBinding(candidate.promptProfile),
      }),
    });
  }

  const body = {
    schemaVersion: COMPILER_SCHEMA_MAJOR,
    mode: "managed",
    catalogDigest: source.catalogDigest,
    configurationDigest: source.configurationDigest,
    lanes,
  };
  const sourceDigest = deriveDigest(source);
  const manifest = { ...body, sourceDigest };
  const outputDigest = deriveDigest(manifest);
  return Object.freeze({ ...manifest, lanes: Object.freeze(lanes), outputDigest });
}

// Compile a versioned explicit-mode v2 source into a canonical compiled
// manifest with stable source, catalog, and output digests. Pure: no network,
// credential, filesystem, clock, environment, or output access. Equivalent
// semantic inputs compile byte-for-byte identically, and every semantic source
// or catalog change alters the output digest.
export function compileRoutedReviewConfiguration({ source, catalog, handlerProfiles } = {}) {
  assertEncodedSize(source, "routedReviewSource", SOURCE_MAX_BYTES);
  rejectCompositionLevers(source, "routedReviewSource");
  const decoded = decodeSourceContract(source);
  if (decoded.mode === "standalone") {
    return compileStandalone(decoded, catalog, handlerProfiles);
  }
  return compileManaged(decoded, catalog, handlerProfiles);
}
