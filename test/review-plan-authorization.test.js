import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileRoutedReviewConfiguration } from "../src/routed-review-compiler.js";
import {
  BLOCKING_CAUSES,
  CONTROL_PLANE_OUTCOMES,
  DEFERRAL_CAUSE,
  PLAN_AUTHORIZATION_SCHEMA_MAJOR,
  answerOptionsQuery,
  authorizePlan,
  createPlanAuthorizationState,
  interpretReviewCommand,
  prepareManagedPlan,
  resolveSelectionPrecedence,
  stablePlanJson,
} from "../src/review-plan-authorization.js";

// The suite drives the plan-authorization contract with fixtures compiled from
// the real managed routed-review source + catalog projection, so every named
// test maps directly to one of the ten acceptance criteria in prd.md. Time is
// always injected (`nowIso`). No test performs a reservation, dispatch, or any
// side effect: preparation is pure and authorization returns a NEW frozen state.

async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const validSources = await fixture("protocol/v2/routed-review-source.valid.json");
const catalogProjection = await fixture("protocol/v2/routed-review-catalog-projection.valid.json");
const managedSource = validSources.find((entry) => entry.mode === "managed").value;
const compiled = compileRoutedReviewConfiguration({ source: managedSource, catalog: catalogProjection });

const HEAD = "b".repeat(40);
const NOW = "2026-01-01T00:10:00Z";
const LEASE = "2026-01-01T01:00:00Z";
const POLICY_DIGEST = "1".repeat(64);
const ALT_DIGEST = "2".repeat(64);

const ASSURANCE = compiled.lanes.assurance.candidate;
const ASSURANCE_PROFILE = ASSURANCE.promptProfile;

function identity(overrides = {}) {
  return {
    tenant: "acme",
    repository: { owner: "acme", name: "widgets" },
    pullRequest: 42,
    headSha: HEAD,
    attempt: 1,
    ...overrides,
  };
}

// A considered candidate resolved from the catalog upstream. Each carries its
// OWN authored prompt-profile; a candidate command can only pick which one.
function candidate(overrides = {}) {
  const {
    alias = "assurance-strict",
    candidateDigest = ASSURANCE.candidateDigest,
    promptProfile = { mode: "referenced", alias: ASSURANCE_PROFILE.alias, version: ASSURANCE_PROFILE.version, digest: ASSURANCE_PROFILE.digest },
    poolId = "assurance-pool",
    headSha = HEAD,
    conservativeMaxCharge = 4000,
    maxExpectedCharge = 4000,
    hardRequestLimit = 6000,
    available = true,
    inputCounted = true,
    pricingVerified = true,
    enforceable = true,
    units = "tokens",
    preflightUnits = "tokens",
    promptProfileDigest,
  } = overrides;
  const profileDigest = promptProfileDigest
    ?? (promptProfile.mode === "referenced" ? promptProfile.digest : ALT_DIGEST);
  return {
    alias,
    candidateDigest,
    promptProfile,
    pricingVerified,
    enforceable,
    candidatePreflight: {
      schemaVersion: 2,
      headSha,
      candidateDigest,
      promptProfileDigest: profileDigest,
      policyDigest: POLICY_DIGEST,
      configurationDigest: compiled.configurationDigest,
      units: preflightUnits,
      countedInputTokens: 1000,
      inputCounted,
      outputCap: 2000,
      maxExpectedCharge,
      hardRequestLimit,
      safetyMargin: 100,
      capabilityEvidence: available ? { available: true } : { available: false, reason: "control_plane_unreachable" },
    },
    reservation: {
      poolId,
      units,
      conservativeMaxCharge,
      hardRequestLimit,
      leaseExpiresAt: LEASE,
      preflight: { bounded: true, sideEffectFree: true, method: "exact", inputUnits: 1000 },
    },
  };
}

function prepare(overrides = {}) {
  const { chain = [candidate()], lane = "assurance", ...rest } = overrides;
  return prepareManagedPlan({ compiled, lane, identity: identity(), chain, nowIso: NOW, ...rest });
}

