import assert from "node:assert/strict";
import test from "node:test";
import {
  USAGE_RECONCILIATION_SCHEMA_MAJOR,
  classifyReconciliationRetention,
  createUsageReconciliationLedger,
  decodeAuthorizedReservation,
  decodeReviewerOutcome,
  deriveUsageReconciliationDigest,
  projectReconciledPool,
  reconcileUsage,
  releaseUnusedReserve,
  stableUsageReconciliationJson,
} from "../src/review-usage-reconciliation.js";
import {
  computeRecordLifecycle,
  decodeLegalHold,
  decodePurgeRequest,
  summarizeCoverage,
} from "../src/retention-policy.js";

// The suite drives the usage-reconciliation contract module with inline
// fixtures so every named test maps directly to one of the seven acceptance
// criteria in prd.md. Time is always injected (`nowIso`) so the fake-clock
// lifecycle tests are deterministic. Retention durations are asserted by feeding
// the leaf's `classifyReconciliationRetention` output into
// `retention-policy.js#computeRecordLifecycle`, which keeps this module a pure
// leaf while still proving the standard-v1 math.

const DIGEST = "a".repeat(64);
const HEAD = "b".repeat(40);
const AUTH = "c".repeat(64);
const AUTH_B = "d".repeat(64);
const NOW = "2026-01-01T00:10:00Z";
const RETENTION_BINDING = { retentionPolicyId: "standard-v1", version: "1.0.0", digest: DIGEST };

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

function reservation(overrides = {}) {
  const { identity: identityOverrides, ...rest } = overrides;
  return {
    authorizationFingerprint: AUTH,
    identity: identity(identityOverrides),
    poolId: "kimi-pool",
    units: "tokens",
    reservedAmount: 4_000,
    hardRequestLimit: 6_000,
    hardInputLimit: 5_000,
    hardOutputLimit: 5_000,
    hardCostLimitMicros: 2_000_000,
    leaseExpiresAt: "2026-01-01T01:00:00Z",
    ...rest,
  };
}

function outcome(overrides = {}) {
  const { usage: usageOverrides, cost: costOverrides, ...rest } = overrides;
  const usage = { confidence: "known", amount: 3_000, inputUnits: 2_000, outputUnits: 1_000, ...usageOverrides };
  if (usage.confidence === "unknown") {
    delete usage.amount;
    delete usage.inputUnits;
    delete usage.outputUnits;
  }
  const cost = { confidence: "known", amountMicros: 1_000_000, ...costOverrides };
  if (cost.confidence === "unknown") {
    delete cost.amountMicros;
  }
  return {
    assurance: "completed",
    usage,
    cost,
    providerRef: "usage:acme-run-1",
    sideEffects: "review_published",
    ...rest,
  };
}

function input(overrides = {}) {
  const { reservation: reservationOverrides, outcome: outcomeOverrides, ...rest } = overrides;
  return {
    schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
    reservation: reservation(reservationOverrides),
    outcome: outcome(outcomeOverrides),
    revision: 1,
    ...rest,
  };
}

function ledger(pools = [{ poolId: "kimi-pool", units: "tokens", usableCapacity: 10_000 }]) {
  return createUsageReconciliationLedger({ schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR, pools });
}

// ===========================================================================
// AC1: Fixtures cover exact use, partial use/release, overrun, zero use,
// unknown usage, delayed reconciliation, duplicate input, and conflicting
// input.
// ===========================================================================

test("AC1 exact use debits the full reserve and releases nothing", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 4_000 } } }), { nowIso: NOW });
  assert.equal(result.decision.outcome, "reconciled");
  assert.equal(result.decision.budgetClass, "within_reserve");
  assert.equal(result.decision.debit, 4_000);
  assert.equal(result.decision.releasedAmount, 0);
  assert.equal(result.decision.remaining, 6_000);
});

test("AC1 partial use releases only the reserve proven unused", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 3_000 } } }), { nowIso: NOW });
  assert.equal(result.decision.debit, 3_000);
  assert.equal(result.decision.releasedAmount, 1_000);
  assert.equal(result.decision.overrunAmount, 0);
  assert.equal(result.decision.budgetClass, "within_reserve");
});

