import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFERRED_RECOVERY_SCHEMA_MAJOR,
  applyRepositoryLifecycle,
  classifyDeferredRetention,
  closeDeferredPullRequest,
  createDeferredRecoveryLedger,
  deferReview,
  deriveDeferredRecoveryDigest,
  projectDeferredRecord,
  projectHeadCheck,
  projectRecoveryCheck,
  recoverDeferredReview,
  stableDeferredRecoveryJson,
  supersedeDeferredRecord,
} from "../src/review-deferred-recovery.js";
import {
  DEFERRED_EXPIRED_STATE,
  computeRecordLifecycle,
  decodeLegalHold,
  decodePurgeRequest,
  summarizeCoverage,
} from "../src/retention-policy.js";

// The suite drives the deferred-recovery contract module with inline fixtures so
// every named test maps directly to one of the six acceptance-criteria groups in
// prd.md. Time is always injected (`nowIso`) so the fake-clock lifecycle tests
// are deterministic. Retention durations are asserted by feeding the leaf's
// `classifyDeferredRetention` output into `retention-policy.js#computeRecordLifecycle`,
// which keeps this module a pure leaf while still proving the standard-v1 math.

const DIGEST = "c".repeat(64);
const HEAD = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const AUTH = "d".repeat(64);
const NOW = "2026-01-01T00:10:00Z";
const RETENTION_BINDING = { retentionPolicyId: "standard-v1", version: "1.0.0", digest: DIGEST };

function identity(overrides = {}) {
  const { repository: repoOverrides, ...rest } = overrides;
  return {
    tenant: "acme",
    repository: { owner: "acme", name: "widgets", ...repoOverrides },
    pullRequest: 42,
    head: HEAD,
    attempt: 1,
    compiledDigest: DIGEST,
    candidate: "kimi-review",
    ...rest,
  };
}

function deferralInput(overrides = {}) {
  const { identity: identityOverrides, references: referenceOverrides, ...rest } = overrides;
  return {
    schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
    identity: identity(identityOverrides),
    poolId: "kimi-pool",
    gatePolicy: "block",
    priorDispatch: "clean",
    references: { authorizationFingerprint: AUTH, deferralRef: "defer:acme-1", ...referenceOverrides },
    revision: 1,
    ...rest,
  };
}

function recoveryInput(deferralFingerprint, overrides = {}) {
  const { authorization: authOverrides, recovery: recoveryOverrides, references: referenceOverrides, ...rest } = overrides;
  return {
    schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
    deferralFingerprint,
    authorization: {
      tenant: "acme",
      repositoryAccess: true,
      openPullRequest: true,
      exactHead: HEAD,
      currentPolicyValid: true,
      budgetAvailable: true,
      duplicateEvidence: "none",
      priorDispatch: "clean",
      ...authOverrides,
    },
    recovery: identity({ attempt: 2, ...recoveryOverrides }),
    references: { authorizationFingerprint: AUTH, recoveryRef: "recover:acme-1", ...referenceOverrides },
    revision: 1,
    ...rest,
  };
}

function supersedeInput(deferralFingerprint, overrides = {}) {
  const { successor: successorOverrides, references: referenceOverrides, ...rest } = overrides;
  return {
    schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
    deferralFingerprint,
    successor: identity({ head: HEAD_B, attempt: 2, ...successorOverrides }),
    gatePolicy: "block",
    references: { authorizationFingerprint: AUTH, supersedeRef: "supersede:acme-1", ...referenceOverrides },
    revision: 1,
    ...rest,
  };
}

function ledger() {
  return createDeferredRecoveryLedger();
}

// Defer once and return the ledger state plus the deferral's fingerprints.
function deferOnce(overrides = {}) {
  const result = deferReview(ledger(), deferralInput(overrides), { nowIso: NOW });
  return { result, state: result.state, deferralFingerprint: result.decision.deferralFingerprint, headKey: result.decision.headKey };
}

// ===========================================================================
// AC1: Tests cover unchanged/changed head, closed PR, duplicate retry,
// unavailable budget, ambiguous prior dispatch, supersession, expiry, deletion.
// ===========================================================================

test("AC1 unchanged-head recovery creates a distinct linked recovery attempt", () => {
  const { state, deferralFingerprint } = deferOnce();
  const recovered = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: "2026-01-02T00:00:00Z" });
  assert.equal(recovered.decision.outcome, "recovered");
  assert.equal(recovered.decision.recoveryAttempt, 2);
  assert.equal(recovered.decision.recordState, "recovered");
  assert.equal(projectDeferredRecord(recovered.state, deferralFingerprint).state, "recovered");
});