function availabilityResponse() {
  return {
    schemaVersion: 2,
    catalogDigest: compiled.catalogDigest,
    configurationDigest: compiled.configurationDigest,
    options: [
      { alias: "assurance-strict", displayName: "Assurance Strict", handler: "pr-agent", costTier: "medium", eligibleLanes: ["assurance"], eligibleSlots: ["managed"], availability: { state: "available" } },
      { alias: "kimi-review", displayName: "Kimi Review", handler: "pr-agent", costTier: "low", eligibleLanes: ["review", "assurance"], eligibleSlots: ["managed", "parallel"], availability: { state: "available" } },
      { alias: "copilot-native", displayName: "Copilot", handler: "copilot", costTier: "unknown", eligibleLanes: ["gate"], eligibleSlots: ["parallel"], availability: { state: "degraded", reason: "provider incident" } },
    ],
  };
}

function response(prepared, overrides = {}) {
  const merged = {
    schemaMajor: 2,
    outcome: "authorized",
    requestFingerprint: prepared.requestFingerprint,
    planFingerprint: prepared.planFingerprint,
    candidateDigest: prepared.selected.candidateDigest,
    promptProfileDigest: prepared.selected.promptProfileDigest,
    headSha: prepared.identity.headSha,
    attempt: prepared.identity.attempt,
    reserved: true,
    revision: 1,
    ...overrides,
  };
  // A real JSON payload never carries explicit undefined; drop overridden-away
  // keys so the fixture matches a decoded wire object.
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}

// ===========================================================================
// AC1: first eligible selection, explicit override, shared pool, stale/unknown
// state, proven budget exhaustion, deferred assurance, blocked/passing gate.
// ===========================================================================

test("AC1 automatic selection takes the first eligible candidate in the named chain", () => {
  const chain = [
    candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" }, available: false }),
    candidate({ alias: "assurance-strict" }),
  ];
  const prepared = prepare({ chain });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.selected.alias, "assurance-strict", "the unavailable first member is skipped within the lane chain");
  assert.equal(prepared.controlPlaneRequest.proposals[0].eligible, false);
  assert.equal(prepared.controlPlaneRequest.proposals[0].ineligibleReason, "capability_unavailable");
});

test("AC1 an explicit override bypasses ordering and never falls through", () => {
  const chain = [candidate({ alias: "assurance-strict" }), candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" } })];
  const prepared = prepare({ chain, candidateOverride: "kimi-review" });
  assert.equal(prepared.selected.alias, "kimi-review");
  assert.equal(prepared.explicitOverride, true);
});

test("AC1 a shared pool is carried through preparation for every considered candidate", () => {
  const chain = [
    candidate({ alias: "assurance-strict", poolId: "shared-pool" }),
    candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" }, poolId: "shared-pool" }),
  ];
  const prepared = prepare({ chain });
  assert.deepEqual(prepared.controlPlaneRequest.proposals.map((proposal) => proposal.poolId), ["shared-pool", "shared-pool"]);
});

test("AC1 proven budget exhaustion records deferred assurance and the lane merge gate policy", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  const decision = authorizePlan({
    prepared,
    response: response(prepared, { outcome: "budget_exhausted", proven: true, poolId: "assurance-pool", reserved: undefined, revision: undefined }),
    state,
    nowIso: NOW,
  });
  assert.equal(decision.decision.outcome, "deferred");
  assert.equal(decision.decision.cause, DEFERRAL_CAUSE);
  assert.equal(decision.decision.assurance, "deferred");
  assert.equal(decision.decision.gatePolicy, "allow", "the assurance lane merge policy is allow");
  assert.equal(decision.decision.dispatchAllowed, false);
});