test("AC1 an overrun debits above the reserve within the hard limit", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 5_000 } } }), { nowIso: NOW });
  assert.equal(result.decision.budgetClass, "budget_overrun");
  assert.equal(result.decision.debit, 5_000);
  assert.equal(result.decision.overrunAmount, 1_000);
  assert.equal(result.decision.releasedAmount, 0);
});

test("AC1 zero use releases the whole reserve and stays within_reserve", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 0 } } }), { nowIso: NOW });
  assert.equal(result.decision.debit, 0);
  assert.equal(result.decision.releasedAmount, 4_000);
  assert.equal(result.decision.budgetClass, "within_reserve");
});

test("AC1 unknown usage stays an explicit unresolved reconciliation", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { confidence: "unknown" } } }), { nowIso: NOW });
  assert.equal(result.decision.outcome, "unresolved");
  assert.equal(result.decision.usageConfidence, "unknown");
  assert.equal(result.decision.debit, 0);
  assert.equal(result.decision.heldAmount, 4_000);
  // The unknown reserve is held, not released: future eligibility cannot treat
  // it as available.
  assert.equal(result.decision.remaining, 6_000);
});

test("AC1 delayed reconciliation resolves an unknown with later evidence", () => {
  const first = reconcileUsage(ledger(), input({ outcome: { usage: { confidence: "unknown" } } }), { nowIso: NOW });
  assert.equal(first.decision.outcome, "unresolved");
  const second = reconcileUsage(
    first.state,
    input({ revision: 2, outcome: { usage: { amount: 3_000 } } }),
    { nowIso: "2026-01-02T00:00:00Z" },
  );
  assert.equal(second.decision.outcome, "reconciled");
  assert.equal(second.decision.debit, 3_000);
  assert.equal(projectReconciledPool(second.state, "kimi-pool").heldTotal, 0);
});

test("AC1 a duplicate callback is an idempotent replay against the same state", () => {
  const base = ledger();
  const first = reconcileUsage(base, input(), { nowIso: NOW });
  const second = reconcileUsage(first.state, input(), { nowIso: NOW });
  assert.equal(second.decision.replay, true);
  assert.equal(second.state, first.state);
  assert.equal(projectReconciledPool(second.state, "kimi-pool").debitedTotal, 3_000);
});

test("AC1 a conflicting later fact on a settled reconciliation fails visibly", () => {
  const first = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 3_000 } } }), { nowIso: NOW });
  const conflict = reconcileUsage(
    first.state,
    input({ revision: 2, outcome: { usage: { amount: 5_000 } } }),
    { nowIso: NOW },
  );
  assert.equal(conflict.decision.outcome, "rejected");
  assert.equal(conflict.decision.reason, "conflicting_facts");
  assert.equal(conflict.state, first.state);
  assert.equal(projectReconciledPool(conflict.state, "kimi-pool").debitedTotal, 3_000);
});

// ===========================================================================
// AC2: Soft-overrun fixtures preserve an otherwise valid review outcome; hard-
// limit fixtures produce a policy violation and candidate quarantine.
// ===========================================================================

test("AC2 a soft overrun preserves a completed review outcome", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 5_500 } } }), { nowIso: NOW });
  assert.equal(result.decision.budgetClass, "budget_overrun");
  assert.equal(result.decision.assuranceHonored, true);
  assert.equal(result.decision.quarantineRequired, false);
  assert.equal(result.decision.quarantine, undefined);
});

test("AC2 a hard usage breach is a policy violation with candidate quarantine", () => {
  const result = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 7_000 } } }), { nowIso: NOW });
  assert.equal(result.decision.budgetClass, "policy_violation");
  assert.equal(result.decision.assuranceHonored, false);
  assert.equal(result.decision.quarantineRequired, true);
  assert.equal(result.decision.quarantine.candidate, "kimi-review");
  assert.equal(result.decision.quarantine.state, "quarantined");
  // The full actual usage is still debited even on a policy violation.
  assert.equal(result.decision.debit, 7_000);
});

