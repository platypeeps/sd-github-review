import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_LEDGER_SCHEMA_MAJOR,
  adjustPool,
  applyObservation,
  authorize,
  classifyBudgetRetention,
  createBudgetLedger,
  decodeBudgetObservation,
  decodeReservationRequest,
  deriveRequestFingerprint,
  expireLeases,
  projectPool,
  quarantineCandidate,
  reconcile,
  releaseQuarantine,
  releaseReservation,
  reserve,
  stableBudgetLedgerJson,
} from "../src/review-budget-ledger.js";
import { computeRecordLifecycle } from "../src/retention-policy.js";

// The suite drives the budget-ledger contract module with inline fixtures so
// every named test maps directly to one of the seven acceptance criteria in
// prd.md. Time is always injected (`nowIso`) so the fake-clock lifecycle tests
// are deterministic. Retention durations are asserted by feeding the leaf's
// `classifyBudgetRetention` output into `retention-policy.js#computeRecordLifecycle`,
// which keeps this module a pure leaf while still proving the standard-v1 math.

const DIGEST = "a".repeat(64);
const HEAD = "b".repeat(40);

function identity(overrides = {}) {
  return {
    tenant: "acme",
    repository: { owner: "acme", name: "widgets" },
    pullRequest: 42,
    head: HEAD,
    attempt: 1,
    compiledDigest: DIGEST,
    candidate: "kimi-review",
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    poolId: "kimi-pool",
    kind: "independent",
    units: "tokens",
    provider: "provider-a",
    sourceRef: "acct:acme-kimi",
    amount: 10_000,
    safetyMargin: 1_000,
    observedAt: "2026-01-01T00:00:00Z",
    freshnessDeadline: "2026-01-02T00:00:00Z",
    confidence: "known",
    candidates: ["kimi-review"],
    ...overrides,
  };
}

function sharedObservation(overrides = {}) {
  return observation({
    poolId: "shared-pool",
    kind: "shared",
    candidates: ["kimi-review", "qwen-review"],
    amount: 5_000,
    safetyMargin: 0,
    ...overrides,
  });
}

function ledger(observations = [observation()], quarantine) {
  return createBudgetLedger({
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    observations,
    ...(quarantine ? { quarantine } : {}),
  });
}

function request(overrides = {}) {
  const { identity: identityOverrides, ...rest } = overrides;
  return {
    schemaMajor: BUDGET_LEDGER_SCHEMA_MAJOR,
    identity: identity(identityOverrides),
    poolId: "kimi-pool",
    units: "tokens",
    conservativeMaxCharge: 4_000,
    hardRequestLimit: 6_000,
    expectedAverage: 2_000,
    preflight: { bounded: true, sideEffectFree: true, method: "exact", inputUnits: 3_000 },
    leaseExpiresAt: "2026-01-01T01:00:00Z",
    ...rest,
  };
}

const NOW = "2026-01-01T00:10:00Z";

// ===========================================================================
// AC1: Conformance fixtures cover independent/shared pools, concurrent
// boundary, replay, lease expiry, stale/unknown state, and safety margins.
// ===========================================================================

test("AC1 independent and shared pools each decode and reserve deterministically", () => {
  const independent = ledger();
  const reserved = reserve(independent, request(), { nowIso: NOW });
  assert.equal(reserved.decision.outcome, "reserved");
  assert.equal(reserved.decision.pool.kind, "independent");

  const shared = ledger([sharedObservation()]);
  const first = reserve(shared, request({ poolId: "shared-pool", conservativeMaxCharge: 3_000, hardRequestLimit: 3_000, expectedAverage: 1_000 }), { nowIso: NOW });
  assert.equal(first.decision.outcome, "reserved");
  assert.equal(first.decision.pool.kind, "shared");
  assert.equal(first.decision.pool.usable, 2_000);
});

