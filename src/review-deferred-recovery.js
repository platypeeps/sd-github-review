// Deferred review recovery contract (A-011 companion, recovery scope).
//
// This module owns ONLY the schemas and a deterministic in-memory FAKE for the
// lifecycle of a budget-DEFERRED review: a bounded deferred record for an
// exhausted authorization attempt, an EXPLICIT and idempotent authorized
// recovery that creates a DISTINCT linked attempt, changed-head supersession,
// PR-close resolution, repository-lifecycle eligibility, and the exact-head
// assurance/gate Check projection with monotonic revision + compare-and-swap.
//
// It is a pure leaf: it imports no local module and never reads GitHub, the
// checkout, process state, the filesystem, the clock, environment, output
// files, or provider systems, and it emits no side effect. Time is ALWAYS an
// injected `nowIso` parameter so fake-clock conformance tests are deterministic;
// this module reads no clock of its own. Every reduce takes a decoded state and
// returns a NEW frozen state, so a rejected input (cross-tenant, stale
// authorization, changed head, duplicate, ambiguous prior dispatch, conflicting
// receipt) returns the input state unchanged and no partial mutation can escape.
//
// The eventual private implementation owns durable persistence, tenant/PR
// isolation, and the operator recovery command. A deferred record is never a
// replay of a prompt: no prompt, finding, transcript, or raw provider body ever
// enters this contract; the forbidden-field walker rejects them at every decode
// boundary. Recovery NEVER reviews automatically — it only records that a
// distinct authorized attempt superseded the deferral. `classifyDeferredRetention`
// returns a record shaped for `retention-policy.js#computeRecordLifecycle`, so a
// caller owns the standard-v1 duration math (180-day actionable maximum forcing
// the visible `expired_unreviewed` terminal, 30-day terminal detail, 13-month
// bounded receipt) while this module stays a leaf (no contract->contract import).

import { createHash } from "node:crypto";

export const DEFERRED_RECOVERY_SCHEMA_MAJOR = 2;

// --- size and shape bounds -------------------------------------------------

const CONTRACT_MAX_BYTES = 32 * 1024;
const RESPONSE_MAX_BYTES = 16 * 1024;
const SHORT_TEXT_MAX_BYTES = 128;
const MAX_COLLECTION_ITEMS = 64;
const MAX_NESTING_DEPTH = 32;
const ATTEMPT_MAX = 100_000_000;
const REVISION_MAX = 1_000_000_000;

// --- controlled vocabularies (mirrored, never imported) --------------------

// The lifecycle state of a deferred record. It stays `actionable` until an
// explicit resolution (recovered / superseded / pr_closed) or the retention
// policy forces the visible `expired_unreviewed` terminal.
export const DEFERRED_RECORD_STATES = Object.freeze([
  "actionable",
  "recovered",
  "superseded",
  "pr_closed",
  "expired_unreviewed",
]);

// The explicit resolutions that take a still-actionable record terminal early.
// They mirror `retention-policy.js#DEFERRED_RESOLUTIONS` so a classified record
// drives the same 30-day terminal-detail window.
export const DEFERRED_RESOLUTIONS = Object.freeze(["recovered", "superseded", "pr_closed"]);
const DEFERRED_RESOLUTION_SET = new Set(DEFERRED_RESOLUTIONS);

// The bounded content assurance a Check projection carries. A `deferred`
// assurance stays distinguishable from a completed review assurance regardless
// of the merge gate.
export const RECOVERY_ASSURANCES = Object.freeze(["deferred", "completed", "incomplete", "ambiguous"]);
const RECOVERY_ASSURANCE_SET = new Set(RECOVERY_ASSURANCES);

// The two distinguishable assurance KINDS the projection exposes: a budget
// deferral versus a real completed review attempt result.
export const RECOVERY_ASSURANCE_KINDS = Object.freeze(["deferred", "completed"]);

// The lane's budget-exhaustion merge policy the deferred review carries.
export const RECOVERY_GATE_POLICIES = Object.freeze(["block", "allow"]);
const RECOVERY_GATE_POLICY_SET = new Set(RECOVERY_GATE_POLICIES);

// The projected merge-gate outcome.
export const RECOVERY_GATE_OUTCOMES = Object.freeze(["blocked", "passed"]);

// Whether a prior dispatch is provably clean or AMBIGUOUS. An ambiguous prior
// dispatch is never replayed.
export const PRIOR_DISPATCH_STATES = Object.freeze(["clean", "ambiguous"]);
const PRIOR_DISPATCH_STATE_SET = new Set(PRIOR_DISPATCH_STATES);

// Duplicate evidence a recovery authorization must clear before creating a new
// attempt.
export const DUPLICATE_EVIDENCE = Object.freeze(["none", "duplicate_review", "duplicate_request"]);
const DUPLICATE_EVIDENCE_SET = new Set(DUPLICATE_EVIDENCE);

// A projection is `open` until a changed head supersedes it or the PR closes;
// afterwards it retains its evidence but rejects further advancement.
export const PROJECTION_STATES = Object.freeze(["open", "superseded", "pr_closed"]);

// The repository-lifecycle events that gate recovery eligibility. Uninstall and
// removal stop recovery immediately; purge and cross-tenant transfer follow the
// shared retention contract rather than silently deleting or reassigning.
export const REPOSITORY_LIFECYCLE_KINDS = Object.freeze([
  "uninstall",
  "removal",
  "transfer_same_tenant",
  "transfer_cross_tenant",
  "authorized_purge",
]);
const REPOSITORY_LIFECYCLE_KIND_SET = new Set(REPOSITORY_LIFECYCLE_KINDS);