test("AC2 a hard cost breach is a policy violation while usage stays within reserve", () => {
  const result = reconcileUsage(
    ledger(),
    input({ outcome: { usage: { amount: 3_000 }, cost: { amountMicros: 3_000_000 } } }),
    { nowIso: NOW },
  );
  assert.equal(result.decision.budgetClass, "policy_violation");
  assert.equal(result.decision.quarantineRequired, true);
  assert.equal(result.decision.debit, 3_000);
});

test("AC2 a hard input breach is a policy violation", () => {
  const result = reconcileUsage(
    ledger(),
    input({ outcome: { usage: { amount: 3_000, inputUnits: 6_000 } } }),
    { nowIso: NOW },
  );
  assert.equal(result.decision.budgetClass, "policy_violation");
  assert.equal(result.decision.assuranceHonored, false);
});

// ===========================================================================
// AC3: Full actual usage is debited, negative capacity is represented as
// overdrawn, and future eligibility cannot treat it as available.
// ===========================================================================

test("AC3 a full debit above capacity marks the pool overdrawn, never clamped", () => {
  const small = ledger([{ poolId: "kimi-pool", units: "tokens", usableCapacity: 5_000 }]);
  const result = reconcileUsage(small, input({ outcome: { usage: { amount: 7_000 } } }), { nowIso: NOW });
  // Debit is the full authoritative usage, not clamped to capacity or reserve.
  assert.equal(result.decision.debit, 7_000);
  assert.equal(result.decision.remaining, -2_000);
  assert.equal(result.decision.overdrawn, true);
  assert.equal(result.decision.poolState, "overdrawn");
});

test("AC3 a soft overrun still debits the full amount and can overdraw", () => {
  const small = ledger([{ poolId: "kimi-pool", units: "tokens", usableCapacity: 4_500 }]);
  const result = reconcileUsage(small, input({ outcome: { usage: { amount: 5_000 } } }), { nowIso: NOW });
  assert.equal(result.decision.budgetClass, "budget_overrun");
  assert.equal(result.decision.debit, 5_000);
  assert.equal(result.decision.overdrawn, true);
});

test("AC3 an overdrawn pool projection never reports available capacity", () => {
  const small = ledger([{ poolId: "kimi-pool", units: "tokens", usableCapacity: 5_000 }]);
  const result = reconcileUsage(small, input({ outcome: { usage: { amount: 7_000 } } }), { nowIso: NOW });
  const projection = projectReconciledPool(result.state, "kimi-pool");
  assert.equal(projection.state, "overdrawn");
  assert.equal(projection.overdrawn, true);
  assert.equal(projection.remaining, -2_000);
});

// ===========================================================================
// AC4: Reconciliation is monotonic and cannot spend or release another
// attempt's reservation.
// ===========================================================================

test("AC4 a stale revision cannot rewrite a settled reconciliation", () => {
  const first = reconcileUsage(ledger(), input({ revision: 2, outcome: { usage: { amount: 3_000 } } }), { nowIso: NOW });
  const stale = reconcileUsage(first.state, input({ revision: 1, outcome: { usage: { amount: 5_000 } } }), { nowIso: NOW });
  assert.equal(stale.decision.outcome, "rejected");
  assert.equal(stale.decision.reason, "stale_revision");
  assert.equal(stale.state, first.state);
});

test("AC4 a fingerprint reused across a different attempt cannot spend this reservation", () => {
  const base = ledger();
  const first = reconcileUsage(base, input({ outcome: { usage: { amount: 3_000 } } }), { nowIso: NOW });
  // Same authorization fingerprint but a distinct attempt identity: a collision
  // that must fail closed rather than overwrite the settled debit.
  const collision = reconcileUsage(
    first.state,
    input({ revision: 2, reservation: { identity: { attempt: 2 } }, outcome: { usage: { amount: 9_000 } } }),
    { nowIso: NOW },
  );
  assert.equal(collision.decision.outcome, "rejected");
  assert.equal(collision.decision.reason, "conflicting_facts");
  assert.equal(collision.state, first.state);
  assert.equal(projectReconciledPool(collision.state, "kimi-pool").debitedTotal, 3_000);
});