test("AC1 changed-head recovery is refused; it must supersede instead of replay", () => {
  const { state, deferralFingerprint } = deferOnce();
  const rejected = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { exactHead: HEAD_B }, recovery: { head: HEAD_B } }),
    { nowIso: NOW },
  );
  assert.equal(rejected.decision.outcome, "rejected");
  assert.equal(rejected.decision.reason, "changed_head");
  assert.equal(rejected.state, state);
});

test("AC1 a closed pull request blocks recovery and resolves the record", () => {
  const { state, deferralFingerprint } = deferOnce();
  const blocked = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { openPullRequest: false } }),
    { nowIso: NOW },
  );
  assert.equal(blocked.decision.reason, "pull_request_closed");
  const closed = closeDeferredPullRequest(
    state,
    { schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR, deferralFingerprint, tenant: "acme" },
    { nowIso: NOW },
  );
  assert.equal(closed.decision.outcome, "pr_closed");
  // A closed PR can never be recovered afterward.
  const afterClose = recoverDeferredReview(closed.state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  assert.equal(afterClose.decision.reason, "not_actionable");
});

test("AC1 a duplicate retry fails closed", () => {
  const { state, deferralFingerprint } = deferOnce();
  const rejected = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { duplicateEvidence: "duplicate_review" } }),
    { nowIso: NOW },
  );
  assert.equal(rejected.decision.reason, "duplicate");
  assert.equal(rejected.state, state);
});

test("AC1 an unavailable budget fails closed", () => {
  const { state, deferralFingerprint } = deferOnce();
  const rejected = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { budgetAvailable: false } }),
    { nowIso: NOW },
  );
  assert.equal(rejected.decision.reason, "budget_unavailable");
});

test("AC1 an ambiguous prior dispatch is never replayed", () => {
  const fromRecord = deferOnce({ priorDispatch: "ambiguous" });
  const rejectedRecord = recoverDeferredReview(fromRecord.state, recoveryInput(fromRecord.deferralFingerprint), { nowIso: NOW });
  assert.equal(rejectedRecord.decision.reason, "ambiguous_prior_dispatch");

  const clean = deferOnce();
  const rejectedAuth = recoverDeferredReview(
    clean.state,
    recoveryInput(clean.deferralFingerprint, { authorization: { priorDispatch: "ambiguous" } }),
    { nowIso: NOW },
  );
  assert.equal(rejectedAuth.decision.reason, "ambiguous_prior_dispatch");
});

test("AC1 a changed head supersedes the prior record and never replays it", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  const superseded = supersedeDeferredRecord(state, supersedeInput(deferralFingerprint), { nowIso: NOW });
  assert.equal(superseded.decision.outcome, "superseded");
  assert.notEqual(superseded.decision.successorHeadKey, headKey);
  assert.equal(projectDeferredRecord(superseded.state, deferralFingerprint).state, "superseded");
  // The prior head projection is frozen as evidence, not replayed.
  assert.equal(projectHeadCheck(superseded.state, headKey).status, "superseded");
});