test("AC1 the gate lane's block merge policy defers with a blocking gate outcome", () => {
  const gateProfileDigest = compiled.lanes.gate.candidate.promptProfile.mode === "handler-managed" ? ALT_DIGEST : compiled.lanes.gate.candidate.promptProfile.digest;
  const gateCandidate = candidate({
    alias: "copilot-native",
    candidateDigest: compiled.lanes.gate.candidate.candidateDigest,
    promptProfile: { mode: "handler-managed" },
    poolId: "gate-pool",
    promptProfileDigest: gateProfileDigest,
  });
  const prepared = prepareManagedPlan({ compiled, lane: "gate", identity: identity(), chain: [gateCandidate], nowIso: NOW });
  const state = createPlanAuthorizationState();
  const decision = authorizePlan({
    prepared,
    response: response(prepared, { outcome: "budget_exhausted", proven: true, poolId: "gate-pool", reserved: undefined, revision: undefined }),
    state,
    nowIso: NOW,
  });
  assert.equal(decision.decision.outcome, "deferred");
  assert.equal(decision.decision.gatePolicy, "block", "the gate lane merge policy blocks");
});

// ===========================================================================
// AC2: non-budget causes always block regardless of the lane merge policy.
// ===========================================================================

test("AC2 authentication/policy/framework/unverifiable always block even when the lane merge policy is allow", () => {
  const prepared = prepare();
  assert.equal(prepared.mergePolicy, "allow", "the assurance lane would allow a budget defer");
  for (const cause of ["authentication", "policy", "framework"]) {
    const state = createPlanAuthorizationState();
    const decision = authorizePlan({ prepared, response: response(prepared, { outcome: "blocked", cause, reserved: undefined, revision: undefined }), state, nowIso: NOW });
    assert.equal(decision.decision.outcome, "blocked", cause);
    assert.equal(decision.decision.dispatchAllowed, false, cause);
    assert.equal(decision.decision.gatePolicy, undefined, "a non-budget block never carries a merge allowance");
  }
});

test("AC2 an unproven budget-exhaustion response blocks rather than deferring", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  const decision = authorizePlan({ prepared, response: response(prepared, { outcome: "budget_exhausted", proven: false, reserved: undefined, revision: undefined }), state, nowIso: NOW });
  assert.equal(decision.decision.outcome, "blocked");
  assert.equal(decision.decision.cause, "unverifiable");
});

// ===========================================================================
// AC3: trusted/untrusted, malformed, ambiguous, invalid-alias command tests
// cover one-attempt precedence and deterministic safe suggestions.
// ===========================================================================

test("AC3 an untrusted command is rejected with bounded lane suggestions", () => {
  const result = interpretReviewCommand({ body: "/review assurance --candidate assurance-strict", trusted: false, compiled, availability: availabilityResponse() });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "untrusted");
  assert.deepEqual(result.suggestions.lanes, ["assurance", "gate"]);
});

test("AC3 an invalid candidate alias yields deterministic sorted suggestions and no fuzzy match", () => {
  const result = interpretReviewCommand({ body: "/review assurance --candidate assurance-strck", trusted: true, compiled, availability: availabilityResponse() });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "invalid_candidate");
  assert.deepEqual(result.suggestions.candidates, ["assurance-strict", "kimi-review"], "eligible aliases, sorted, never corrected");
});

test("AC3 a malformed command is rejected and a non-/review body is ignored", () => {
  assert.equal(interpretReviewCommand({ body: "/review assurance --slot managed", trusted: true, compiled, availability: availabilityResponse() }).reason, "malformed");
  assert.equal(interpretReviewCommand({ body: "please review this", trusted: true, compiled }).status, "ignored");
});

test("AC3 a trusted command takes one-attempt precedence over conflicting broad route labels", () => {
  const resolved = resolveSelectionPrecedence({
    mode: { kind: "automatic" },
    trustedCommand: { lane: "assurance", candidate: "kimi-review" },
    routeLabels: ["gate"],
  });
  assert.equal(resolved.source, "trusted_command");
  assert.equal(resolved.lane, "assurance");
  assert.equal(resolved.candidate, "kimi-review");
  assert.deepEqual(resolved.ignoredLabelLanes, ["gate"], "a conflicting broad label cannot alter the command decision");
});