test("AC4 same fingerprint replayed with divergent hard economics is a collision, even advancing an unresolved record", () => {
  // Regression (Copilot review): an unresolved unknown holds its reserve at
  // rev1. A second callback reuses the SAME fingerprint and identity but a
  // DIFFERENT hardInputLimit at a higher revision. Because the binding now
  // covers every committed economics field (not just reservedAmount /
  // hardRequestLimit), the divergence is caught as a collision instead of
  // silently advancing the unresolved record with different limits — the one
  // path terminal-immutability alone does not guard.
  const base = ledger();
  const unresolved = reconcileUsage(base, input({ outcome: { usage: { confidence: "unknown" } } }), { nowIso: NOW });
  assert.equal(unresolved.decision.outcome, "unresolved");
  const collision = reconcileUsage(
    unresolved.state,
    input({
      revision: 2,
      reservation: { hardInputLimit: 5_500 },
      outcome: { usage: { amount: 3_000 } },
    }),
    { nowIso: NOW },
  );
  assert.equal(collision.decision.outcome, "rejected");
  assert.equal(collision.decision.reason, "conflicting_facts");
  assert.equal(collision.state, unresolved.state);
  // The unresolved reserve is still held; nothing was debited under the
  // mismatched economics.
  assert.equal(projectReconciledPool(collision.state, "kimi-pool").debitedTotal, 0);
});

test("AC4 distinct attempts on a shared pool are accounted independently", () => {
  const shared = ledger([{ poolId: "shared", units: "tokens", usableCapacity: 20_000 }]);
  const a = reconcileUsage(
    shared,
    input({ reservation: { authorizationFingerprint: AUTH, poolId: "shared" }, outcome: { usage: { amount: 3_000 } } }),
    { nowIso: NOW },
  );
  const b = reconcileUsage(
    a.state,
    input({
      reservation: { authorizationFingerprint: AUTH_B, poolId: "shared", identity: { attempt: 2, candidate: "qwen-review" } },
      outcome: { usage: { amount: 4_000 } },
    }),
    { nowIso: NOW },
  );
  assert.equal(b.decision.outcome, "reconciled");
  assert.equal(projectReconciledPool(b.state, "shared").debitedTotal, 7_000);
});

test("AC4 releaseUnusedReserve cannot release a different attempt's reservation", () => {
  const first = reconcileUsage(ledger(), input({ outcome: { usage: { amount: 3_000 } } }), { nowIso: NOW });
  const release = releaseUnusedReserve(
    first.state,
    {
      schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
      reservation: reservation({ identity: { attempt: 2 } }),
      revision: 2,
      proof: { dispatched: false, sideEffects: "none" },
    },
    { nowIso: NOW },
  );
  assert.equal(release.decision.outcome, "rejected");
  assert.equal(release.decision.reason, "conflicting_facts");
  assert.equal(projectReconciledPool(release.state, "kimi-pool").debitedTotal, 3_000);
});

test("AC4 releaseUnusedReserve releases the whole reserve when proven unused", () => {
  const release = releaseUnusedReserve(
    ledger(),
    {
      schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
      reservation: reservation(),
      revision: 1,
      proof: { dispatched: false, sideEffects: "none" },
    },
    { nowIso: NOW },
  );
  assert.equal(release.decision.outcome, "reconciled");
  assert.equal(release.decision.debit, 0);
  assert.equal(release.decision.releasedAmount, 4_000);
});

test("AC4 releaseUnusedReserve refuses an ambiguous reviewer side effect", () => {
  assert.throws(
    () => releaseUnusedReserve(
      ledger(),
      {
        schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
        reservation: reservation(),
        revision: 1,
        proof: { dispatched: false, sideEffects: "ambiguous" },
      },
      { nowIso: NOW },
    ),
    /no reviewer side effect/u,
  );
});

// ===========================================================================
// AC5: Unknown usage never becomes a fabricated zero-cost success.
// ===========================================================================