test("AC1 an actionable deferred record expires to expired_unreviewed at the 180-day boundary", () => {
  const record = classifyDeferredRetention({
    subject: "deferred_record",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "deferred_review");
  // Just before the boundary the record is still actionable (no terminal state).
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-06-29T23:59:59Z" }).terminalState, undefined);
  const expired = computeRecordLifecycle(record, { nowIso: "2026-06-30T00:00:00Z" });
  assert.equal(expired.terminalState, DEFERRED_EXPIRED_STATE);
});

test("AC1 an authorized purge stops recovery and marks records for deletion under retention", () => {
  const { state, deferralFingerprint } = deferOnce();
  const purged = applyRepositoryLifecycle(
    state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      kind: "authorized_purge",
      tenant: "acme",
      repository: { owner: "acme", name: "widgets" },
      purgeRequestId: DIGEST,
    },
    { nowIso: NOW },
  );
  assert.equal(purged.decision.outcome, "lifecycle_applied");
  assert.equal(purged.decision.affected, 1);
  assert.equal(purged.decision.deletionRequested, true);
  assert.equal(purged.decision.reassignsSilently, false);
  assert.equal(projectDeferredRecord(purged.state, deferralFingerprint).deletionRequested, true);
  // Recovery is no longer eligible after the purge stops collection.
  const afterPurge = recoverDeferredReview(purged.state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  assert.equal(afterPurge.decision.reason, "recovery_disabled");
  // The shared retention purge receipt stays bounded and grants no authority.
  const receipt = decodePurgeRequest({
    schemaVersion: 2,
    authorization: { tenant: "acme", repository: { owner: "acme", name: "widgets" } },
    actor: "operator",
    reason: "authorized data purge",
    requestId: DIGEST,
    confirmed: true,
    requestedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(receipt.grantsRecoveryAuthority, false);
});

// ===========================================================================
// AC2: Recovery is explicit and idempotent; no automatic review occurs.
// ===========================================================================

test("AC2 a deferral alone performs no automatic review", () => {
  const { headKey } = deferOnce();
  const check = projectHeadCheck(deferOnce().state, headKey);
  // The head Check stays a distinguishable deferral: nothing was reviewed.
  assert.equal(check.assurance, "deferred");
  assert.equal(check.assuranceKind, "deferred");
});

test("AC2 recovery is idempotent: a replay reproduces the decision and the same state", () => {
  const { state, deferralFingerprint } = deferOnce();
  const first = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: "2026-01-02T00:00:00Z" });
  const second = recoverDeferredReview(first.state, recoveryInput(deferralFingerprint), { nowIso: "2026-01-03T00:00:00Z" });
  assert.equal(second.decision.replay, true);
  assert.equal(second.state, first.state);
});

test("AC2 recovery is explicit: an unknown deferral is rejected, never auto-created", () => {
  const missing = recoverDeferredReview(ledger(), recoveryInput(DIGEST), { nowIso: NOW });
  assert.equal(missing.decision.reason, "unknown_deferral");
});

// ===========================================================================
// AC3: Deferred assurance stays distinguishable from completed assurance under
// both a passing and a blocking merge policy.
// ===========================================================================

test("AC3 a deferred assurance blocks the gate under a block merge policy", () => {
  const check = projectHeadCheck(deferOnce({ gatePolicy: "block" }).state, deferOnce({ gatePolicy: "block" }).headKey);
  assert.equal(check.assuranceKind, "deferred");
  assert.equal(check.gate, "blocked");
});

test("AC3 a deferred assurance passes the gate under an allow merge policy but stays deferred", () => {
  const deferred = deferOnce({ gatePolicy: "allow" });
  const check = projectHeadCheck(deferred.state, deferred.headKey);
  assert.equal(check.gate, "passed");
  // A passing gate does NOT turn a deferral into a completed review.
  assert.equal(check.assuranceKind, "deferred");
});

test("AC3 a completed review is a distinguishable completed assurance regardless of merge policy", () => {
  for (const gatePolicy of ["block", "allow"]) {
    const { state, deferralFingerprint, headKey } = deferOnce({ gatePolicy });
    const recovered = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: "2026-01-02T00:00:00Z" });
    const completed = projectRecoveryCheck(
      recovered.state,
      {
        schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
        headKey,
        attempt: 2,
        attemptFingerprint: recovered.decision.recoveryAttemptFingerprint,
        expectedRevision: projectHeadCheck(recovered.state, headKey).revision,
        assurance: "completed",
        resultRef: "check:acme-run-2",
      },
      { nowIso: "2026-01-02T01:00:00Z" },
    );
    assert.equal(completed.decision.outcome, "projected");
    assert.equal(completed.decision.assuranceKind, "completed");
    // A completed review always passes the gate; it is distinguishable from a
    // deferral even where the deferral would have blocked.
    assert.equal(completed.decision.gate, "passed");
    assert.equal(projectHeadCheck(completed.state, headKey).assuranceKind, "completed");
  }
});

// ===========================================================================
// AC4: Same-head recovery updates only the latest authorized Check projection;
// changed-head recovery creates new Checks; late older results overwrite neither.
// ===========================================================================

test("AC4 same-head recovery advances the latest authorized attempt via compare-and-swap", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  const beforeAttempt = projectHeadCheck(state, headKey).latestAuthorizedAttempt.attempt;
  assert.equal(beforeAttempt, 1);
  const recovered = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  const projection = projectHeadCheck(recovered.state, headKey);
  assert.equal(projection.latestAuthorizedAttempt.attempt, 2);
  assert.equal(projection.revision, 2);
});