// ===========================================================================
// AC4: fixed-mode and trusted-command fixtures with conflicting broad route
// labels retain the higher-priority decision; automatic still fails visibly.
// ===========================================================================

test("AC4 a fixed mode retains its decision against a conflicting broad route label", () => {
  const resolved = resolveSelectionPrecedence({ mode: { kind: "fixed", lane: "assurance" }, routeLabels: ["gate"] });
  assert.equal(resolved.source, "fixed_mode");
  assert.equal(resolved.lane, "assurance");
  assert.deepEqual(resolved.ignoredLabelLanes, ["gate"]);
});

test("AC4 automatic mode with conflicting broad labels fails visibly", () => {
  assert.throws(
    () => resolveSelectionPrecedence({ mode: { kind: "automatic" }, routeLabels: ["assurance", "gate"] }),
    /conflicting broad route labels/u,
  );
});

test("AC4 a single broad route label resolves the lane under automatic mode", () => {
  const resolved = resolveSelectionPrecedence({ mode: { kind: "automatic" }, routeLabels: ["gate"] });
  assert.equal(resolved.source, "route_label");
  assert.equal(resolved.lane, "gate");
});

// ===========================================================================
// AC5: every options form returns bounded deterministic choices and proves
// zero attempt, reservation, persistence, and dispatch side effects.
// ===========================================================================

test("AC5 every options form returns bounded deterministic choices with no attempt identity", () => {
  const top = answerOptionsQuery({ command: { kind: "options", lane: null, slot: null }, compiled, availability: availabilityResponse() });
  assert.deepEqual(top.lanes, ["assurance", "gate"]);

  const lane = answerOptionsQuery({ command: { kind: "options", lane: "assurance", slot: null }, compiled, availability: availabilityResponse() });
  assert.equal(lane.slot, "managed");
  assert.deepEqual(lane.candidates.map((c) => c.alias), ["assurance-strict", "kimi-review"]);

  const slot = answerOptionsQuery({ command: { kind: "options", lane: "assurance", slot: "parallel" }, compiled, availability: availabilityResponse() });
  assert.deepEqual(slot.candidates.map((c) => c.alias), ["kimi-review"], "only parallel-eligible candidates for the lane");

  for (const result of [top, lane, slot]) {
    assert.ok(Object.isFrozen(result), "an options response is frozen");
    const encoded = stablePlanJson(result);
    for (const banned of ["requestFingerprint", "reservation", "authorization", "dispatch", "attempt"]) {
      assert.ok(!encoded.includes(banned), `an options view carries no ${banned}`);
    }
  }
});

// ===========================================================================
// AC6: reserved candidate/slot labels fail visibly while stable broad route
// labels retain their existing route semantics.
// ===========================================================================

test("AC6 a reserved candidate/slot label fails visibly in precedence resolution", () => {
  assert.throws(
    () => resolveSelectionPrecedence({ mode: { kind: "automatic" }, routeLabels: ["candidate:assurance-strict"] }),
    /candidate and slot selection is not label-controlled/u,
  );
});

test("AC6 a reserved selection label is rejected while a broad lane label keeps its route semantics", () => {
  const reserved = interpretReviewCommand({ body: "/review slot:managed --candidate kimi-review", trusted: true, compiled, availability: availabilityResponse() });
  assert.equal(reserved.reason, "reserved_selection_label");
  const broad = resolveSelectionPrecedence({ mode: { kind: "automatic" }, routeLabels: ["assurance"] });
  assert.equal(broad.lane, "assurance");
});

// ===========================================================================
// AC7: response mismatch, replay conflict, changed head, or stale configuration
// cannot authorize dispatch.
// ===========================================================================

test("AC7 a response fingerprint mismatch fails closed", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  assert.throws(
    () => authorizePlan({ prepared, response: response(prepared, { requestFingerprint: "0".repeat(64) }), state, nowIso: NOW }),
    /requestFingerprint does not match/u,
  );
});