test("AC5 an unknown usage is never a fabricated zero-cost success", () => {
  const result = reconcileUsage(
    ledger(),
    input({ outcome: { assurance: "ambiguous", usage: { confidence: "unknown" }, cost: { confidence: "unknown" }, sideEffects: "ambiguous" } }),
    { nowIso: NOW },
  );
  assert.notEqual(result.decision.outcome, "reconciled");
  assert.equal(result.decision.usageConfidence, "unknown");
  assert.equal(result.decision.assuranceHonored, false);
  assert.equal(result.decision.releasedAmount, 0);
  assert.equal(result.decision.debit, 0);
});

test("AC5 a known usage with an unknown cost preserves the explicit unknown", () => {
  const result = reconcileUsage(
    ledger(),
    input({ outcome: { usage: { amount: 3_000 }, cost: { confidence: "unknown" } } }),
    { nowIso: NOW },
  );
  assert.equal(result.decision.outcome, "reconciled");
  assert.equal(result.decision.costConfidence, "unknown");
  assert.equal(result.decision.budgetClass, "within_reserve");
});

test("AC5 an unknown usage reading may not carry a fabricated amount", () => {
  const malformed = {
    schemaMajor: USAGE_RECONCILIATION_SCHEMA_MAJOR,
    reservation: reservation(),
    outcome: {
      assurance: "ambiguous",
      usage: { confidence: "unknown", amount: 0 },
      cost: { confidence: "unknown" },
      sideEffects: "ambiguous",
    },
    revision: 1,
  };
  assert.throws(
    () => reconcileUsage(ledger(), malformed, { nowIso: NOW }),
    /must be absent when usage confidence is unknown/u,
  );
});

// ===========================================================================
// AC6: Output remains bounded and credential-free.
// ===========================================================================

test("AC6 a raw billing payload or credential is rejected at the boundary", () => {
  assert.throws(
    () => reconcileUsage(ledger(), { ...input(), providerPayload: { secret: "x" } }, { nowIso: NOW }),
    /forbidden by the usage-reconciliation privacy boundary/u,
  );
  assert.throws(
    () => decodeReviewerOutcome({ ...outcome(), credential: "tok" }),
    /forbidden by the usage-reconciliation privacy boundary/u,
  );
});

test("AC6 the decision and pool projection carry no credential or billing field", () => {
  const result = reconcileUsage(ledger(), input(), { nowIso: NOW });
  for (const surface of [result.decision, projectReconciledPool(result.state, "kimi-pool")]) {
    const encoded = stableUsageReconciliationJson(surface).toLowerCase();
    for (const forbidden of ["credential", "secret", "apikey", "billingpayload", "prompt", "finding", "transcript"]) {
      assert.ok(!encoded.includes(forbidden), `${forbidden} must not appear in a bounded surface`);
    }
  }
});

test("AC6 a decoded reservation and outcome only carry bounded aliases and integers", () => {
  const decodedReservation = decodeAuthorizedReservation(reservation());
  assert.equal(decodedReservation.authorizationFingerprint, AUTH);
  assert.equal(decodedReservation.reservedAmount, 4_000);
  const decodedOutcome = decodeReviewerOutcome(outcome());
  assert.equal(decodedOutcome.providerRef, "usage:acme-run-1");
  assert.equal(decodedOutcome.usage.amount, 3_000);
});

// ===========================================================================
// AC7: Fake-clock fixtures cover operational compaction, unresolved expiry,
// 13-month receipt deletion, legal hold, purge, and coverage.
// ===========================================================================

test("AC7 terminal reconciliation detail is retained for 90 days then compacts", () => {
  const record = classifyReconciliationRetention({
    subject: "reconciliation",
    createdAt: "2026-01-01T00:00:00Z",
    terminalAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "operational_state");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-03-31T00:00:00Z" }).lifecycleState, "terminal");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-04-02T00:00:00Z" }).lifecycleState, "compacted");
});