// The bounded outcomes a reduce returns. `rejected` covers every fail-closed
// refusal that leaves the input state unchanged; `retained_late` records a late
// older result as immutable audit evidence WITHOUT advancing the projection.
export const RECOVERY_OUTCOMES = Object.freeze([
  "deferred",
  "recovered",
  "superseded",
  "pr_closed",
  "projected",
  "retained_late",
  "lifecycle_applied",
  "rejected",
]);

// The bounded, fail-closed reasons a reduce refuses. Each leaves the input state
// unchanged (except `retained_late`, which is its own non-rejecting outcome).
export const RECOVERY_REJECTIONS = Object.freeze([
  "unknown_deferral",
  "cross_tenant",
  "recovery_disabled",
  "not_actionable",
  "unauthorized_repository",
  "pull_request_closed",
  "policy_incompatible",
  "changed_head",
  "unchanged_head",
  "stale_attempt",
  "budget_unavailable",
  "duplicate",
  "ambiguous_prior_dispatch",
  "stale_revision",
  "conflicting_facts",
  "superseded_projection",
]);

// Retention subjects this module classifies, mapped onto the retention policy's
// data classes. A deferred record is `deferred_review` (180-day actionable
// maximum forcing `expired_unreviewed`, 30-day terminal detail); a receipt is a
// 13-month `bounded_event`; an audit trail is a 13-month `adjudication_chain`.
export const DEFERRED_RETENTION_SUBJECTS = Object.freeze(["deferred_record", "receipt", "audit"]);
const DEFERRED_RETENTION_SUBJECT_SET = new Set(DEFERRED_RETENTION_SUBJECTS);
const SUBJECT_TO_DATA_CLASS = Object.freeze({
  deferred_record: "deferred_review",
  receipt: "bounded_event",
  audit: "adjudication_chain",
});