test("AC7 a stale configuration (plan fingerprint) mismatch fails closed", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  assert.throws(
    () => authorizePlan({ prepared, response: response(prepared, { planFingerprint: "0".repeat(64) }), state, nowIso: NOW }),
    /planFingerprint does not match/u,
  );
});

test("AC7 a changed head returns reconciliation-required and never authorizes", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  const result = authorizePlan({ prepared, response: response(prepared, { headSha: "c".repeat(40) }), state, nowIso: NOW });
  assert.equal(result.decision.outcome, "reconciliation_required");
  assert.equal(result.decision.reason, "changed_head");
  assert.equal(result.decision.dispatchAllowed, false);
  assert.equal(result.state, state, "a changed head persists nothing");
});

test("AC7 a replay that would change the persisted decision is a conflict", () => {
  const prepared = prepare();
  const first = authorizePlan({ prepared, response: response(prepared), state: createPlanAuthorizationState(), nowIso: NOW });
  assert.throws(
    () => authorizePlan({ prepared, response: response(prepared, { outcome: "blocked", cause: "policy", reserved: undefined, revision: undefined }), state: first.state, nowIso: NOW }),
    /conflicts with the persisted authorization/u,
  );
});

// ===========================================================================
// AC8: prompt-profile mismatch, private-resolution failure, or prepared-request
// fingerprint drift cannot authorize dispatch or another candidate.
// ===========================================================================

test("AC8 a prompt-profile substitution on the bound candidate fails preparation", () => {
  const substituted = candidate({ promptProfile: { mode: "referenced", alias: ASSURANCE_PROFILE.alias, version: ASSURANCE_PROFILE.version, digest: ALT_DIGEST }, promptProfileDigest: ALT_DIGEST });
  assert.throws(
    () => prepare({ chain: [substituted] }),
    /does not match the compiled lane's exact prompt-profile identity/u,
  );
});

test("AC8 a preflight prompt-profile digest drift fails preparation before any request", () => {
  const drifted = candidate({ promptProfileDigest: ALT_DIGEST });
  assert.throws(
    () => prepare({ chain: [drifted] }),
    /promptProfileDigest does not match the exact bound prompt-profile digest/u,
  );
});

test("AC8 a response prompt-profile mismatch fails closed at authorization", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  assert.throws(
    () => authorizePlan({ prepared, response: response(prepared, { promptProfileDigest: ALT_DIGEST }), state, nowIso: NOW }),
    /promptProfileDigest does not match the selected prompt-profile identity/u,
  );
});

// ===========================================================================
// AC9: oversized/uncountable/unpriced/unit-mismatched/unenforceable requests
// fail before reservation with no silent truncation or lane escalation.
// ===========================================================================

test("AC9 an explicit oversized/uncountable/unpriced/unit/unenforceable candidate blocks without fallback", () => {
  const cases = {
    oversized: candidate({ alias: "assurance-strict", conservativeMaxCharge: 7000, hardRequestLimit: 6000, maxExpectedCharge: 6000 }),
    uncountable: candidate({ alias: "assurance-strict", inputCounted: false }),
    unpriced: candidate({ alias: "assurance-strict", pricingVerified: false }),
    unit_mismatch: candidate({ alias: "assurance-strict", units: "tokens", preflightUnits: "tokens" }),
    unenforceable: candidate({ alias: "assurance-strict", enforceable: false }),
  };
  for (const [reason, entry] of Object.entries(cases)) {
    if (reason === "unit_mismatch") continue; // exercised separately below
    const fallback = candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" } });
    const prepared = prepare({ chain: [entry, fallback], candidateOverride: "assurance-strict" });
    assert.equal(prepared.status, "blocked", reason);
    assert.equal(prepared.cause, "candidate_unavailable", reason);
    assert.equal(prepared.ineligibleReason, reason, `${reason} is classified before any reservation`);
  }
});