test("AC4 a stale expectedRevision fails the compare-and-swap", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  const recovered = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  const stale = projectRecoveryCheck(
    recovered.state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      headKey,
      attempt: 2,
      attemptFingerprint: recovered.decision.recoveryAttemptFingerprint,
      expectedRevision: 1,
      assurance: "completed",
    },
    { nowIso: NOW },
  );
  assert.equal(stale.decision.outcome, "rejected");
  assert.equal(stale.decision.reason, "stale_revision");
  assert.equal(stale.state, recovered.state);
});

test("AC4 a late result from an older attempt is retained as audit but never overwrites the projection", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  const olderAttemptFingerprint = projectHeadCheck(state, headKey).latestAuthorizedAttempt.attemptFingerprint;
  const recovered = recoverDeferredReview(state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  // Advance the recovered (latest) attempt to a completed review.
  const completed = projectRecoveryCheck(
    recovered.state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      headKey,
      attempt: 2,
      attemptFingerprint: recovered.decision.recoveryAttemptFingerprint,
      expectedRevision: 2,
      assurance: "completed",
    },
    { nowIso: NOW },
  );
  assert.equal(projectHeadCheck(completed.state, headKey).assuranceKind, "completed");
  // A late result from the original deferred attempt cannot rewrite the projection.
  const late = projectRecoveryCheck(
    completed.state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      headKey,
      attempt: 1,
      attemptFingerprint: olderAttemptFingerprint,
      expectedRevision: 3,
      assurance: "incomplete",
    },
    { nowIso: NOW },
  );
  assert.equal(late.decision.outcome, "retained_late");
  assert.equal(late.decision.projectionUpdated, false);
  assert.equal(late.decision.currentAssuranceKind, "completed");
  assert.equal(projectHeadCheck(late.state, headKey).assuranceKind, "completed");
});

test("AC4 changed-head supersession creates a NEW projection and freezes the old one", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  const superseded = supersedeDeferredRecord(state, supersedeInput(deferralFingerprint), { nowIso: NOW });
  const newHeadKey = superseded.decision.successorHeadKey;
  assert.notEqual(newHeadKey, headKey);
  const newProjection = projectHeadCheck(superseded.state, newHeadKey);
  assert.equal(newProjection.status, "open");
  assert.equal(newProjection.head, HEAD_B);
  assert.equal(newProjection.revision, 1);
  // A late result targeting the frozen old-head projection is retained, not applied.
  const oldAttemptFingerprint = projectHeadCheck(state, headKey).latestAuthorizedAttempt.attemptFingerprint;
  const late = projectRecoveryCheck(
    superseded.state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      headKey,
      attempt: 1,
      attemptFingerprint: oldAttemptFingerprint,
      expectedRevision: 1,
      assurance: "completed",
    },
    { nowIso: NOW },
  );
  assert.equal(late.decision.outcome, "retained_late");
  assert.equal(late.decision.note, "superseded_projection");
});

// ===========================================================================
// AC5: Cross-tenant and stale authorization attempts fail closed.
// ===========================================================================

test("AC5 a cross-tenant recovery authorization fails closed", () => {
  const { state, deferralFingerprint } = deferOnce();
  const crossAuth = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { tenant: "intruder" } }),
    { nowIso: NOW },
  );
  assert.equal(crossAuth.decision.reason, "cross_tenant");
  const crossIdentity = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { recovery: { tenant: "intruder" } }),
    { nowIso: NOW },
  );
  assert.equal(crossIdentity.decision.reason, "cross_tenant");
  assert.equal(crossIdentity.state, state);
});

test("AC5 a stale recovery attempt (not newer than the deferral) fails closed", () => {
  const { state, deferralFingerprint } = deferOnce();
  const stale = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { recovery: { attempt: 1 } }),
    { nowIso: NOW },
  );
  assert.equal(stale.decision.reason, "stale_attempt");
  assert.equal(stale.state, state);
});

test("AC5 a rollback that invalidates the current policy disables recovery", () => {
  const { state, deferralFingerprint } = deferOnce();
  const rejected = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { currentPolicyValid: false } }),
    { nowIso: NOW },
  );
  assert.equal(rejected.decision.reason, "policy_incompatible");
});

test("AC5 an unauthorized repository fails closed", () => {
  const { state, deferralFingerprint } = deferOnce();
  const rejected = recoverDeferredReview(
    state,
    recoveryInput(deferralFingerprint, { authorization: { repositoryAccess: false } }),
    { nowIso: NOW },
  );
  assert.equal(rejected.decision.reason, "unauthorized_repository");
});

