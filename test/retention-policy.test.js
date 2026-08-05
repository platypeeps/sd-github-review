import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFERRED_EXPIRED_STATE,
  RETENTION_DATA_CLASSES,
  RETENTION_SCHEMA_MAJOR,
  STANDARD_V1,
  UNRESOLVED_EXPIRED_STATE,
  assertLivePurgeWithinSla,
  authorizeRestoreReads,
  buildAnonymousAggregate,
  computeRecordLifecycle,
  decodeLegalHold,
  decodePurgeRequest,
  decodeRecordClassification,
  decodeRepositoryLifecycleEvent,
  decodeRetentionProfile,
  decodeRetentionStatus,
  decodeRetentionStatusReport,
  deriveRetentionDigest,
  stableRetentionJson,
  summarizeCoverage,
} from "../src/retention-policy.js";

async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const standardV1Fixture = await fixture("protocol/v2/retention-standard-v1.json");
const validStatuses = await fixture("protocol/v2/retention-status.valid.json");
const invalidStatuses = await fixture("protocol/v2/retention-status.invalid.json");
const validPurges = await fixture("protocol/v2/retention-purge.valid.json");
const invalidPurges = await fixture("protocol/v2/retention-purge.invalid.json");
const validHolds = await fixture("protocol/v2/retention-legal-hold.valid.json");
const invalidHolds = await fixture("protocol/v2/retention-legal-hold.invalid.json");
const privacyFields = await fixture("protocol/v2/retention-privacy-fields.invalid.json");

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function clone(value) {
  return structuredClone(value);
}