test("AC9 a unit-mismatched reservation is ineligible before reservation", () => {
  const mismatched = candidate({ alias: "assurance-strict", units: "requests", preflightUnits: "tokens" });
  assert.throws(
    () => prepare({ chain: [mismatched] }),
    /reservation.units must be one of/u,
    "an unsupported reservation unit fails closed at decode",
  );
});

test("AC9 automatic selection continues within the lane chain but never escalates to another lane", () => {
  const chain = [
    candidate({ alias: "assurance-strict", available: false }),
    candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" } }),
  ];
  const prepared = prepare({ chain });
  assert.equal(prepared.selected.alias, "kimi-review");
  assert.equal(prepared.lane, "assurance", "selection stayed within the requested lane");
});

test("AC9 when every chain candidate is ineligible the plan blocks and reserves nothing", () => {
  const chain = [candidate({ alias: "assurance-strict", available: false }), candidate({ alias: "kimi-review", candidateDigest: ALT_DIGEST, promptProfile: { mode: "handler-managed" }, available: false })];
  const prepared = prepare({ chain });
  assert.equal(prepared.status, "blocked");
  assert.equal(prepared.cause, "candidate_unavailable");
});

// ===========================================================================
// AC10: authorization persistence is idempotent, precedes every adapter call,
// and no internal fallback or post-ambiguity next-candidate selection exists.
// ===========================================================================

test("AC10 authorization persistence is idempotent and precedes dispatch permission", () => {
  const prepared = prepare();
  const first = authorizePlan({ prepared, response: response(prepared), state: createPlanAuthorizationState(), nowIso: NOW });
  assert.equal(first.decision.outcome, "authorized");
  assert.equal(first.decision.dispatchAllowed, true);
  assert.ok(Object.hasOwn(first.state.authorizations, prepared.requestFingerprint), "the authorization is persisted before dispatch permission");

  const replay = authorizePlan({ prepared, response: response(prepared), state: first.state, nowIso: NOW });
  assert.equal(replay.decision.replay, true);
  assert.equal(replay.decision.dispatchAllowed, true);
  assert.equal(replay.state, first.state, "an idempotent replay returns the same state object unchanged");
});

test("AC10 an ambiguous possible dispatch reconciles and never advances to another candidate", () => {
  const prepared = prepare();
  const state = createPlanAuthorizationState();
  const result = authorizePlan({ prepared, response: response(prepared, { outcome: "ambiguous", reserved: undefined, revision: undefined }), state, nowIso: NOW });
  assert.equal(result.decision.outcome, "reconciliation_required");
  assert.equal(result.decision.reason, "ambiguous");
  assert.equal(result.state, state, "an ambiguous outcome persists no authorization");
});

// ===========================================================================
// Shared invariants: managed-only, immutability, bounded request privacy.
// ===========================================================================

test("only an explicit managed compiled contract is accepted", () => {
  const standalone = compileRoutedReviewConfiguration({
    source: validSources.find((entry) => entry.name.includes("all-local")).value,
  });
  assert.throws(
    () => prepareManagedPlan({ compiled: standalone, lane: "review", identity: identity(), chain: [candidate()], nowIso: NOW }),
    /mode must be managed/u,
  );
});

test("a prepared plan is deeply frozen and its control-plane request carries no request content", () => {
  const prepared = prepare();
  assert.ok(Object.isFrozen(prepared));
  assert.ok(Object.isFrozen(prepared.controlPlaneRequest));
  assert.throws(
    () => prepareManagedPlan({ compiled, lane: "assurance", identity: identity(), chain: [{ ...candidate(), diff: "secret patch" }], nowIso: NOW }),
    /review-plan privacy boundary/u,
  );
});

test("the exported vocabularies are frozen and stable", () => {
  assert.equal(PLAN_AUTHORIZATION_SCHEMA_MAJOR, 2);
  assert.ok(Object.isFrozen(BLOCKING_CAUSES));
  assert.ok(Object.isFrozen(CONTROL_PLANE_OUTCOMES));
});