test("AC5 uninstall stops recovery eligibility immediately while retention continues", () => {
  const { state, deferralFingerprint } = deferOnce();
  const uninstalled = applyRepositoryLifecycle(
    state,
    { schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR, kind: "uninstall", tenant: "acme", repository: { owner: "acme", name: "widgets" } },
    { nowIso: NOW },
  );
  assert.equal(uninstalled.decision.stopsRecovery, true);
  assert.equal(uninstalled.decision.retentionContinues, true);
  const afterUninstall = recoverDeferredReview(uninstalled.state, recoveryInput(deferralFingerprint), { nowIso: NOW });
  assert.equal(afterUninstall.decision.reason, "recovery_disabled");
});

test("AC5 a cross-tenant transfer reassigns only with authorization, never silently", () => {
  const { state } = deferOnce();
  assert.throws(
    () => applyRepositoryLifecycle(
      state,
      {
        schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
        kind: "transfer_cross_tenant",
        tenant: "acme",
        repository: { owner: "acme", name: "widgets" },
        destinationTenant: "beta",
        destinationAuthorization: false,
        policyRevalidated: true,
      },
      { nowIso: NOW },
    ),
    /destinationAuthorization must be true/u,
  );
  const transferred = applyRepositoryLifecycle(
    state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      kind: "transfer_cross_tenant",
      tenant: "acme",
      repository: { owner: "acme", name: "widgets" },
      destinationTenant: "beta",
      destinationAuthorization: true,
      policyRevalidated: true,
    },
    { nowIso: NOW },
  );
  assert.equal(transferred.decision.destinationTenant, "beta");
  assert.equal(transferred.decision.reassignsSilently, false);
});

test("AC5 a cross-tenant transfer keeps the record digest-addressable and does not desync identity from its keys", () => {
  const { state, deferralFingerprint } = deferOnce();
  const transferred = applyRepositoryLifecycle(
    state,
    {
      schemaMajor: DEFERRED_RECOVERY_SCHEMA_MAJOR,
      kind: "transfer_cross_tenant",
      tenant: "acme",
      repository: { owner: "acme", name: "widgets" },
      destinationTenant: "beta",
      destinationAuthorization: true,
      policyRevalidated: true,
    },
    { nowIso: NOW },
  );
  // The digest-addressed identity feeds deferralFingerprint/headKey, so it must
  // stay immutable: the record remains findable by its ORIGINAL fingerprint and
  // its stored tenant still matches the key that was derived from it.
  const projected = projectDeferredRecord(transferred.state, deferralFingerprint);
  assert.equal(projected.deferralFingerprint, deferralFingerprint);
  assert.equal(projected.tenant, "acme");
  // A later recovery under the original identity still resolves the record
  // instead of colliding or becoming undiscoverable by deterministic derivation.
  const recovered = recoverDeferredReview(
    transferred.state,
    recoveryInput(deferralFingerprint),
    { nowIso: "2026-01-02T00:00:00Z" },
  );
  assert.equal(recovered.decision.outcome, "recovered");
});

// ===========================================================================
// AC6: Fake-clock tests cover the 180-day boundary, 30-day terminal-detail
// window, compaction, legal hold, purge, and coverage — through the REAL
// retention-policy computeRecordLifecycle with fixed injected nowIso.
// ===========================================================================

test("AC6 terminal detail of a resolved record is retained 30 days then compacts", () => {
  const record = classifyDeferredRetention({
    subject: "deferred_record",
    createdAt: "2026-01-01T00:00:00Z",
    terminalAt: "2026-02-01T00:00:00Z",
    resolution: "recovered",
    ...RETENTION_BINDING,
  });
  // 2026-02-01 + 30 days = 2026-03-03.
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-03-02T00:00:00Z" }).lifecycleState, "terminal");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-03-04T00:00:00Z" }).lifecycleState, "compacted");
});

test("AC6 an expired actionable record's 30-day terminal window then compacts", () => {
  const record = classifyDeferredRetention({
    subject: "deferred_record",
    createdAt: "2026-01-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  // Forced terminal at the 180-day boundary (2026-06-30) then +30 days = 2026-07-30.
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-07-29T00:00:00Z" }).lifecycleState, "terminal");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2026-07-31T00:00:00Z" }).lifecycleState, "compacted");
});