test("AC7 an unresolved reconciliation is forced to expired_unknown after 180 days", () => {
  const record = classifyReconciliationRetention({
    subject: "reconciliation",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2026-07-05T00:00:00Z" });
  assert.equal(lifecycle.terminalState, "expired_unknown");
});

test("AC7 a raw usage/cost observation is retained for 90 days", () => {
  const record = classifyReconciliationRetention({
    subject: "usage_observation",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "budget_observation");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-03-31T00:00:00Z" }).lifecycleState, "active");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-04-02T00:00:00Z" }).lifecycleState, "deleted");
});

test("AC7 a bounded receipt is retained for 13 calendar months", () => {
  const record = classifyReconciliationRetention({
    subject: "receipt",
    createdAt: "2026-01-31T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "bounded_event");
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" });
  assert.equal(lifecycle.lifecycleState, "active");
  assert.equal(lifecycle.retainedUntil, "2027-02-28T00:00:00.000Z");
});

test("AC7 an audit chain is retained for 13 months relative to its newest event", () => {
  const record = classifyReconciliationRetention({
    subject: "audit",
    createdAt: "2026-01-01T00:00:00Z",
    newestEventAt: "2026-02-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "adjudication_chain");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2027-03-02T00:00:00Z" }).lifecycleState, "deleted");
});

test("AC7 a legal hold pauses a covered reconciliation deletion timer", () => {
  const record = classifyReconciliationRetention({
    subject: "reconciliation",
    createdAt: "2026-01-01T00:00:00Z",
    terminalAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  const hold = decodeLegalHold({
    schemaVersion: 2,
    holdId: DIGEST,
    tenant: "acme",
    repository: { owner: "acme", name: "widgets" },
    dataClasses: ["operational_state"],
    actor: "legal",
    reason: "litigation hold",
    authorization: "legal-order-1",
    state: "active",
    startAt: "2026-02-01T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
  });
  const held = computeRecordLifecycle(record, { nowIso: "2026-05-01T00:00:00Z", hold });
  assert.equal(held.holdPaused, true);
  assert.equal(held.nextDeletionAt, null);
});

test("AC7 a purge request yields a bounded pending deletion receipt", () => {
  const purge = decodePurgeRequest({
    schemaVersion: 2,
    authorization: { tenant: "acme", repository: { owner: "acme", name: "widgets" } },
    actor: "operator",
    reason: "authorized data purge",
    requestId: DIGEST,
    confirmed: true,
    requestedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(purge.deletionStatus, "purge_pending");
  assert.equal(purge.grantsLedgerAuthority, false);
});

test("AC7 reconciliation coverage stays partitioned and marks expired evidence", () => {
  const coverage = summarizeCoverage({ eligible: 10, retained: 7, expired: 2, purged: 1, unknown: 0 });
  assert.equal(coverage.complete, false);
  assert.equal(coverage.retained, 7);
});

// ===========================================================================
// Shared invariants: identity binding, determinism, immutability.
// ===========================================================================

test("a reconciliation binds to the full review identity and economics", () => {
  const decoded = decodeAuthorizedReservation(reservation());
  assert.equal(decoded.identity.attempt, 1);
  assert.equal(decoded.identity.candidate, "kimi-review");
  const digestA = deriveUsageReconciliationDigest({ identity: decoded.identity, amount: 1 });
  const digestB = deriveUsageReconciliationDigest({ amount: 1, identity: decoded.identity });
  assert.equal(digestA, digestB, "reordered-equivalent input yields the same digest");
});

test("a decoded state and every decision are deeply frozen", () => {
  const base = ledger();
  assert.ok(Object.isFrozen(base));
  assert.ok(Object.isFrozen(base.pools));
  const result = reconcileUsage(base, input(), { nowIso: NOW });
  assert.ok(Object.isFrozen(result.state));
  assert.ok(Object.isFrozen(result.decision));
});

test("a reservation whose reserve exceeds its own hard limit fails closed", () => {
  assert.throws(
    () => decodeAuthorizedReservation(reservation({ reservedAmount: 7_000, hardRequestLimit: 6_000 })),
    /reservedAmount must not exceed hardRequestLimit/u,
  );
});