function shift(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function eachInvalid(entries, decode) {
  for (const entry of entries) {
    assert.throws(() => decode(entry.value), new RegExp(entry.error, "u"), entry.name);
  }
}

function classify(overrides) {
  return decodeRecordClassification({
    retentionPolicyId: "standard-v1",
    version: "1.0.0",
    digest: STANDARD_V1.digest,
    ...overrides,
  });
}

// --- profile + digest -------------------------------------------------------

test("the standard-v1 fixture validates every data class and its canonical digest", () => {
  const profile = decodeRetentionProfile(standardV1Fixture);
  assert.equal(profile.retentionPolicyId, "standard-v1");
  assert.equal(profile.schemaMajor, RETENTION_SCHEMA_MAJOR);
  assert.equal(profile.digest, STANDARD_V1.digest);
  for (const dataClass of RETENTION_DATA_CLASSES) {
    assert.ok(profile.classes[dataClass], `missing class ${dataClass}`);
  }
  // Every documented duration and boundary is present.
  assert.equal(profile.classes.operational_state.activeMaxDays, 180);
  assert.equal(profile.classes.operational_state.terminalDays, 90);
  assert.equal(profile.classes.deferred_review.terminalDays, 30);
  assert.equal(profile.classes.budget_observation.terminalDays, 90);
  assert.equal(profile.classes.bounded_event.retentionMonths, 13);
  assert.equal(profile.classes.adjudication_chain.retentionMonths, 13);
  assert.equal(profile.classes.catalog_policy_version.referenceGraceMonths, 13);
  assert.equal(profile.classes.static_prompt_profile.referenceGraceMonths, 13);
  assert.equal(profile.classes.anonymous_aggregate.retentionMonths, 25);
  assert.equal(profile.classes.backup.hardMaxDays, 35);
  assert.equal(profile.classes.prohibited_content.crashCleanupHours, 24);
  assert.equal(profile.livePurgeSlaDays, 7);
});

test("a tampered profile digest is rejected", () => {
  const tampered = { ...clone(standardV1Fixture), digest: "0".repeat(64) };
  assert.throws(() => decodeRetentionProfile(tampered), /does not match its canonical content/u);
});

test("canonical retention JSON is stable and the digest changes with any field", () => {
  assert.equal(stableRetentionJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
  const first = deriveRetentionDigest({ a: 1, b: [{ d: 4, c: 3 }] });
  const reordered = deriveRetentionDigest({ b: [{ c: 3, d: 4 }], a: 1 });
  assert.equal(first, reordered);
  assert.notEqual(first, deriveRetentionDigest({ a: 2, b: [{ c: 3, d: 4 }] }));
});

// --- classification + conflicting classes fail closed ----------------------

test("a record declares exactly one data class; conflicting classification fails closed", () => {
  const record = classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z" });
  assert.equal(record.dataClass, "bounded_event");
  assert.throws(
    () => classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z", dataClasses: ["bounded_event", "backup"] }),
    /single dataClass, not a dataClasses set/u,
    "a dataClasses set never resolves to the longer duration",
  );
  assert.throws(
    () => classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z", secondaryDataClass: "backup" }),
    /a conflicting classification fails closed/u,
  );
});

// --- prohibited content + crash cleanup ------------------------------------

test("prohibited content cannot be persisted and only an ephemeral marker is allowed", () => {
  assert.throws(
    () => classify({ dataClass: "prohibited_content", createdAt: "2026-01-01T00:00:00Z" }),
    /prohibited_content must not be persisted/u,
  );
  // A persisted body is rejected before persistence.
  assert.throws(
    () => classify({ dataClass: "prohibited_content", createdAt: "2026-01-01T00:00:00Z", ephemeral: true, findings: "leaked line 7" }),
    (error) => /retention privacy boundary/u.test(error.message) && !error.message.includes("leaked line 7"),
    "a prohibited body must be rejected without echoing its value",
  );
});

test("an ephemeral crash-cleanup copy never survives 24 hours", () => {
  const created = "2026-01-01T00:00:00Z";
  const record = classify({ dataClass: "prohibited_content", createdAt: created, ephemeral: true });
  const before = computeRecordLifecycle(record, { nowIso: shift(created, 23 * HOUR_MS) });
  assert.equal(before.lifecycleState, "active");
  const atLimit = computeRecordLifecycle(record, { nowIso: shift(created, 24 * HOUR_MS) });
  assert.equal(atLimit.lifecycleState, "deleted");
  const after = computeRecordLifecycle(record, { nowIso: shift(created, 25 * HOUR_MS) });
  assert.equal(after.lifecycleState, "deleted");
});

// --- exact expiry boundaries per class -------------------------------------

test("operational terminal detail compacts exactly 90 days after it goes terminal", () => {
  const record = classify({
    dataClass: "operational_state",
    createdAt: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
    terminalAt: "2026-02-01T00:00:00Z",
  });
  const probe = computeRecordLifecycle(record, { nowIso: "2026-02-15T00:00:00Z" });
  assert.equal(probe.lifecycleState, "terminal");
  const deadline = probe.retainedUntil;
  assert.equal(computeRecordLifecycle(record, { nowIso: shift(deadline, -DAY_MS) }).lifecycleState, "terminal");
  assert.equal(computeRecordLifecycle(record, { nowIso: deadline }).lifecycleState, "compacted");
  assert.equal(computeRecordLifecycle(record, { nowIso: shift(deadline, DAY_MS) }).lifecycleState, "compacted");
});

test("an unresolved attempt reaches expired_unknown at exactly its 180-day maximum", () => {
  const record = classify({
    dataClass: "operational_state",
    createdAt: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
  });
  const active = computeRecordLifecycle(record, { nowIso: "2026-03-01T00:00:00Z" });
  assert.equal(active.lifecycleState, "active");
  assert.equal(active.terminalState, undefined);
  const expiryDay = shift("2026-01-01T00:00:00Z", 180 * DAY_MS);
  const dayBefore = computeRecordLifecycle(record, { nowIso: shift(expiryDay, -DAY_MS) });
  assert.equal(dayBefore.terminalState, undefined);
  const atExpiry = computeRecordLifecycle(record, { nowIso: expiryDay });
  assert.equal(atExpiry.terminalState, UNRESOLVED_EXPIRED_STATE);
  assert.equal(atExpiry.lifecycleState, "terminal");
});

test("a deferred review is actionable for 180 days then shows expired_unreviewed for 30", () => {
  const record = classify({
    dataClass: "deferred_review",
    createdAt: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
  });
  const actionable = computeRecordLifecycle(record, { nowIso: "2026-05-01T00:00:00Z" });
  assert.equal(actionable.lifecycleState, "active");
  const expiryDay = shift("2026-01-01T00:00:00Z", 180 * DAY_MS);
  const expired = computeRecordLifecycle(record, { nowIso: expiryDay });
  assert.equal(expired.terminalState, DEFERRED_EXPIRED_STATE);
  assert.equal(expired.lifecycleState, "terminal");
  // 30 days of terminal detail, then compaction.
  const detailEnd = shift(expiryDay, 30 * DAY_MS);
  assert.equal(computeRecordLifecycle(record, { nowIso: shift(detailEnd, -DAY_MS) }).lifecycleState, "terminal");
  assert.equal(computeRecordLifecycle(record, { nowIso: detailEnd }).lifecycleState, "compacted");
});

test("an early deferred resolution starts the 30-day terminal window from the resolution", () => {
  const record = classify({
    dataClass: "deferred_review",
    createdAt: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
    terminalAt: "2026-01-20T00:00:00Z",
    resolution: "recovered",
  });
  const probe = computeRecordLifecycle(record, { nowIso: "2026-01-25T00:00:00Z" });
  assert.equal(probe.lifecycleState, "terminal");
  assert.equal(probe.terminalState, undefined);
  assert.equal(probe.retainedUntil, shift("2026-01-20T00:00:00Z", 30 * DAY_MS));
});

test("budget observations are retained for exactly 90 days", () => {
  const record = classify({ dataClass: "budget_observation", createdAt: "2026-01-01T00:00:00Z", coverageStart: "2026-01-01T00:00:00Z" });
  const deadline = shift("2026-01-01T00:00:00Z", 90 * DAY_MS);
  assert.equal(computeRecordLifecycle(record, { nowIso: shift(deadline, -DAY_MS) }).lifecycleState, "active");
  assert.equal(computeRecordLifecycle(record, { nowIso: deadline }).lifecycleState, "deleted");
});

test("13-month event retention uses calendar months with leap-year clamping", () => {
  const nonLeap = classify({ dataClass: "bounded_event", createdAt: "2026-01-31T00:00:00Z" });
  assert.equal(
    computeRecordLifecycle(nonLeap, { nowIso: "2026-02-01T00:00:00Z" }).retainedUntil,
    "2027-02-28T00:00:00.000Z",
  );
  const leap = classify({ dataClass: "bounded_event", createdAt: "2023-01-31T00:00:00Z" });
  assert.equal(
    computeRecordLifecycle(leap, { nowIso: "2023-02-01T00:00:00Z" }).retainedUntil,
    "2024-02-29T00:00:00.000Z",
  );
});

test("an adjudication chain expires as one unit relative to its newest event", () => {
  const older = classify({
    dataClass: "adjudication_chain",
    createdAt: "2026-01-01T00:00:00Z",
    newestEventAt: "2026-01-01T00:00:00Z",
  });
  const corrected = classify({
    dataClass: "adjudication_chain",
    createdAt: "2026-01-01T00:00:00Z",
    newestEventAt: "2026-03-01T00:00:00Z",
  });
  const olderDeadline = computeRecordLifecycle(older, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  const correctedDeadline = computeRecordLifecycle(corrected, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  assert.notEqual(olderDeadline, correctedDeadline);
  assert.equal(olderDeadline, "2027-02-01T00:00:00.000Z");
  assert.equal(correctedDeadline, "2027-04-01T00:00:00.000Z");
});

test("anonymous aggregate metrics are retained for 25 calendar months", () => {
  const record = classify({ dataClass: "anonymous_aggregate", createdAt: "2026-01-01T00:00:00Z", coverageStart: "2026-01-01T00:00:00Z" });
  assert.equal(
    computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil,
    "2028-02-01T00:00:00.000Z",
  );
});

test("a backup ages out at the 35-day hard maximum", () => {
  const record = classify({ dataClass: "backup", createdAt: "2026-01-01T00:00:00Z" });
  const deadline = shift("2026-01-01T00:00:00Z", 35 * DAY_MS);
  assert.equal(computeRecordLifecycle(record, { nowIso: shift(deadline, -DAY_MS) }).lifecycleState, "active");
  assert.equal(computeRecordLifecycle(record, { nowIso: deadline }).lifecycleState, "backup_expired");
});

// --- reference-aware catalog / static prompt-profile deletion --------------

test("catalog and static prompt-profile versions live while referenced then grace 13 months", () => {
  const referenced = classify({ dataClass: "static_prompt_profile", createdAt: "2026-01-01T00:00:00Z", referenced: true });
  const active = computeRecordLifecycle(referenced, { nowIso: "2030-01-01T00:00:00Z" });
  assert.equal(active.lifecycleState, "active");
  assert.equal(active.retainedUntil, null, "a referenced version is not on a deletion clock");
  const unreferenced = classify({
    dataClass: "static_prompt_profile",
    createdAt: "2026-01-01T00:00:00Z",
    referenced: false,
    lastReferencedAt: "2026-06-01T00:00:00Z",
  });
  const grace = computeRecordLifecycle(unreferenced, { nowIso: "2026-07-01T00:00:00Z" });
  assert.equal(grace.retainedUntil, "2027-07-01T00:00:00.000Z");
  assert.equal(grace.lifecycleState, "terminal");
});

test("static prompt-profile configuration must carry no PR-specific content", () => {
  assert.throws(
    () => classify({ dataClass: "static_prompt_profile", createdAt: "2026-01-01T00:00:00Z", referenced: true, pullRequestNumber: 42 }),
    /retention anonymization boundary/u,
  );
});

// --- legal hold -------------------------------------------------------------

test("decodes every legal hold fixture and rejects the invalid ones", () => {
  for (const entry of validHolds) {
    const decoded = decodeLegalHold(entry.value);
    assert.ok(decoded.dataClasses.length >= 1, entry.name);
    assert.ok(Object.isFrozen(decoded), entry.name);
  }
  eachInvalid(invalidHolds, decodeLegalHold);
});

test("a covered active hold pauses the deletion timer without rehydrating data", () => {
  const record = classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z" });
  const baseDeadline = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  const hold = decodeLegalHold(validHolds.find((e) => e.name.startsWith("active hold")).value);
  // The hold covers bounded_event and operational_state and is active at now.
  const held = computeRecordLifecycle(record, { nowIso: shift(baseDeadline, DAY_MS), hold });
  assert.equal(held.holdPaused, true);
  assert.equal(held.retainedUntil, null, "a paused timer owes no deletion date");
  assert.notEqual(held.lifecycleState, "deleted");
});

test("a hold covering a different class does not pause this record", () => {
  const record = classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z" });
  const baseDeadline = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  const deferredOnly = decodeLegalHold(validHolds.find((e) => e.name.startsWith("released hold")).value);
  const after = computeRecordLifecycle(record, { nowIso: shift(baseDeadline, DAY_MS), hold: deferredOnly });
  assert.equal(after.holdPaused, false);
});

test("a released hold resumes the remaining timer rather than restarting it", () => {
  const record = classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z" });
  const baseDeadline = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  const releasedHold = decodeLegalHold({
    schemaVersion: 2,
    holdId: "7".repeat(64),
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
    dataClasses: ["bounded_event"],
    actor: "counsel-a",
    reason: "hold then release",
    authorization: "legal-approval-9",
    state: "released",
    startAt: "2026-06-01T00:00:00Z",
    expiresAt: "2027-06-01T00:00:00Z",
    releasedAt: "2027-01-01T00:00:00Z",
  });
  // After release, the record is still retained (deletion did not silently fire).
  const resumed = computeRecordLifecycle(record, { nowIso: "2027-01-02T00:00:00Z", hold: releasedHold });
  assert.equal(resumed.holdPaused, false);
  assert.ok(Date.parse(resumed.retainedUntil) > Date.parse(baseDeadline), "the resumed deadline extends past the original");
  // The remaining time is preserved, not restarted from a full 13 months.
  const remainingMs = Date.parse(baseDeadline) - Date.parse("2026-06-01T00:00:00Z");
  const expectedResume = shift("2027-01-01T00:00:00Z", remainingMs);
  assert.equal(resumed.retainedUntil, expectedResume);
  assert.equal(computeRecordLifecycle(record, { nowIso: expectedResume, hold: releasedHold }).lifecycleState, "deleted");
});

test("a hold placed after the deletion was already due cannot rehydrate the record", () => {
  const record = classify({ dataClass: "bounded_event", createdAt: "2026-01-01T00:00:00Z" });
  const baseDeadline = computeRecordLifecycle(record, { nowIso: "2026-06-01T00:00:00Z" }).retainedUntil;
  const lateHold = decodeLegalHold({
    schemaVersion: 2,
    holdId: "8".repeat(64),
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
    dataClasses: ["bounded_event"],
    actor: "counsel-a",
    reason: "too late",
    authorization: "legal-approval-10",
    state: "active",
    startAt: shift(baseDeadline, DAY_MS),
    expiresAt: shift(baseDeadline, 400 * DAY_MS),
  });
  const projection = computeRecordLifecycle(record, { nowIso: shift(baseDeadline, 2 * DAY_MS), hold: lateHold });
  assert.equal(projection.holdPaused, false);
  assert.equal(projection.lifecycleState, "deleted");
});

// --- purge, SLA, backup restore --------------------------------------------

test("a purge request is authorized, confirmed, and yields a deterministic receipt", () => {
  const first = decodePurgeRequest(validPurges[0].value);
  assert.equal(first.deletionStatus, "purge_pending");
  assert.equal(first.grantsLedgerAuthority, false);
  assert.equal(first.grantsDispatchAuthority, false);
  assert.equal(first.grantsRecoveryAuthority, false);
  assert.equal(first.githubNativeArtifacts.managed, false);
  assert.equal(first.githubNativeArtifacts.autoDeleted, false);
  assert.equal(first.liveDeletionDeadline, shift(first.requestedAt, 7 * DAY_MS));
  assert.equal(first.backupPurgeDeadline, shift(first.requestedAt, 35 * DAY_MS));
  // Idempotent replay reproduces the same receipt digest.
  const replay = decodePurgeRequest(validPurges[0].value);
  assert.equal(replay.deletionReceipt.deletionReceiptDigest, first.deletionReceipt.deletionReceiptDigest);
  // A different request identity produces a different receipt.
  const other = decodePurgeRequest({ ...clone(validPurges[0].value), requestId: "9".repeat(64) });
  assert.notEqual(other.deletionReceipt.deletionReceiptDigest, first.deletionReceipt.deletionReceiptDigest);
});

test("rejects every invalid purge request", () => {
  eachInvalid(invalidPurges, decodePurgeRequest);
});

test("a live purge must complete within the seven-day contract", () => {
  const requested = "2026-08-04T00:00:00Z";
  assert.equal(
    assertLivePurgeWithinSla(requested, shift(requested, 6 * DAY_MS)).withinSla,
    true,
  );
  assert.equal(assertLivePurgeWithinSla(requested, shift(requested, 7 * DAY_MS)).withinSla, true);
  assert.throws(
    () => assertLivePurgeWithinSla(requested, shift(requested, 7 * DAY_MS + 1)),
    /exceeded the seven-day completion contract/u,
  );
});

test("a restore must replay the deletion journal and stay within the 35-day backup max", () => {
  const backupCreatedAt = "2026-08-04T00:00:00Z";
  const ok = authorizeRestoreReads({
    backupCreatedAt,
    restoredAt: shift(backupCreatedAt, 10 * DAY_MS),
    deletionJournalReplayed: true,
  });
  assert.equal(ok.queryable, true);
  // Without journal replay, deleted data can never become queryable.
  assert.throws(
    () => authorizeRestoreReads({
      backupCreatedAt,
      restoredAt: shift(backupCreatedAt, 10 * DAY_MS),
      deletionJournalReplayed: false,
    }),
    /must replay the deletion journal/u,
  );
  // A backup older than the 35-day hard maximum cannot be restored at all.
  assert.throws(
    () => authorizeRestoreReads({
      backupCreatedAt,
      restoredAt: shift(backupCreatedAt, 36 * DAY_MS),
      deletionJournalReplayed: true,
    }),
    /exceeded the 35-day hard maximum/u,
  );
});

// --- repository lifecycle ownership boundaries -----------------------------

test("uninstall stops collection but keeps normal retention", () => {
  const event = decodeRepositoryLifecycleEvent({
    schemaVersion: 2,
    kind: "uninstall",
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
  });
  assert.equal(event.stopsCollection, true);
  assert.equal(event.purges, false);
  assert.equal(event.retentionContinues, true);
});

test("removal marks state inactive immediately", () => {
  const event = decodeRepositoryLifecycleEvent({
    schemaVersion: 2,
    kind: "removal",
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
  });
  assert.equal(event.marksInactive, true);
});

test("same-tenant transfer requires repository identity revalidation", () => {
  const event = decodeRepositoryLifecycleEvent({
    schemaVersion: 2,
    kind: "transfer_same_tenant",
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
    revalidatedRepositoryIdentity: true,
  });
  assert.equal(event.crossesTenant, false);
  assert.throws(
    () => decodeRepositoryLifecycleEvent({
      schemaVersion: 2,
      kind: "transfer_same_tenant",
      tenant: "acme",
      repository: { owner: "octo", name: "demo" },
    }),
    /revalidatedRepositoryIdentity must be explicitly true/u,
  );
});

test("cross-tenant transfer requires destination authorization and policy revalidation", () => {
  const event = decodeRepositoryLifecycleEvent({
    schemaVersion: 2,
    kind: "transfer_cross_tenant",
    tenant: "acme",
    repository: { owner: "octo", name: "demo" },
    destinationTenant: "beta",
    destinationAuthorization: true,
    policyRevalidated: true,
  });
  assert.equal(event.crossesTenant, true);
  assert.equal(event.reassignsHistoricalAuthority, false);
  assert.throws(
    () => decodeRepositoryLifecycleEvent({
      schemaVersion: 2,
      kind: "transfer_cross_tenant",
      tenant: "acme",
      repository: { owner: "octo", name: "demo" },
      destinationTenant: "beta",
      policyRevalidated: true,
    }),
    /destinationAuthorization must be explicitly true/u,
  );
  assert.throws(
    () => decodeRepositoryLifecycleEvent({
      schemaVersion: 2,
      kind: "transfer_cross_tenant",
      tenant: "acme",
      repository: { owner: "octo", name: "demo" },
      destinationTenant: "acme",
      destinationAuthorization: true,
      policyRevalidated: true,
    }),
    /must name a distinct destination tenant/u,
  );
});

// --- status contracts -------------------------------------------------------

test("decodes every retention status fixture and separates unmanaged GitHub artifacts", () => {
  for (const entry of validStatuses) {
    const decoded = decodeRetentionStatus(entry.value);
    assert.equal(decoded.githubNativeArtifacts.managed, false, entry.name);
    assert.equal(decoded.githubNativeArtifacts.autoDeleted, false, entry.name);
    assert.ok(Object.isFrozen(decoded), entry.name);
  }
  eachInvalid(invalidStatuses, decodeRetentionStatus);
});

test("the aggregate status report shows counts, holds, gaps, live purge, and backup deadline", () => {
  const report = decodeRetentionStatusReport({
    schemaVersion: 2,
    retentionPolicyId: "standard-v1",
    version: "1.0.0",
    digest: STANDARD_V1.digest,
    generatedAt: "2026-08-04T00:00:00Z",
    classes: [
      {
        dataClass: "bounded_event",
        retainedCount: 120,
        nextDeletionAt: "2026-09-01T00:00:00Z",
        coverage: { eligible: 120, retained: 120, expired: 0, purged: 0, unknown: 0 },
      },
      {
        dataClass: "operational_state",
        retainedCount: 8,
        nextDeletionAt: null,
        coverage: { eligible: 10, retained: 8, expired: 2, purged: 0, unknown: 0 },
      },
    ],
    holds: [
      { holdId: "3".repeat(64), dataClasses: ["bounded_event"], expiresAt: "2027-02-04T00:00:00Z" },
    ],
    coverageGaps: [
      { dataClass: "operational_state", reason: "2 records expired before this window" },
    ],
    livePurge: { state: "purge_pending", deadline: "2026-08-11T00:00:00Z" },
    backupPurgeDeadline: "2026-09-08T00:00:00Z",
    githubNativeArtifacts: {
      managed: false,
      autoDeleted: false,
      note: "GitHub controls its checks, comments, and reviews.",
    },
  });
  assert.equal(report.classes.length, 2);
  assert.equal(report.classes[0].coverage.complete, true);
  assert.equal(report.classes[1].coverage.complete, false, "an expired count is not a complete denominator");
  assert.equal(report.holds.length, 1);
  assert.equal(report.coverageGaps.length, 1);
  assert.equal(report.livePurge.state, "purge_pending");
  assert.equal(report.backupPurgeDeadline, "2026-09-08T00:00:00Z");
  assert.equal(report.githubNativeArtifacts.managed, false);
});

// --- coverage awareness + anonymization ------------------------------------

test("coverage summaries must partition the denominator and flag lost evidence", () => {
  const complete = summarizeCoverage({ eligible: 10, retained: 10, expired: 0, purged: 0, unknown: 0 });
  assert.equal(complete.complete, true);
  const lossy = summarizeCoverage({ eligible: 10, retained: 6, expired: 2, purged: 1, unknown: 1 });
  assert.equal(lossy.complete, false, "expired or purged evidence is never a complete denominator");
  assert.throws(
    () => summarizeCoverage({ eligible: 10, retained: 5, expired: 0, purged: 0, unknown: 0 }),
    /must partition the eligible denominator exactly/u,
    "retention cannot silently shrink a denominator to improve a metric",
  );
});

test("anonymous aggregates strip every identifier and stay coverage-aware", () => {
  const aggregate = buildAnonymousAggregate({
    windowStart: "2026-01-01T00:00:00Z",
    windowEnd: "2026-02-01T00:00:00Z",
    metrics: { reviews: 40, findings_count: 12 },
    coverage: { eligible: 40, retained: 40, expired: 0, purged: 0, unknown: 0 },
  });
  assert.equal(aggregate.nonIdentifying, true);
  assert.equal(aggregate.coverage.complete, true);
  for (const identifier of ["repository", "pullRequestNumber", "attempt", "actor", "candidateActor", "providerAccount", "findingId"]) {
    assert.throws(
      () => buildAnonymousAggregate({
        windowStart: "2026-01-01T00:00:00Z",
        windowEnd: "2026-02-01T00:00:00Z",
        metrics: { reviews: 40 },
        coverage: { eligible: 40, retained: 40, expired: 0, purged: 0, unknown: 0 },
        [identifier]: "x",
      }),
      /retention anonymization boundary/u,
      `aggregate must reject ${identifier}`,
    );
  }
});

// --- privacy boundary -------------------------------------------------------

test("public responses reject every forbidden content field without echoing values", () => {
  const base = validStatuses[0].value;
  for (const field of privacyFields.contentFields) {
    const poisoned = { ...clone(base), [field]: "leak-me-please" };
    assert.throws(
      () => decodeRetentionStatus(poisoned),
      (error) => /retention privacy boundary/u.test(error.message) && !error.message.includes("leak-me-please"),
      field,
    );
  }
});

test("record classification rejects every identifying field on a static profile", () => {
  for (const field of privacyFields.identifyingFields) {
    assert.throws(
      () => classify({ dataClass: "static_prompt_profile", createdAt: "2026-01-01T00:00:00Z", referenced: true, [field]: "x" }),
      /retention anonymization boundary/u,
      field,
    );
  }
});

test("nested forbidden content inside an unknown container is still rejected", () => {
  const poisoned = { ...clone(validPurges[0].value), extra: { nested: { rawBilling: "$$$" } } };
  assert.throws(
    () => decodePurgeRequest(poisoned),
    (error) => /retention privacy boundary/u.test(error.message) && !error.message.includes("$$$"),
  );
});

// --- delayed reconciliation + active-plus-terminal coexistence -------------

test("a delayed reconciliation still lands the terminal window at its resolution", () => {
  // The attempt goes terminal late (day 200) — after its 180-day active max —
  // but reconciliation records terminalAt, so the 90-day window runs from there.
  const record = classify({
    dataClass: "operational_state",
    createdAt: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
    terminalAt: shift("2026-01-01T00:00:00Z", 200 * DAY_MS),
  });
  const probe = computeRecordLifecycle(record, { nowIso: shift("2026-01-01T00:00:00Z", 210 * DAY_MS) });
  assert.equal(probe.lifecycleState, "terminal");
  assert.equal(probe.terminalState, undefined, "a reconciled attempt is not expired_unknown");
  assert.equal(probe.retainedUntil, shift(shift("2026-01-01T00:00:00Z", 200 * DAY_MS), 90 * DAY_MS));
});

test("active and terminal records of the same class coexist under one profile", () => {
  const active = classify({ dataClass: "operational_state", createdAt: "2026-06-01T00:00:00Z", coverageStart: "2026-06-01T00:00:00Z" });
  const terminal = classify({
    dataClass: "operational_state",
    createdAt: "2026-05-01T00:00:00Z",
    coverageStart: "2026-05-01T00:00:00Z",
    terminalAt: "2026-06-01T00:00:00Z",
  });
  const now = "2026-06-15T00:00:00Z";
  assert.equal(computeRecordLifecycle(active, { nowIso: now }).lifecycleState, "active");
  assert.equal(computeRecordLifecycle(terminal, { nowIso: now }).lifecycleState, "terminal");
});