// Forbidden field names, checked after case/separator normalization before any
// canonicalization. A deferred record, a recovery authorization, or a public
// projection carries only bounded aliases, fingerprints, and identities; a
// prompt/finding/diff/transcript body, a credential, a raw balance, or provider
// metadata never enters this contract.
const FORBIDDEN_CONTENT_FIELDS = new Set([
  "prompt",
  "prompts",
  "promptbody",
  "promptbodies",
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
  "providerpayload",
  "providerpayloads",
  "providermetadata",
  "rawprovider",
  "rawpayload",
  "rawpayloads",
  "billingpayload",
  "rawbilling",
  "balance",
  "balances",
  "rawbalance",
  "rawbalances",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "apikey",
  "apikeys",
  "token",
  "tokens",
  "managementendpoint",
  "managementendpoints",
  "endpoint",
  "endpoints",
  "baseurl",
  "authorizationheader",
  "bearer",
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

// Reject any prompt/finding/transcript/credential/provider/billing body.
function rejectForbiddenContent(value, field) {
  rejectFieldNames(value, field, FORBIDDEN_CONTENT_FIELDS, "deferred-recovery privacy boundary");
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

function integerValue(value, field, { minimum = 0, maximum = ATTEMPT_MAX } = {}) {
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
  if (value !== DEFERRED_RECOVERY_SCHEMA_MAJOR) {
    throw new Error(`${field} must use supported schema major ${DEFERRED_RECOVERY_SCHEMA_MAJOR}`);
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

// An opaque, non-secret reference (a deferral / recovery handle the private
// control plane resolves). The contract carries the handle, never a resolved
// value.
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

export function stableDeferredRecoveryJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableDeferredRecoveryJson(value), "utf8").digest("hex");
}

// Canonical fingerprint over any allow-listed field record. Reordered equivalent
// input produces the same digest; any changed field changes it.
export function deriveDeferredRecoveryDigest(fields) {
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

// The complete review identity every deferral and recovery attempt binds to:
// tenant, repository, PR, exact head, attempt, compiled digest, and candidate.
// The attempt is part of the identity, so a distinct recovery attempt is a
// distinct authorization and can never masquerade as the deferred attempt.
export function decodeReviewIdentity(value, field = "identity") {
  const identity = objectValue(value, field);
  return {
    tenant: aliasValue(identity.tenant, `${field}.tenant`),
    repository: repositoryValue(identity.repository, `${field}.repository`),
    pullRequest: integerValue(identity.pullRequest, `${field}.pullRequest`, { minimum: 1, maximum: ATTEMPT_MAX }),
    head: shaValue(identity.head, `${field}.head`),
    attempt: integerValue(identity.attempt, `${field}.attempt`, { minimum: 1, maximum: ATTEMPT_MAX }),
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

// The head-level identity the exact-head Check projection keys on. It is scoped
// to tenant/repository/PR/head, independent of a specific attempt.
function headCore(identity) {
  return {
    tenant: identity.tenant,
    repository: identity.repository,
    pullRequest: identity.pullRequest,
    head: identity.head,
  };
}

function deriveHeadKey(identity) {
  return deriveDeferredRecoveryDigest({ head: headCore(identity) });
}

function deriveAttemptFingerprint(identity) {
  return deriveDeferredRecoveryDigest({ attempt: identityCore(identity) });
}

function deriveDeferralFingerprint(identity, poolId, gatePolicy) {
  return deriveDeferredRecoveryDigest({ identity: identityCore(identity), poolId, gatePolicy });
}

function decodeReferences(value, field, handleKey) {
  const references = objectValue(value, field);
  const normalized = {
    authorizationFingerprint: digestValue(references.authorizationFingerprint, `${field}.authorizationFingerprint`),
  };
  if (references[handleKey] !== undefined) {
    normalized[handleKey] = referenceValue(references[handleKey], `${field}.${handleKey}`);
  }
  return normalized;
}

// --- shared state helpers ---------------------------------------------------

function requireState(state) {
  if (
    !isPlainObject(state)
    || state.schemaMajor !== DEFERRED_RECOVERY_SCHEMA_MAJOR
    || !isPlainObject(state.deferrals)
    || !isPlainObject(state.attempts)
    || !isPlainObject(state.projections)
  ) {
    throw new Error("a decoded deferred recovery state is required");
  }
  return state;
}

function cloneState(state) {
  return structuredClone(state);
}

function rejectedResult(state, reason, extra = {}) {
  return {
    state,
    decision: freezeDeep({ outcome: "rejected", replay: false, reason, ...extra }),
  };
}

// A completed review passes the merge gate. A still-deferred assurance follows
// the lane's budget-exhaustion merge policy: `block` holds the gate, `allow`
// passes it. The assurance KIND stays distinguishable in either case.
function gateOutcome(gatePolicy, assurance) {
  if (assurance !== "deferred") return "passed";
  return gatePolicy === "block" ? "blocked" : "passed";
}

function assuranceKindOf(assurance) {
  return assurance === "deferred" ? "deferred" : "completed";
}

function projectionPublic(projection) {
  return {
    headKey: projection.headKey,
    tenant: projection.tenant,
    repository: projection.repository,
    pullRequest: projection.pullRequest,
    head: projection.head,
    revision: projection.revision,
    status: projection.status,
    assurance: projection.assurance,
    assuranceKind: projection.assuranceKind,
    gatePolicy: projection.gatePolicy,
    gate: projection.gate,
    latestAuthorizedAttempt: { ...projection.latestAuthorizedAttempt },
  };
}

// --- initial state ----------------------------------------------------------

export function createDeferredRecoveryLedger() {
  return freezeDeep({
    schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
    deferrals: {},
    attempts: {},
    projections: {},
  });
}

// --- defer a budget-exhausted attempt --------------------------------------

function decodeDeferralInput(value, field = "deferral") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  return {
    identity: decodeReviewIdentity(input.identity, `${field}.identity`),
    poolId: aliasValue(input.poolId, `${field}.poolId`),
    gatePolicy: enumValue(input.gatePolicy, `${field}.gatePolicy`, RECOVERY_GATE_POLICY_SET),
    priorDispatch: enumValue(input.priorDispatch, `${field}.priorDispatch`, PRIOR_DISPATCH_STATE_SET),
    references: decodeReferences(input.references, `${field}.references`, "deferralRef"),
    revision: integerValue(input.revision, `${field}.revision`, { minimum: 1, maximum: REVISION_MAX }),
    deferredAt: optionalTimestamp(input.deferredAt, `${field}.deferredAt`),
  };
}

function deferralFactsDigest(input, deferralFingerprint) {
  return deriveDeferredRecoveryDigest({
    deferralFingerprint,
    identity: identityCore(input.identity),
    poolId: input.poolId,
    gatePolicy: input.gatePolicy,
    priorDispatch: input.priorDispatch,
    references: input.references,
    revision: input.revision,
  });
}

// Record a bounded deferred record for a budget-exhausted authorization attempt.
// The record is immutable: an identical callback is an idempotent replay; a
// changed fact on the same deferral identity fails closed rather than rewriting
// the receipt. The deferral seeds (or, for a newer attempt, advances) the
// exact-head Check projection with a distinguishable `deferred` assurance.
export function deferReview(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = decodeDeferralInput(value);
  const deferralFingerprint = deriveDeferralFingerprint(input.identity, input.poolId, input.gatePolicy);
  const headKey = deriveHeadKey(input.identity);
  const attemptFingerprint = deriveAttemptFingerprint(input.identity);
  const factsDigest = deferralFactsDigest(input, deferralFingerprint);
  const deferredAt = input.deferredAt ?? now;

  const existing = Object.hasOwn(state.deferrals, deferralFingerprint)
    ? state.deferrals[deferralFingerprint]
    : undefined;
  if (existing) {
    if (existing.factsDigest === factsDigest) {
      return { state, decision: freezeDeep({ ...existing.decision, replay: true }) };
    }
    if (input.revision <= existing.revision) {
      return rejectedResult(state, "stale_revision", { deferralFingerprint, revision: input.revision, currentRevision: existing.revision });
    }
    return rejectedResult(state, "conflicting_facts", { deferralFingerprint });
  }

  const gate = gateOutcome(input.gatePolicy, "deferred");
  const decision = {
    outcome: "deferred",
    replay: false,
    deferralFingerprint,
    headKey,
    recordState: "actionable",
    assurance: "deferred",
    assuranceKind: "deferred",
    gatePolicy: input.gatePolicy,
    gate,
    recoveryEligible: true,
    deferredAt,
  };

  const next = cloneState(state);
  next.deferrals[deferralFingerprint] = {
    deferralFingerprint,
    headKey,
    identity: identityCore(input.identity),
    poolId: input.poolId,
    gatePolicy: input.gatePolicy,
    priorDispatch: input.priorDispatch,
    references: input.references,
    state: "actionable",
    revision: input.revision,
    deferredAt,
    recoveryEligible: true,
    resolution: null,
    factsDigest,
    decision,
  };
  next.attempts[attemptFingerprint] = {
    attemptFingerprint,
    kind: "deferral",
    linkedDeferralFingerprint: deferralFingerprint,
    identity: identityCore(input.identity),
    headKey,
    revision: input.revision,
    createdAt: deferredAt,
  };
  seedProjectionForDeferral(next, input.identity, headKey, attemptFingerprint, input.gatePolicy, gate, deferredAt);
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

// Establish or advance the head projection for a deferral. A first deferral
// seeds the projection. A later, NEWER attempt on the same head advances the
// latest-authorized identity; an older attempt is retained as audit only.
function seedProjectionForDeferral(next, identity, headKey, attemptFingerprint, gatePolicy, gate, at) {
  const existing = Object.hasOwn(next.projections, headKey) ? next.projections[headKey] : undefined;
  if (!existing) {
    next.projections[headKey] = {
      headKey,
      tenant: identity.tenant,
      repository: identity.repository,
      pullRequest: identity.pullRequest,
      head: identity.head,
      revision: 1,
      status: "open",
      assurance: "deferred",
      assuranceKind: "deferred",
      gatePolicy,
      gate,
      latestAuthorizedAttempt: { attempt: identity.attempt, attemptFingerprint },
      audit: [],
    };
    return;
  }
  if (identity.attempt > existing.latestAuthorizedAttempt.attempt) {
    existing.revision += 1;
    existing.assurance = "deferred";
    existing.assuranceKind = "deferred";
    existing.gatePolicy = gatePolicy;
    existing.gate = gate;
    existing.latestAuthorizedAttempt = { attempt: identity.attempt, attemptFingerprint };
    return;
  }
  appendAudit(existing, { attempt: identity.attempt, attemptFingerprint, assurance: "deferred", at, note: "older_deferral" });
}

function appendAudit(projection, entry) {
  if (projection.audit.length >= MAX_COLLECTION_ITEMS) {
    throw new Error(`projection audit exceeds the ${MAX_COLLECTION_ITEMS}-entry limit`);
  }
  projection.audit.push(entry);
}

// --- authorized recovery ----------------------------------------------------

function decodeRecoveryInput(value, field = "recovery") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  const authorization = objectValue(input.authorization, `${field}.authorization`);
  return {
    deferralFingerprint: digestValue(input.deferralFingerprint, `${field}.deferralFingerprint`),
    authorization: {
      tenant: aliasValue(authorization.tenant, `${field}.authorization.tenant`),
      repositoryAccess: booleanValue(authorization.repositoryAccess, `${field}.authorization.repositoryAccess`),
      openPullRequest: booleanValue(authorization.openPullRequest, `${field}.authorization.openPullRequest`),
      exactHead: shaValue(authorization.exactHead, `${field}.authorization.exactHead`),
      currentPolicyValid: booleanValue(authorization.currentPolicyValid, `${field}.authorization.currentPolicyValid`),
      budgetAvailable: booleanValue(authorization.budgetAvailable, `${field}.authorization.budgetAvailable`),
      duplicateEvidence: enumValue(authorization.duplicateEvidence, `${field}.authorization.duplicateEvidence`, DUPLICATE_EVIDENCE_SET),
      priorDispatch: enumValue(authorization.priorDispatch, `${field}.authorization.priorDispatch`, PRIOR_DISPATCH_STATE_SET),
    },
    recovery: decodeReviewIdentity(input.recovery, `${field}.recovery`),
    references: decodeReferences(input.references, `${field}.references`, "recoveryRef"),
    revision: integerValue(input.revision, `${field}.revision`, { minimum: 1, maximum: REVISION_MAX }),
    recoveredAt: optionalTimestamp(input.recoveredAt, `${field}.recoveredAt`),
  };
}

// Create a DISTINCT authorized recovery attempt for a still-actionable deferred
// record. Recovery is EXPLICIT (it never reviews automatically) and idempotent.
// It revalidates tenant, repository access, the open PR, the EXACT head, the
// current compiled policy, budget availability, and duplicate evidence, and it
// never replays an ambiguous prior dispatch. A cross-tenant or stale
// authorization fails closed. A changed head is refused here (it must supersede
// instead of replaying). On success the deferred record resolves to `recovered`,
// a linked immutable recovery receipt is minted, and the exact-head projection's
// latest-authorized attempt advances to the recovery attempt via compare-and-swap.
export function recoverDeferredReview(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = decodeRecoveryInput(value);
  const recoveredAt = input.recoveredAt ?? now;

  const deferral = Object.hasOwn(state.deferrals, input.deferralFingerprint)
    ? state.deferrals[input.deferralFingerprint]
    : undefined;
  if (!deferral) {
    return rejectedResult(state, "unknown_deferral", { deferralFingerprint: input.deferralFingerprint });
  }

  const recoveryFingerprint = deriveDeferredRecoveryDigest({
    recovery: identityCore(input.recovery),
    deferralFingerprint: input.deferralFingerprint,
  });

  // Idempotent replay: the same authorized recovery attempt reproduces the stored
  // decision against the same state object; a conflicting reuse fails closed.
  if (Object.hasOwn(state.attempts, recoveryFingerprint)) {
    const stored = state.attempts[recoveryFingerprint];
    if (stored.factsDigest === recoveryFactsDigest(input, recoveryFingerprint)) {
      return { state, decision: freezeDeep({ ...stored.decision, replay: true }) };
    }
    return rejectedResult(state, "conflicting_facts", { deferralFingerprint: input.deferralFingerprint });
  }

  // Cross-tenant authorization or a recovery identity from another tenant fails
  // closed before any other check.
  if (input.authorization.tenant !== deferral.identity.tenant || input.recovery.tenant !== deferral.identity.tenant) {
    return rejectedResult(state, "cross_tenant", { deferralFingerprint: input.deferralFingerprint });
  }
  if (!deferral.recoveryEligible) {
    return rejectedResult(state, "recovery_disabled", { deferralFingerprint: input.deferralFingerprint });
  }
  if (deferral.state !== "actionable") {
    return rejectedResult(state, "not_actionable", { deferralFingerprint: input.deferralFingerprint, recordState: deferral.state });
  }
  if (!input.authorization.repositoryAccess) {
    return rejectedResult(state, "unauthorized_repository", { deferralFingerprint: input.deferralFingerprint });
  }
  if (!input.authorization.openPullRequest) {
    return rejectedResult(state, "pull_request_closed", { deferralFingerprint: input.deferralFingerprint });
  }
  if (!input.authorization.currentPolicyValid) {
    return rejectedResult(state, "policy_incompatible", { deferralFingerprint: input.deferralFingerprint });
  }
  // The authorization must revalidate the EXACT head; a changed head is never a
  // recovery (it must supersede the record instead of replaying it).
  if (input.authorization.exactHead !== deferral.identity.head || input.recovery.head !== deferral.identity.head) {
    return rejectedResult(state, "changed_head", { deferralFingerprint: input.deferralFingerprint });
  }
  // A recovery attempt must be a DISTINCT, newer attempt on the same PR and
  // repository; anything else is a stale authorization.
  if (
    input.recovery.pullRequest !== deferral.identity.pullRequest
    || input.recovery.repository.owner !== deferral.identity.repository.owner
    || input.recovery.repository.name !== deferral.identity.repository.name
    || input.recovery.attempt <= deferral.identity.attempt
  ) {
    return rejectedResult(state, "stale_attempt", { deferralFingerprint: input.deferralFingerprint });
  }
  if (!input.authorization.budgetAvailable) {
    return rejectedResult(state, "budget_unavailable", { deferralFingerprint: input.deferralFingerprint });
  }
  if (input.authorization.duplicateEvidence !== "none") {
    return rejectedResult(state, "duplicate", { deferralFingerprint: input.deferralFingerprint, duplicateEvidence: input.authorization.duplicateEvidence });
  }
  // An ambiguous prior dispatch — recorded on the deferral OR asserted by the
  // authorization — is never replayed.
  if (deferral.priorDispatch === "ambiguous" || input.authorization.priorDispatch === "ambiguous") {
    return rejectedResult(state, "ambiguous_prior_dispatch", { deferralFingerprint: input.deferralFingerprint });
  }

  const recoveryAttemptFingerprint = deriveAttemptFingerprint(input.recovery);
  const headKey = deferral.headKey;
  const decision = {
    outcome: "recovered",
    replay: false,
    deferralFingerprint: input.deferralFingerprint,
    recoveryFingerprint,
    recoveryAttemptFingerprint,
    headKey,
    recordState: "recovered",
    recoveryAttempt: input.recovery.attempt,
    assurance: "deferred",
    assuranceKind: "deferred",
    recoveredAt,
  };

  const next = cloneState(state);
  const stored = next.deferrals[input.deferralFingerprint];
  stored.state = "recovered";
  stored.resolution = { kind: "recovered", at: recoveredAt, recoveryFingerprint };
  next.attempts[recoveryFingerprint] = {
    attemptFingerprint: recoveryFingerprint,
    recoveryAttemptFingerprint,
    kind: "recovery",
    linkedDeferralFingerprint: input.deferralFingerprint,
    identity: identityCore(input.recovery),
    headKey,
    revision: input.revision,
    createdAt: recoveredAt,
    references: input.references,
    factsDigest: recoveryFactsDigest(input, recoveryFingerprint),
    decision,
  };
  // Same head: the recovery attempt becomes the latest authorized attempt via
  // compare-and-swap, so only it can later advance the assurance projection.
  const projection = next.projections[headKey];
  if (projection) {
    projection.revision += 1;
    projection.latestAuthorizedAttempt = { attempt: input.recovery.attempt, attemptFingerprint: recoveryAttemptFingerprint };
    projection.assurance = "deferred";
    projection.assuranceKind = "deferred";
    projection.gate = gateOutcome(projection.gatePolicy, "deferred");
  }
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

function recoveryFactsDigest(input, recoveryFingerprint) {
  return deriveDeferredRecoveryDigest({
    recoveryFingerprint,
    deferralFingerprint: input.deferralFingerprint,
    recovery: identityCore(input.recovery),
    authorization: input.authorization,
    references: input.references,
    revision: input.revision,
  });
}

// --- changed-head supersession ----------------------------------------------

function decodeSupersedeInput(value, field = "supersede") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, CONTRACT_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  return {
    deferralFingerprint: digestValue(input.deferralFingerprint, `${field}.deferralFingerprint`),
    successor: decodeReviewIdentity(input.successor, `${field}.successor`),
    gatePolicy: enumValue(input.gatePolicy, `${field}.gatePolicy`, RECOVERY_GATE_POLICY_SET),
    references: decodeReferences(input.references, `${field}.references`, "supersedeRef"),
    revision: integerValue(input.revision, `${field}.revision`, { minimum: 1, maximum: REVISION_MAX }),
    supersededAt: optionalTimestamp(input.supersededAt, `${field}.supersededAt`),
  };
}

// Supersede a still-actionable deferred record with a CHANGED head. The prior
// pending record is resolved `superseded` and its head projection is frozen as
// evidence (never replayed). A NEW head gets a fresh projection — new Checks —
// with its own distinguishable `deferred` assurance. A same-head successor is
// refused here (it is a recovery, not a supersession).
export function supersedeDeferredRecord(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = decodeSupersedeInput(value);
  const supersededAt = input.supersededAt ?? now;

  const deferral = Object.hasOwn(state.deferrals, input.deferralFingerprint)
    ? state.deferrals[input.deferralFingerprint]
    : undefined;
  if (!deferral) {
    return rejectedResult(state, "unknown_deferral", { deferralFingerprint: input.deferralFingerprint });
  }
  if (input.successor.tenant !== deferral.identity.tenant) {
    return rejectedResult(state, "cross_tenant", { deferralFingerprint: input.deferralFingerprint });
  }
  const successorFingerprint = deriveAttemptFingerprint(input.successor);
  if (deferral.state !== "actionable") {
    // An idempotent replay reproduces the stored supersession decision.
    if (deferral.state === "superseded" && deferral.resolution && deferral.resolution.successorFingerprint === successorFingerprint) {
      return { state, decision: freezeDeep({ ...deferral.supersedeDecision, replay: true }) };
    }
    return rejectedResult(state, "not_actionable", { deferralFingerprint: input.deferralFingerprint, recordState: deferral.state });
  }
  if (input.successor.head === deferral.identity.head) {
    return rejectedResult(state, "unchanged_head", { deferralFingerprint: input.deferralFingerprint });
  }
  if (
    input.successor.pullRequest !== deferral.identity.pullRequest
    || input.successor.repository.owner !== deferral.identity.repository.owner
    || input.successor.repository.name !== deferral.identity.repository.name
  ) {
    return rejectedResult(state, "stale_attempt", { deferralFingerprint: input.deferralFingerprint });
  }

  const newHeadKey = deriveHeadKey(input.successor);
  const gate = gateOutcome(input.gatePolicy, "deferred");
  const decision = {
    outcome: "superseded",
    replay: false,
    deferralFingerprint: input.deferralFingerprint,
    priorHeadKey: deferral.headKey,
    successorHeadKey: newHeadKey,
    successorFingerprint,
    recordState: "superseded",
    assurance: "deferred",
    assuranceKind: "deferred",
    gatePolicy: input.gatePolicy,
    gate,
    supersededAt,
  };

  const next = cloneState(state);
  const stored = next.deferrals[input.deferralFingerprint];
  stored.state = "superseded";
  stored.resolution = { kind: "superseded", at: supersededAt, successorFingerprint };
  stored.supersedeDecision = decision;
  // Freeze the prior head projection as retained evidence: it can no longer be
  // advanced, but its recorded assurance stays visible.
  const priorProjection = next.projections[deferral.headKey];
  if (priorProjection) {
    priorProjection.status = "superseded";
  }
  next.attempts[successorFingerprint] = {
    attemptFingerprint: successorFingerprint,
    kind: "supersession",
    linkedDeferralFingerprint: input.deferralFingerprint,
    identity: identityCore(input.successor),
    headKey: newHeadKey,
    revision: input.revision,
    createdAt: supersededAt,
    references: input.references,
  };
  // A changed head gets brand-new Checks: a fresh projection with its own
  // latest-authorized attempt.
  next.projections[newHeadKey] = {
    headKey: newHeadKey,
    tenant: input.successor.tenant,
    repository: input.successor.repository,
    pullRequest: input.successor.pullRequest,
    head: input.successor.head,
    revision: 1,
    status: "open",
    assurance: "deferred",
    assuranceKind: "deferred",
    gatePolicy: input.gatePolicy,
    gate,
    latestAuthorizedAttempt: { attempt: input.successor.attempt, attemptFingerprint: successorFingerprint },
    audit: [],
  };
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

// --- PR-close resolution -----------------------------------------------------

// Resolve a still-actionable deferred record because its pull request closed.
// The record goes terminal `pr_closed` and its head projection stops accepting
// advancement. A closed PR can never be recovered.
export function closeDeferredPullRequest(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  rejectForbiddenContent(value, "pullRequestClose");
  const input = objectValue(value, "pullRequestClose");
  schemaVersion(input.schemaMajor, "pullRequestClose.schemaMajor");
  const deferralFingerprint = digestValue(input.deferralFingerprint, "pullRequestClose.deferralFingerprint");
  const tenant = aliasValue(input.tenant, "pullRequestClose.tenant");
  const closedAt = optionalTimestamp(input.closedAt, "pullRequestClose.closedAt") ?? now;

  const deferral = Object.hasOwn(state.deferrals, deferralFingerprint) ? state.deferrals[deferralFingerprint] : undefined;
  if (!deferral) {
    return rejectedResult(state, "unknown_deferral", { deferralFingerprint });
  }
  if (tenant !== deferral.identity.tenant) {
    return rejectedResult(state, "cross_tenant", { deferralFingerprint });
  }
  if (deferral.state !== "actionable") {
    if (deferral.state === "pr_closed") {
      return { state, decision: freezeDeep({ ...deferral.closeDecision, replay: true }) };
    }
    return rejectedResult(state, "not_actionable", { deferralFingerprint, recordState: deferral.state });
  }

  const decision = {
    outcome: "pr_closed",
    replay: false,
    deferralFingerprint,
    headKey: deferral.headKey,
    recordState: "pr_closed",
    closedAt,
  };
  const next = cloneState(state);
  const stored = next.deferrals[deferralFingerprint];
  stored.state = "pr_closed";
  stored.resolution = { kind: "pr_closed", at: closedAt };
  stored.closeDecision = decision;
  const projection = next.projections[deferral.headKey];
  if (projection) {
    projection.status = "pr_closed";
  }
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

// --- repository lifecycle ----------------------------------------------------

// Apply a repository-lifecycle event to every matching deferred record.
// Uninstall and removal stop recovery eligibility IMMEDIATELY while retention
// continues. Authorized purge stops eligibility and marks records for deletion
// under the shared retention contract (never a silent delete). Cross-tenant
// transfer requires explicit destination authorization and policy revalidation
// and reassigns the tenant rather than silently reassigning records.
export function applyRepositoryLifecycle(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  rejectForbiddenContent(value, "repositoryLifecycle");
  assertEncodedSize(value, "repositoryLifecycle", CONTRACT_MAX_BYTES);
  const input = objectValue(value, "repositoryLifecycle");
  schemaVersion(input.schemaMajor, "repositoryLifecycle.schemaMajor");
  const kind = enumValue(input.kind, "repositoryLifecycle.kind", REPOSITORY_LIFECYCLE_KIND_SET);
  const tenant = aliasValue(input.tenant, "repositoryLifecycle.tenant");
  const repository = repositoryValue(input.repository, "repositoryLifecycle.repository");
  const appliedAt = optionalTimestamp(input.appliedAt, "repositoryLifecycle.appliedAt") ?? now;

  let destinationTenant;
  if (kind === "transfer_same_tenant") {
    booleanValue(input.revalidatedRepositoryIdentity, "repositoryLifecycle.revalidatedRepositoryIdentity");
    if (input.revalidatedRepositoryIdentity !== true) {
      throw new Error("repositoryLifecycle.revalidatedRepositoryIdentity must be true for a same-tenant transfer");
    }
  }
  if (kind === "transfer_cross_tenant") {
    destinationTenant = aliasValue(input.destinationTenant, "repositoryLifecycle.destinationTenant");
    if (destinationTenant === tenant) {
      throw new Error("repositoryLifecycle cross-tenant transfer must name a distinct destination tenant");
    }
    if (input.destinationAuthorization !== true) {
      throw new Error("repositoryLifecycle.destinationAuthorization must be true for a cross-tenant transfer");
    }
    if (input.policyRevalidated !== true) {
      throw new Error("repositoryLifecycle.policyRevalidated must be true for a cross-tenant transfer");
    }
  }
  const purgeRequestId = kind === "authorized_purge"
    ? digestValue(input.purgeRequestId, "repositoryLifecycle.purgeRequestId")
    : undefined;

  const next = cloneState(state);
  let affected = 0;
  for (const record of Object.values(next.deferrals)) {
    if (
      record.identity.tenant !== tenant
      || record.identity.repository.owner !== repository.owner
      || record.identity.repository.name !== repository.name
    ) {
      continue;
    }
    affected += 1;
    if (kind === "uninstall" || kind === "removal" || kind === "authorized_purge") {
      record.recoveryEligible = false;
    }
    if (kind === "authorized_purge") {
      record.deletionRequested = true;
      record.purgeRequestId = purgeRequestId;
    }
    if (kind === "transfer_cross_tenant") {
      // Record the destination tenant as non-key audit metadata. `identity`
      // feeds the digest-addressed `deferralFingerprint`/`headKey` (and every
      // linked attempt key), so it must stay immutable: mutating `identity.tenant`
      // without re-keying the maps would desynchronize the stored identity from
      // the keys derived from it, leaving records undiscoverable by deterministic
      // derivation and able to collide on a later deferral. Immutable identity
      // plus an explicit reassignment overlay keeps the state internally
      // consistent while still reassigning the tenant rather than silently
      // moving records into the destination namespace.
      record.reassignedFromTenant = tenant;
      record.reassignedToTenant = destinationTenant;
    }
  }
  const decision = {
    outcome: "lifecycle_applied",
    replay: false,
    kind,
    tenant,
    repository,
    affected,
    stopsRecovery: kind === "uninstall" || kind === "removal" || kind === "authorized_purge",
    retentionContinues: kind === "uninstall" || kind === "removal",
    deletionRequested: kind === "authorized_purge",
    reassignsSilently: false,
    appliedAt,
  };
  if (kind === "transfer_cross_tenant") {
    decision.destinationTenant = destinationTenant;
  }
  if (kind === "authorized_purge") {
    decision.purgeRequestId = purgeRequestId;
  }
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

// --- exact-head Check projection (monotonic + compare-and-swap) ------------

function decodeProjectionInput(value, field = "projectionUpdate") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const input = objectValue(value, field);
  schemaVersion(input.schemaMajor, `${field}.schemaMajor`);
  return {
    headKey: digestValue(input.headKey, `${field}.headKey`),
    attempt: integerValue(input.attempt, `${field}.attempt`, { minimum: 1, maximum: ATTEMPT_MAX }),
    attemptFingerprint: digestValue(input.attemptFingerprint, `${field}.attemptFingerprint`),
    expectedRevision: integerValue(input.expectedRevision, `${field}.expectedRevision`, { minimum: 1, maximum: REVISION_MAX }),
    assurance: enumValue(input.assurance, `${field}.assurance`, RECOVERY_ASSURANCE_SET),
    resultRef: input.resultRef === undefined ? undefined : referenceValue(input.resultRef, `${field}.resultRef`),
    observedAt: optionalTimestamp(input.observedAt, `${field}.observedAt`),
  };
}

// Advance the exact-head assurance/gate Check projection for the LATEST
// authorized attempt only, under a monotonic revision + compare-and-swap rule.
// A stale `expectedRevision` fails closed. A result from an OLDER attempt (or a
// superseded / closed projection) is retained as immutable audit evidence but
// can NEVER rewrite the current assurance or merge-gate state. A completed
// review is projected as a distinguishable `completed` assurance; a still
// `deferred` assurance follows the lane's merge policy at the gate.
export function projectRecoveryCheck(state, value, { nowIso } = {}) {
  requireState(state);
  const now = timestampValue(nowIso, "nowIso");
  const input = decodeProjectionInput(value);
  const observedAt = input.observedAt ?? now;

  const projection = Object.hasOwn(state.projections, input.headKey) ? state.projections[input.headKey] : undefined;
  if (!projection) {
    return rejectedResult(state, "unknown_deferral", { headKey: input.headKey });
  }

  const latest = projection.latestAuthorizedAttempt;
  const isLatest = input.attempt === latest.attempt && input.attemptFingerprint === latest.attemptFingerprint;

  // A superseded or closed projection retains evidence but never advances.
  if (projection.status !== "open") {
    return retainLate(state, input, observedAt, "superseded_projection");
  }
  // A result from an older attempt is retained as audit only.
  if (!isLatest) {
    return retainLate(state, input, observedAt, "older_attempt");
  }
  // Compare-and-swap: only the caller holding the current revision advances it.
  if (input.expectedRevision !== projection.revision) {
    return rejectedResult(state, "stale_revision", {
      headKey: input.headKey,
      expectedRevision: input.expectedRevision,
      currentRevision: projection.revision,
    });
  }

  const assuranceKind = assuranceKindOf(input.assurance);
  const gate = gateOutcome(projection.gatePolicy, input.assurance);
  const decision = {
    outcome: "projected",
    replay: false,
    headKey: input.headKey,
    revision: projection.revision + 1,
    attempt: input.attempt,
    attemptFingerprint: input.attemptFingerprint,
    assurance: input.assurance,
    assuranceKind,
    gatePolicy: projection.gatePolicy,
    gate,
    observedAt,
  };
  if (input.resultRef !== undefined) decision.resultRef = input.resultRef;

  const next = cloneState(state);
  const updated = next.projections[input.headKey];
  updated.revision += 1;
  updated.assurance = input.assurance;
  updated.assuranceKind = assuranceKind;
  updated.gate = gate;
  return { state: freezeDeep(next), decision: freezeDeep(decision) };
}

// Retain a late/older result as immutable audit evidence WITHOUT advancing the
// projection assurance or gate. The returned outcome is `retained_late`, never a
// silent overwrite.
function retainLate(state, input, observedAt, note) {
  const next = cloneState(state);
  const projection = next.projections[input.headKey];
  appendAudit(projection, {
    attempt: input.attempt,
    attemptFingerprint: input.attemptFingerprint,
    assurance: input.assurance,
    at: observedAt,
    note,
  });
  return {
    state: freezeDeep(next),
    decision: freezeDeep({
      outcome: "retained_late",
      replay: false,
      projectionUpdated: false,
      headKey: input.headKey,
      note,
      attempt: input.attempt,
      // The current projection assurance/gate is unchanged: a late result cannot
      // rewrite it.
      currentAssurance: projection.assurance,
      currentAssuranceKind: projection.assuranceKind,
      currentGate: projection.gate,
      currentRevision: projection.revision,
    }),
  };
}

// --- public bounded status references --------------------------------------

// Project the bounded, credential-free public status of one deferred record: its
// identity subset, lifecycle state, distinguishable assurance kind, gate policy,
// and recovery eligibility. It carries no prompt, finding, credential, or raw
// provider body — none ever entered the contract.
export function projectDeferredRecord(state, deferralFingerprint) {
  requireState(state);
  const key = digestValue(deferralFingerprint, "deferralFingerprint");
  if (!Object.hasOwn(state.deferrals, key)) {
    throw new Error(`projectDeferredRecord references unknown deferral ${key}`);
  }
  const record = state.deferrals[key];
  const normalized = {
    schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
    deferralFingerprint: record.deferralFingerprint,
    headKey: record.headKey,
    tenant: record.identity.tenant,
    repository: record.identity.repository,
    pullRequest: record.identity.pullRequest,
    head: record.identity.head,
    candidate: record.identity.candidate,
    state: record.state,
    assurance: "deferred",
    assuranceKind: "deferred",
    gatePolicy: record.gatePolicy,
    recoveryEligible: record.recoveryEligible,
    deferredAt: record.deferredAt,
  };
  if (record.resolution) {
    normalized.resolution = { kind: record.resolution.kind, at: record.resolution.at };
  }
  if (record.deletionRequested) {
    normalized.deletionRequested = true;
  }
  return freezeDeep(normalized);
}

// Project the bounded, credential-free public status of one exact-head Check.
export function projectHeadCheck(state, headKey) {
  requireState(state);
  const key = digestValue(headKey, "headKey");
  if (!Object.hasOwn(state.projections, key)) {
    throw new Error(`projectHeadCheck references unknown projection ${key}`);
  }
  return freezeDeep({ schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR, ...projectionPublic(state.projections[key]) });
}

// --- retention classification (leaf boundary) ------------------------------

// Classify a deferred record, a receipt, or an audit trail for retention WITHOUT
// importing the retention module. The returned record is shaped exactly for
// `retention-policy.js#computeRecordLifecycle`, which owns the standard-v1
// durations (180-day actionable maximum forcing the visible `expired_unreviewed`
// terminal, 30-day terminal detail, 13-month receipt/audit). An actionable
// record OMITS `terminalAt` so the caller applies the 180-day force preserving
// the explicit unreviewed state; a resolved record carries `terminalAt` (and the
// resolution) to drive the 30-day terminal-detail window. A rollback never
// restarts or extends the timer because the window is anchored to `coverageStart`.
export function classifyDeferredRetention(value, field = "deferredRetention") {
  rejectForbiddenContent(value, field);
  assertEncodedSize(value, field, RESPONSE_MAX_BYTES);
  const input = objectValue(value, field);
  if (input.subjects !== undefined) {
    throw new Error(`${field} must declare a single subject, not a subjects set`);
  }
  if (input.secondarySubject !== undefined) {
    throw new Error(`${field} must declare a single subject; a conflicting classification fails closed`);
  }
  const subject = enumValue(input.subject, `${field}.subject`, DEFERRED_RETENTION_SUBJECT_SET);
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
  if (dataClass === "deferred_review") {
    if (input.terminalAt !== undefined) {
      normalized.terminalAt = timestampValue(input.terminalAt, `${field}.terminalAt`);
      if (Date.parse(normalized.terminalAt) < Date.parse(normalized.coverageStart)) {
        throw new Error(`${field}.terminalAt must not precede coverageStart`);
      }
      if (input.resolution !== undefined) {
        normalized.resolution = enumValue(input.resolution, `${field}.resolution`, DEFERRED_RESOLUTION_SET);
      }
    } else if (input.resolution !== undefined) {
      throw new Error(`${field}.resolution requires terminalAt`);
    }
  } else if (dataClass === "adjudication_chain") {
    normalized.newestEventAt = optionalTimestamp(input.newestEventAt, `${field}.newestEventAt`) ?? createdAt;
    if (Date.parse(normalized.newestEventAt) < Date.parse(createdAt)) {
      throw new Error(`${field}.newestEventAt must not precede createdAt`);
    }
  }
  return Object.freeze(normalized);
}