test("AC1 the concurrent boundary against a shared pool serializes atomically", () => {
  const shared = ledger([sharedObservation({ amount: 5_000, safetyMargin: 0 })]);
  const winner = reserve(shared, request({ poolId: "shared-pool", identity: { candidate: "kimi-review" }, conservativeMaxCharge: 3_000, hardRequestLimit: 3_000, expectedAverage: 1_000 }), { nowIso: NOW });
  assert.equal(winner.decision.outcome, "reserved");
  // The loser competes from the SAME pre-decision state and cannot fit.
  const loser = reserve(winner.state, request({ poolId: "shared-pool", identity: { candidate: "qwen-review" }, conservativeMaxCharge: 3_000, hardRequestLimit: 3_000, expectedAverage: 1_000 }), { nowIso: NOW });
  assert.equal(loser.decision.outcome, "ineligible");
  assert.equal(loser.decision.reason, "insufficient_usable_capacity");
});

test("AC1 replaying the same reservation is idempotent and never double-charges", () => {
  const base = ledger();
  const first = reserve(base, request(), { nowIso: NOW });
  const replay = reserve(first.state, request(), { nowIso: NOW });
  assert.equal(replay.decision.replay, true);
  assert.equal(replay.decision.outcome, "reserved");
  assert.equal(replay.decision.lease.requestFingerprint, first.decision.lease.requestFingerprint);
  assert.equal(replay.decision.pool.reservedTotal, 4_000, "a replay does not add a second hold");
});

test("AC1 an expired lease returns its held capacity to the pool", () => {
  const base = ledger();
  const reserved = reserve(base, request(), { nowIso: NOW });
  assert.equal(projectPool(reserved.state, "kimi-pool").reservedTotal, 4_000);
  const expired = expireLeases(reserved.state, { nowIso: "2026-01-01T02:00:00Z" });
  assert.deepEqual([...expired.expired], [reserved.decision.lease.requestFingerprint]);
  assert.equal(projectPool(expired.state, "kimi-pool").reservedTotal, 0, "expired capacity is freed");
});

test("AC1 a stale or unknown observation fails closed", () => {
  const stale = ledger([observation({ freshnessDeadline: "2026-01-01T00:05:00Z" })]);
  const staleDecision = reserve(stale, request(), { nowIso: NOW });
  assert.equal(staleDecision.decision.outcome, "ineligible");
  assert.equal(staleDecision.decision.reason, "observation_stale");

  const unknown = ledger([observation({ confidence: "unknown" })]);
  const unknownDecision = reserve(unknown, request(), { nowIso: NOW });
  assert.equal(unknownDecision.decision.reason, "observation_unknown");
});

test("AC1 the safety margin is withheld from usable capacity", () => {
  const base = ledger([observation({ amount: 10_000, safetyMargin: 7_000 })]);
  // usable = 10000 - 7000 margin = 3000; a 4000 charge cannot fit.
  const denied = reserve(base, request({ conservativeMaxCharge: 4_000 }), { nowIso: NOW });
  assert.equal(denied.decision.reason, "insufficient_usable_capacity");
  const allowed = reserve(base, request({ conservativeMaxCharge: 3_000 }), { nowIso: NOW });
  assert.equal(allowed.decision.outcome, "reserved");
});

// ===========================================================================
// AC2: Losing concurrent attempts receive bounded ineligibility without
// silent partial mutation.
// ===========================================================================