test("AC6 a bounded deferred receipt is retained for 13 calendar months", () => {
  const record = classifyDeferredRetention({
    subject: "receipt",
    createdAt: "2026-01-31T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "bounded_event");
  const lifecycle = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" });
  assert.equal(lifecycle.retainedUntil, "2027-02-28T00:00:00.000Z");
});

test("AC6 an audit chain is retained 13 months relative to its newest event", () => {
  const record = classifyDeferredRetention({
    subject: "audit",
    createdAt: "2026-01-01T00:00:00Z",
    newestEventAt: "2026-02-01T00:00:00Z",
    ...RETENTION_BINDING,
  });
  assert.equal(record.dataClass, "adjudication_chain");
  assert.equal(computeRecordLifecycle(record, { nowIso: "2027-03-02T00:00:00Z" }).lifecycleState, "deleted");
});

test("AC6 a legal hold pauses a covered deferred-record deletion timer", () => {
  const record = classifyDeferredRetention({
    subject: "deferred_record",
    createdAt: "2026-01-01T00:00:00Z",
    terminalAt: "2026-02-01T00:00:00Z",
    resolution: "recovered",
    ...RETENTION_BINDING,
  });
  const hold = decodeLegalHold({
    schemaVersion: 2,
    holdId: DIGEST,
    tenant: "acme",
    repository: { owner: "acme", name: "widgets" },
    dataClasses: ["deferred_review"],
    actor: "legal",
    reason: "litigation hold",
    authorization: "legal-order-1",
    state: "active",
    startAt: "2026-02-10T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
  });
  const held = computeRecordLifecycle(record, { nowIso: "2026-03-01T00:00:00Z", hold });
  assert.equal(held.holdPaused, true);
  assert.equal(held.nextDeletionAt, null);
});

test("AC6 coverage stays partitioned and marks expired/purged evidence", () => {
  const coverage = summarizeCoverage({ eligible: 10, retained: 7, expired: 2, purged: 1, unknown: 0 });
  assert.equal(coverage.complete, false);
  assert.equal(coverage.retained, 7);
});

// ===========================================================================
// Shared invariants: immutability, privacy boundary, deterministic identity.
// ===========================================================================

test("a decoded state and every decision are deeply frozen", () => {
  const base = ledger();
  assert.ok(Object.isFrozen(base));
  assert.ok(Object.isFrozen(base.deferrals));
  const result = deferReview(base, deferralInput(), { nowIso: NOW });
  assert.ok(Object.isFrozen(result.state));
  assert.ok(Object.isFrozen(result.decision));
});

test("a deferral is immutable: a duplicate is an idempotent replay, a changed fact fails closed", () => {
  const base = ledger();
  const first = deferReview(base, deferralInput(), { nowIso: NOW });
  const replay = deferReview(first.state, deferralInput(), { nowIso: NOW });
  assert.equal(replay.decision.replay, true);
  assert.equal(replay.state, first.state);
  const conflict = deferReview(first.state, deferralInput({ revision: 2, priorDispatch: "ambiguous" }), { nowIso: NOW });
  assert.equal(conflict.decision.outcome, "rejected");
  assert.equal(conflict.decision.reason, "conflicting_facts");
  assert.equal(conflict.state, first.state);
});

test("a prompt/finding/credential body is rejected at the boundary", () => {
  assert.throws(
    () => deferReview(ledger(), { ...deferralInput(), transcript: { body: "x" } }, { nowIso: NOW }),
    /forbidden by the deferred-recovery privacy boundary/u,
  );
  assert.throws(
    () => classifyDeferredRetention({ subject: "receipt", createdAt: NOW, prompt: "x", ...RETENTION_BINDING }),
    /forbidden by the deferred-recovery privacy boundary/u,
  );
});

test("a bounded public projection carries no credential or provider body", () => {
  const { state, deferralFingerprint, headKey } = deferOnce();
  for (const surface of [projectDeferredRecord(state, deferralFingerprint), projectHeadCheck(state, headKey)]) {
    const encoded = stableDeferredRecoveryJson(surface).toLowerCase();
    for (const forbidden of ["credential", "secret", "apikey", "prompt", "finding", "transcript", "providerpayload"]) {
      assert.ok(!encoded.includes(forbidden), `${forbidden} must not appear in a bounded surface`);
    }
  }
});

test("a deferred recovery digest is order-independent over equivalent fields", () => {
  const a = deriveDeferredRecoveryDigest({ tenant: "acme", attempt: 1 });
  const b = deriveDeferredRecoveryDigest({ attempt: 1, tenant: "acme" });
  assert.equal(a, b);
});

test("a conflicting classification subjects set fails closed", () => {
  assert.throws(
    () => classifyDeferredRetention({ subject: "receipt", subjects: ["receipt", "audit"], createdAt: NOW, ...RETENTION_BINDING }),
    /single subject/u,
  );
});