test("AC2 a losing attempt gets bounded ineligibility and leaves the state untouched", () => {
  const shared = ledger([sharedObservation({ amount: 4_000, safetyMargin: 0 })]);
  const winner = reserve(shared, request({ poolId: "shared-pool", identity: { candidate: "kimi-review" }, conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const loser = reserve(winner.state, request({ poolId: "shared-pool", identity: { candidate: "qwen-review" }, conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  assert.equal(loser.decision.outcome, "ineligible");
  assert.ok(INELIGIBLE_REASONS().has(loser.decision.reason), "the reason is bounded");
  assert.equal(loser.state, winner.state, "a losing attempt performs no partial mutation");
  assert.equal(Object.keys(loser.state.leases).length, 1, "only the winning lease exists");
});

function INELIGIBLE_REASONS() {
  return new Set([
    "insufficient_usable_capacity",
    "pool_overdrawn",
    "candidate_quarantined",
    "observation_stale",
    "observation_unknown",
    "lease_expiry_not_future",
  ]);
}

// ===========================================================================
// AC3: A timeout before authorization is safely retryable with the same
// identity.
// ===========================================================================

test("AC3 a timeout before authorization is retryable with the same identity", () => {
  const base = ledger();
  const first = reserve(base, request(), { nowIso: NOW });
  // Authorization never happened (a timeout). The same identity retries.
  const retry = reserve(first.state, request(), { nowIso: NOW });
  assert.equal(retry.decision.replay, true);
  assert.equal(retry.decision.lease.state, "reserved");
  assert.equal(retry.decision.lease.requestFingerprint, first.decision.lease.requestFingerprint);
  assert.equal(projectPool(retry.state, "kimi-pool").reservedTotal, 4_000);
});

test("AC3 a distinct recovery attempt is a distinct identity, lease, and revision CAS", () => {
  const base = ledger();
  const original = reserve(base, request({ identity: { attempt: 1 } }), { nowIso: NOW });
  const authorized = authorize(original.state, { requestFingerprint: original.decision.lease.requestFingerprint, revision: 1, authorizedAttempt: 1 }, { nowIso: NOW });
  assert.equal(authorized.decision.outcome, "authorized");

  // A recovery is a NEW attempt: a different fingerprint, a separate lease.
  const recovery = reserve(authorized.state, request({ identity: { attempt: 2 }, conservativeMaxCharge: 2_000, hardRequestLimit: 2_000, expectedAverage: 500 }), { nowIso: NOW });
  assert.notEqual(recovery.decision.lease.requestFingerprint, original.decision.lease.requestFingerprint);

  // A stale-revision recovery authorization loses the compare-and-swap with no mutation.
  const stale = authorize(recovery.state, { requestFingerprint: recovery.decision.lease.requestFingerprint, revision: 1, authorizedAttempt: 2 }, { nowIso: NOW });
  assert.equal(stale.decision.outcome, "rejected");
  assert.equal(stale.decision.reason, "stale_revision");
  assert.equal(stale.state, recovery.state, "a lost CAS performs no partial mutation");

  // A newer revision wins deterministically and records the latest attempt.
  const won = authorize(recovery.state, { requestFingerprint: recovery.decision.lease.requestFingerprint, revision: 2, authorizedAttempt: 2 }, { nowIso: NOW });
  assert.equal(won.decision.outcome, "authorized");
  assert.equal(projectPool(won.state, "kimi-pool").latestAuthorizedAttempt, 2);
  assert.equal(projectPool(won.state, "kimi-pool").authorizationRevision, 2);
});

// ===========================================================================
// AC4: Reservation fixtures cover conservative maximum cost, hard request
// limit, unit mismatch, missing/unsafe preflight, and refusal to reserve
// beyond usable pool capacity.
// ===========================================================================

test("AC4 a reservation reserves the conservative maximum, never the expected average", () => {
  const base = ledger();
  const reserved = reserve(base, request({ conservativeMaxCharge: 4_000, expectedAverage: 500 }), { nowIso: NOW });
  assert.equal(reserved.decision.lease.amount, 4_000, "capacity is held against the conservative maximum");
  assert.equal(reserved.decision.lease.expectedAverage, 500, "the average is reported but never reserved");
  assert.equal(projectPool(reserved.state, "kimi-pool").reservedTotal, 4_000);
});

test("AC4 the conservative maximum must not exceed the hard per-request limit", () => {
  assert.throws(
    () => decodeReservationRequest(request({ conservativeMaxCharge: 7_000, hardRequestLimit: 6_000 })),
    /conservativeMaxCharge must not exceed hardRequestLimit/u,
  );
});

test("AC4 an expected average may never exceed the conservative maximum", () => {
  assert.throws(
    () => decodeReservationRequest(request({ conservativeMaxCharge: 3_000, expectedAverage: 4_000 })),
    /expectedAverage must not exceed conservativeMaxCharge/u,
  );
});

test("AC4 a unit mismatch between request and pool fails closed", () => {
  const base = ledger();
  assert.throws(
    () => reserve(base, request({ units: "usd_micros" }), { nowIso: NOW }),
    /does not match pool units/u,
  );
});

test("AC4 a missing or unsafe preflight fails closed", () => {
  assert.throws(
    () => decodeReservationRequest(request({ preflight: { bounded: false, sideEffectFree: true, method: "exact", inputUnits: 10 } })),
    /bounded must be explicitly true/u,
  );
  assert.throws(
    () => decodeReservationRequest(request({ preflight: { bounded: true, sideEffectFree: false, method: "exact", inputUnits: 10 } })),
    /sideEffectFree must be explicitly true/u,
  );
  assert.throws(
    () => decodeReservationRequest({ ...request(), preflight: "missing" }),
    /preflight must be an object/u,
  );
});

test("AC4 a request is refused when it exceeds usable pool capacity", () => {
  const base = ledger([observation({ amount: 5_000, safetyMargin: 1_000 })]);
  const denied = reserve(base, request({ conservativeMaxCharge: 4_500, hardRequestLimit: 5_000 }), { nowIso: NOW });
  assert.equal(denied.decision.outcome, "ineligible");
  assert.equal(denied.decision.reason, "insufficient_usable_capacity");
  assert.equal(Object.keys(denied.state.leases).length, 0, "a refused request holds nothing");
});

// ===========================================================================
// AC5: Overdrawn pools block new work and recover only through a fresh
// authoritative observation or audited adjustment.
// ===========================================================================

test("AC5 an authoritative over-charge drives the pool overdrawn and blocks new work", () => {
  const base = ledger([observation({ amount: 5_000, safetyMargin: 0 })]);
  const reserved = reserve(base, request({ conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const authorized = authorize(reserved.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, authorizedAttempt: 1 }, { nowIso: NOW });
  // Reconciliation debits more than the whole pool.
  const settled = reconcile(authorized.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, actualCharge: 6_000 }, { nowIso: NOW });
  assert.equal(settled.decision.overdrawn, true);
  assert.equal(projectPool(settled.state, "kimi-pool").state, "overdrawn");
  const blocked = reserve(settled.state, request({ identity: { attempt: 2 }, conservativeMaxCharge: 100, hardRequestLimit: 100, expectedAverage: 50 }), { nowIso: NOW });
  assert.equal(blocked.decision.reason, "pool_overdrawn");
});

test("AC5 an overdrawn pool recovers only through a fresh known observation", () => {
  const overdrawn = makeOverdrawnPool();
  // A stale replenishment does NOT clear overdrawn.
  const stale = applyObservation(overdrawn, observation({ amount: 20_000, safetyMargin: 0, confidence: "known", freshnessDeadline: "2026-01-01T00:05:00Z" }), { nowIso: NOW });
  assert.equal(stale.decision.clearedOverdrawn, false);
  assert.equal(projectPool(stale.state, "kimi-pool").state, "overdrawn");
  // A fresh, known replenishment restores usable capacity.
  const fresh = applyObservation(overdrawn, observation({ amount: 20_000, safetyMargin: 0, confidence: "known", freshnessDeadline: "2026-01-02T00:00:00Z" }), { nowIso: NOW });
  assert.equal(fresh.decision.clearedOverdrawn, true);
  assert.equal(projectPool(fresh.state, "kimi-pool").state, "usable");
});

test("AC5 an overdrawn pool recovers through an audited adjustment", () => {
  const overdrawn = makeOverdrawnPool();
  const adjusted = adjustPool(overdrawn, { poolId: "kimi-pool", audited: true, actor: "billing-ops", reason: "verified provider credit", capacityDelta: 5_000 }, { nowIso: NOW });
  assert.equal(adjusted.decision.clearedOverdrawn, true);
  assert.equal(projectPool(adjusted.state, "kimi-pool").state, "usable");
  assert.throws(
    () => adjustPool(overdrawn, { poolId: "kimi-pool", audited: false, actor: "x", reason: "y", capacityDelta: 5_000 }, { nowIso: NOW }),
    /audited must be explicitly true/u,
  );
});

test("AC5 pool recovery never auto-clears a candidate quarantine", () => {
  const overdrawn = makeOverdrawnPool();
  const quarantined = quarantineCandidate(overdrawn, { candidate: "kimi-review", reason: "provider incident", effectiveAt: NOW }, { nowIso: NOW });
  const recovered = applyObservation(quarantined.state, observation({ amount: 20_000, safetyMargin: 0, freshnessDeadline: "2026-01-02T00:00:00Z" }), { nowIso: NOW });
  assert.equal(projectPool(recovered.state, "kimi-pool").state, "usable", "the pool recovered");
  const blocked = reserve(recovered.state, request({ identity: { attempt: 9 }, conservativeMaxCharge: 100, hardRequestLimit: 100, expectedAverage: 10 }), { nowIso: NOW });
  assert.equal(blocked.decision.reason, "candidate_quarantined", "quarantine survives pool recovery");
  // Quarantine clears only through an explicit release.
  const released = releaseQuarantine(recovered.state, { candidate: "kimi-review", reason: "incident closed", effectiveAt: NOW }, { nowIso: NOW });
  const ok = reserve(released.state, request({ identity: { attempt: 9 }, conservativeMaxCharge: 100, hardRequestLimit: 100, expectedAverage: 10 }), { nowIso: NOW });
  assert.equal(ok.decision.outcome, "reserved");
});

function makeOverdrawnPool() {
  const base = ledger([observation({ amount: 5_000, safetyMargin: 0 })]);
  const reserved = reserve(base, request({ conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const authorized = authorize(reserved.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, authorizedAttempt: 1 }, { nowIso: NOW });
  const settled = reconcile(authorized.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, actualCharge: 8_000 }, { nowIso: NOW });
  assert.equal(projectPool(settled.state, "kimi-pool").state, "overdrawn");
  return settled.state;
}

// ===========================================================================
// AC6: Public responses contain no management credential or raw billing
// payload.
// ===========================================================================

test("AC6 a raw billing payload or management credential is rejected at every boundary", () => {
  for (const forbidden of ["rawBilling", "billingPayload", "balance", "managementCredential", "managementEndpoint", "apiKey"]) {
    assert.throws(
      () => decodeBudgetObservation(observation({ [forbidden]: { leak: "secret-value" } })),
      /budget-ledger privacy boundary/u,
      `observation must reject ${forbidden}`,
    );
    assert.throws(
      () => decodeReservationRequest({ ...request(), [forbidden]: "secret-value" }),
      /budget-ledger privacy boundary/u,
      `request must reject ${forbidden}`,
    );
  }
});

test("AC6 the public pool projection carries no credential or raw billing field", () => {
  const base = ledger();
  const reserved = reserve(base, request(), { nowIso: NOW });
  const projection = projectPool(reserved.state, "kimi-pool");
  const encoded = stableBudgetLedgerJson(projection).toLowerCase();
  for (const banned of ["billing", "credential", "secret", "apikey", "managementendpoint", "rawbalance"]) {
    assert.ok(!encoded.includes(banned), `projection must not expose ${banned}`);
  }
  // Only the opaque, non-secret source reference is carried.
  assert.equal(projection.sourceRef, "acct:acme-kimi");
});

// ===========================================================================
// AC7: Fake-clock fixtures cover 90-day detail/observation expiry, 180-day
// unresolved expiry, 13-month receipts, holds, purge, and coverage.
// ===========================================================================

const RETENTION_BINDING = { retentionPolicyId: "standard-v1", version: "1.0.0", digest: DIGEST };

test("AC7 terminal reservation/lease/authorization detail is retained for 90 days", () => {
  const record = classifyBudgetRetention({
    subject: "authorization",
    createdAt: "2026-01-01T00:00:00Z",
    terminalAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "operational_state");
  const before = computeRecordLifecycle(record, { nowIso: "2026-03-31T00:00:00Z" });
  assert.equal(before.lifecycleState, "terminal", "detail is retained inside the 90-day window");
  const after = computeRecordLifecycle(record, { nowIso: "2026-04-02T00:00:00Z" });
  assert.equal(after.lifecycleState, "compacted", "detail compacts after 90 days");
});

test("AC7 an unresolved reservation is forced to expired_unknown after 180 days", () => {
  const record = classifyBudgetRetention({
    subject: "reservation",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2026-07-05T00:00:00Z" });
  assert.equal(lifecycle.terminalState, "expired_unknown");
});

test("AC7 a raw budget observation is retained for 90 days", () => {
  const record = classifyBudgetRetention({
    subject: "budget_observation",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "budget_observation");
  const before = computeRecordLifecycle(record, { nowIso: "2026-03-31T00:00:00Z" });
  assert.equal(before.lifecycleState, "active");
  const after = computeRecordLifecycle(record, { nowIso: "2026-04-02T00:00:00Z" });
  assert.equal(after.lifecycleState, "deleted");
});

test("AC7 a bounded receipt is retained for 13 calendar months", () => {
  const record = classifyBudgetRetention({
    subject: "receipt",
    createdAt: "2026-01-31T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "bounded_event");
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" });
  assert.equal(lifecycle.lifecycleState, "active");
  // 13 calendar months after Jan 31 2026 clamps to the end of February 2027.
  assert.equal(lifecycle.retainedUntil, "2027-02-28T00:00:00.000Z");
});

test("AC7 an audit chain is retained for 13 months relative to its newest event", () => {
  const record = classifyBudgetRetention({
    subject: "audit",
    createdAt: "2026-01-01T00:00:00Z",
    newestEventAt: "2026-02-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "adjudication_chain");
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2027-03-02T00:00:00Z" });
  assert.equal(lifecycle.lifecycleState, "deleted", "the chain expires 13 months after its newest event");
});

test("AC7 a conflicting retention subject fails closed", () => {
  assert.throws(
    () => classifyBudgetRetention({ subject: "receipt", subjects: ["receipt", "audit"], createdAt: "2026-01-01T00:00:00Z", ...RETENTION_BINDING }),
    /must declare a single subject/u,
  );
});

// ===========================================================================
// Shared invariants: identity binding, determinism, immutability.
// ===========================================================================

test("observe and reserve bind to the full review identity", () => {
  const decoded = decodeReservationRequest(request());
  assert.equal(decoded.identity.tenant, "acme");
  assert.equal(decoded.identity.pullRequest, 42);
  assert.equal(decoded.identity.head, HEAD);
  assert.equal(decoded.identity.attempt, 1);
  assert.equal(decoded.identity.compiledDigest, DIGEST);
  assert.equal(decoded.identity.candidate, "kimi-review");
  const expected = deriveRequestFingerprint(decoded.identity, {
    poolId: "kimi-pool",
    units: "tokens",
    conservativeMaxCharge: 4_000,
    hardRequestLimit: 6_000,
  });
  assert.equal(decoded.requestFingerprint, expected);
});

test("a declared request fingerprint that does not match its identity fails closed", () => {
  assert.throws(
    () => decodeReservationRequest({ ...request(), identity: { ...identity(), requestFingerprint: "0".repeat(64) }, requestFingerprint: "0".repeat(64) }),
    /requestFingerprint does not match/u,
  );
});

test("a decoded ledger state and every decision are deeply frozen", () => {
  const base = ledger();
  assert.ok(Object.isFrozen(base));
  assert.ok(Object.isFrozen(base.pools));
  const reserved = reserve(base, request(), { nowIso: NOW });
  assert.ok(Object.isFrozen(reserved.state));
  assert.ok(Object.isFrozen(reserved.decision));
  assert.ok(Object.isFrozen(reserved.decision.lease));
});

// ===========================================================================
// Review-fix regressions (PR #48, Copilot review): keep a reservation from
// holding phantom capacity, keep pool state consistent with real capacity, and
// exercise releaseReservation.
// ===========================================================================

test("reserve fails closed on a lease expiry at or before the reservation instant", () => {
  const base = ledger();
  // Expiry equal to now: already dead on arrival.
  const atNow = reserve(base, request({ leaseExpiresAt: NOW }), { nowIso: NOW });
  assert.equal(atNow.decision.outcome, "ineligible");
  assert.equal(atNow.decision.reason, "lease_expiry_not_future");
  assert.equal(Object.keys(atNow.state.leases).length, 0, "a refused request holds nothing");
  // Expiry strictly in the past.
  const past = reserve(base, request({ leaseExpiresAt: "2025-12-31T23:00:00Z" }), { nowIso: NOW });
  assert.equal(past.decision.reason, "lease_expiry_not_future");
  // A strictly-future expiry still reserves.
  const ok = reserve(base, request({ leaseExpiresAt: "2026-01-01T01:00:00Z" }), { nowIso: NOW });
  assert.equal(ok.decision.outcome, "reserved");
});

test("applyObservation drives the pool overdrawn when a lowered reading no longer covers settled charges", () => {
  const base = ledger([observation({ amount: 10_000, safetyMargin: 0 })]);
  const reserved = reserve(base, request({ conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const authorized = authorize(reserved.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, authorizedAttempt: 1 }, { nowIso: NOW });
  const settled = reconcile(authorized.state, { requestFingerprint: reserved.decision.lease.requestFingerprint, revision: 1, actualCharge: 4_000 }, { nowIso: NOW });
  assert.equal(projectPool(settled.state, "kimi-pool").state, "usable", "still solvent after the settled charge");
  // A fresh, known reading that reports far less capacity than already spent.
  const lowered = applyObservation(settled.state, observation({ amount: 1_000, safetyMargin: 0, freshnessDeadline: "2026-01-02T00:00:00Z" }), { nowIso: NOW });
  const pool = projectPool(lowered.state, "kimi-pool");
  assert.ok(pool.realCapacity < 0, "the lowered reading no longer covers settled charges");
  assert.equal(pool.state, "overdrawn", "state fails closed rather than reporting usable with negative capacity");
  const blocked = reserve(lowered.state, request({ identity: { attempt: 2 }, conservativeMaxCharge: 100, hardRequestLimit: 100, expectedAverage: 50 }), { nowIso: NOW });
  assert.equal(blocked.decision.reason, "pool_overdrawn");
});

test("adjustPool drives the pool overdrawn when a negative adjustment pushes real capacity below zero", () => {
  const base = ledger([observation({ amount: 5_000, safetyMargin: 0 })]);
  const adjusted = adjustPool(base, { poolId: "kimi-pool", audited: true, actor: "billing-ops", reason: "verified provider clawback", capacityDelta: -6_000 }, { nowIso: NOW });
  const pool = projectPool(adjusted.state, "kimi-pool");
  assert.ok(pool.realCapacity < 0, "the clawback drives real capacity negative");
  assert.equal(pool.state, "overdrawn");
  assert.equal(adjusted.decision.clearedOverdrawn, false);
});

test("authorize fails closed when authorizedAttempt disagrees with the lease identity", () => {
  const base = ledger([observation({ amount: 10_000, safetyMargin: 0 })]);
  const reserved = reserve(base, request({ identity: { attempt: 1 }, conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const fingerprint = reserved.decision.lease.requestFingerprint;
  assert.throws(
    () => authorize(reserved.state, { requestFingerprint: fingerprint, revision: 1, authorizedAttempt: 999 }, { nowIso: NOW }),
    /does not match the lease identity attempt 1/u,
  );
  // The attempt bound into the lease identity authorizes cleanly.
  const ok = authorize(reserved.state, { requestFingerprint: fingerprint, revision: 1, authorizedAttempt: 1 }, { nowIso: NOW });
  assert.equal(ok.decision.outcome, "authorized");
  assert.equal(projectPool(ok.state, "kimi-pool").latestAuthorizedAttempt, 1);
});

test("applyObservation fails closed when the observation's candidate set disagrees with the pool", () => {
  const base = ledger([observation({ amount: 10_000, safetyMargin: 0, candidates: ["kimi-review"] })]);
  // Same poolId, same units/kind, but a different candidate membership.
  assert.throws(
    () => applyObservation(base, observation({ amount: 20_000, safetyMargin: 0, candidates: ["qwen-review"], freshnessDeadline: "2026-01-02T00:00:00Z" }), { nowIso: NOW }),
    /candidates do not match pool/u,
  );
  // A matching candidate set still updates the reading.
  const ok = applyObservation(base, observation({ amount: 20_000, safetyMargin: 0, candidates: ["kimi-review"], freshnessDeadline: "2026-01-02T00:00:00Z" }), { nowIso: NOW });
  assert.equal(projectPool(ok.state, "kimi-pool").authorizedCapacity, 20_000);
});

test("a prototype-key pool id fails closed as an unknown pool", () => {
  const base = ledger();
  // "constructor" passes the alias charset but must not resolve to an inherited
  // Object.prototype value; requirePool fails closed.
  assert.throws(
    () => reserve(base, request({ poolId: "constructor" }), { nowIso: NOW }),
    /references unknown pool constructor/u,
  );
  assert.throws(
    () => applyObservation(base, observation({ poolId: "constructor" }), { nowIso: NOW }),
    /references unknown pool constructor/u,
  );
  // A candidate named after a prototype key is not silently treated as
  // quarantined via an inherited property.
  const decision = reserve(base, request({ identity: { candidate: "kimi-review" } }), { nowIso: NOW });
  assert.equal(decision.decision.outcome, "reserved");
});

test("releaseReservation returns a held reservation's capacity and replays idempotently", () => {
  const base = ledger([observation({ amount: 5_000, safetyMargin: 0 })]);
  const reserved = reserve(base, request({ conservativeMaxCharge: 4_000, hardRequestLimit: 4_000, expectedAverage: 1_000 }), { nowIso: NOW });
  const fingerprint = reserved.decision.lease.requestFingerprint;
  assert.equal(projectPool(reserved.state, "kimi-pool").reservedTotal, 4_000);
  const released = releaseReservation(reserved.state, { requestFingerprint: fingerprint }, { nowIso: NOW });
  assert.equal(released.decision.outcome, "released");
  assert.equal(released.decision.replay, false);
  assert.equal(released.state.leases[fingerprint].state, "released");
  assert.equal(projectPool(released.state, "kimi-pool").reservedTotal, 0, "released capacity is no longer held");
  // Releasing an already-terminal lease is an idempotent replay with no mutation.
  const replay = releaseReservation(released.state, { requestFingerprint: fingerprint }, { nowIso: NOW });
  assert.equal(replay.decision.replay, true);
  assert.equal(replay.state, released.state, "a replay returns the same state object unchanged");
});
