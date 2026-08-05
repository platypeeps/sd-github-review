import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANDIDATE_KINDS,
  CATALOG_SCHEMA_MAJOR,
  classifyCatalogRetention,
  decodeCandidateCatalog,
  decodeCandidateQuarantine,
  decodeCandidateRecord,
  decodeCandidateSafeProjection,
  decodePromptProfileRegistry,
  deriveCatalogDigest,
  describeCatalogTransition,
  stableCatalogJson,
} from "../src/review-candidate-catalog.js";
import {
  STANDARD_V1,
  computeRecordLifecycle,
  decodeLegalHold,
} from "../src/retention-policy.js";

async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const validCatalogs = await fixture("protocol/v2/review-candidate-catalog.valid.json");
const invalidCatalogs = await fixture("protocol/v2/review-candidate-catalog.invalid.json");
const validRegistries = await fixture("protocol/v2/prompt-profile-registry.valid.json");
const invalidRegistries = await fixture("protocol/v2/prompt-profile-registry.invalid.json");
const validProjections = await fixture("protocol/v2/candidate-safe-projection.valid.json");
const invalidProjections = await fixture("protocol/v2/candidate-safe-projection.invalid.json");
const privacyFields = await fixture("protocol/v2/catalog-privacy-fields.invalid.json");
const failClosed = await fixture("protocol/v2/catalog-fail-closed.invalid.json");
const retentionClock = await fixture("protocol/v2/catalog-retention.fake-clock.json");

function clone(value) {
  return structuredClone(value);
}

function eachInvalid(entries, decode) {
  for (const entry of entries) {
    assert.throws(() => decode(entry.value), new RegExp(entry.error, "u"), entry.name);
  }
}

const baseCatalog = validCatalogs[0].value;

// --- catalog identity, immutability, digest --------------------------------

test("the valid catalog decodes with a stable identity and sorted candidates", () => {
  const catalog = decodeCandidateCatalog(baseCatalog);
  assert.equal(catalog.schemaMajor, CATALOG_SCHEMA_MAJOR);
  assert.equal(catalog.name, "review-candidates");
  assert.equal(catalog.version, "3.1.0");
  assert.match(catalog.digest, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.candidates));
  const aliases = catalog.candidates.map((c) => c.alias);
  assert.deepEqual(aliases, [...aliases].sort(), "candidate aliases are stable and sorted");
  assert.equal(new Set(aliases).size, aliases.length, "aliases are unique within the version");
});

test("a supplied digest that matches canonical content is accepted; a tampered one fails closed", () => {
  const catalog = decodeCandidateCatalog(baseCatalog);
  const pinned = { ...clone(baseCatalog), digest: catalog.digest };
  const repinned = decodeCandidateCatalog(pinned);
  assert.equal(repinned.digest, catalog.digest, "a correctly pinned version re-decodes identically");
  const tampered = { ...clone(baseCatalog), digest: "0".repeat(64) };
  assert.throws(() => decodeCandidateCatalog(tampered), /digest does not match its canonical content/u);
});

test("portable model replacement produces a new catalog digest without touching aliases", () => {
  const original = decodeCandidateCatalog(baseCatalog);
  const swapped = clone(baseCatalog);
  const target = swapped.candidates.find((c) => c.alias === "kimi-review");
  target.model = "kimi/k2-review-next";
  const replaced = decodeCandidateCatalog(swapped);
  assert.notEqual(replaced.digest, original.digest, "swapping a model changes the content-addressed digest");
  assert.deepEqual(
    replaced.candidates.map((c) => c.alias),
    original.candidates.map((c) => c.alias),
    "candidate aliases remain stable across a portable model replacement",
  );
});

test("providers are opaque consumer choices, never a protocol allow-list", () => {
  const custom = clone(baseCatalog);
  const native = custom.candidates.find((c) => c.alias === "copilot-native");
  native.handler = "some-vendor-handler";
  native.model = "some-vendor/model-7";
  const catalog = decodeCandidateCatalog(custom);
  const decoded = catalog.candidates.find((c) => c.model === "some-vendor/model-7");
  assert.ok(decoded, "an arbitrary provider/model string is accepted without an allow-list");
});

test("rejects every invalid catalog fixture", () => {
  eachInvalid(invalidCatalogs, decodeCandidateCatalog);
});

// --- profile reuse + candidate-specific binding + handler compatibility ----

test("compatible candidates share one profile while a specific candidate binds its own", () => {
  const catalog = decodeCandidateCatalog(baseCatalog);
  const kimi = catalog.candidates.find((c) => c.alias === "kimi-review");
  const qwen = catalog.candidates.find((c) => c.alias === "qwen-review");
  const gate = catalog.candidates.find((c) => c.alias === "gate-deep");
  assert.equal(kimi.promptProfile.alias, "thorough-shared");
  assert.equal(qwen.promptProfile.alias, "thorough-shared", "two compatible candidates reuse one profile");
  assert.equal(gate.promptProfile.alias, "gate-specific", "a candidate-specific profile is allowed");
  assert.deepEqual(kimi.promptProfileCompatibility.compatibleHandlers, ["pr-agent"]);
});

test("a native candidate declares handler-managed prompting and no profile reference", () => {
  const catalog = decodeCandidateCatalog(baseCatalog);
  const native = catalog.candidates.find((c) => c.alias === "copilot-native");
  assert.equal(native.kind, "native");
  assert.equal(native.promptProfile.mode, "handler-managed");
  assert.equal(native.promptProfile.alias, undefined);
});

test("the prompt-profile registry decodes reuse and rejects invalid metadata", () => {
  for (const entry of validRegistries) {
    const registry = decodePromptProfileRegistry(entry.value);
    assert.ok(registry.profiles.length >= 1, entry.name);
    assert.ok(Object.isFrozen(registry.profiles), entry.name);
    for (const profile of registry.profiles) {
      assert.equal(profile.promptBody, undefined, "no prompt body in metadata");
      assert.equal(profile.configuration, undefined, "no configuration body in metadata");
    }
  }
  eachInvalid(invalidRegistries, decodePromptProfileRegistry);
});

// --- candidate record binding rules ----------------------------------------

test("a candidate record validates its binding shape and hard-limit policy", () => {
  const record = decodeCandidateRecord(clone(baseCatalog.candidates[0]));
  assert.equal(record.kind, "external");
  assert.equal(record.failover.sameModelOnly, true);
  assert.equal(record.policy.units, "tokens");
  assert.ok(record.policy.safetyMargin < record.policy.hardRequestCostLimit);
  assert.ok(Object.isFrozen(record.policy));
});

test("policy-incomplete, unknown-lane, and malformed candidates fail closed", () => {
  eachInvalid(failClosed, (value) => decodeCandidateRecord(value));
});

test("CANDIDATE_KINDS is the external/native discriminant", () => {
  assert.deepEqual([...CANDIDATE_KINDS], ["external", "native"]);
});

// --- bounded safe projection ------------------------------------------------

test("safe projections expose profile identity and dispatch facts but no bodies", () => {
  for (const entry of validProjections) {
    const projection = decodeCandidateSafeProjection(entry.value);
    assert.ok(Object.isFrozen(projection), entry.name);
    assert.equal(projection.tokenizer.verified, true, entry.name);
    assert.equal(projection.pricing.verified, true, entry.name);
    assert.equal(projection.credentialRef, undefined, "no credential reference in a projection");
    assert.equal(projection.budgetRef, undefined, "no budget reference in a projection");
    assert.equal(projection.rules, undefined, "no rule references in a projection");
    if (projection.promptProfile.mode === "referenced") {
      assert.match(projection.promptProfile.digest, /^[a-f0-9]{64}$/u, entry.name);
      assert.ok(Array.isArray(projection.promptProfile.compatibleHandlers), entry.name);
    }
  }
});

test("projections reject unverifiable capabilities, secrets, endpoints, and bodies", () => {
  eachInvalid(invalidProjections, decodeCandidateSafeProjection);
});

// --- privacy boundary -------------------------------------------------------

test("catalog rejects every forbidden content field without echoing its value", () => {
  for (const field of privacyFields.contentFields) {
    const poisoned = { ...clone(baseCatalog), [field]: "leak-me-please" };
    assert.throws(
      () => decodeCandidateCatalog(poisoned),
      (error) => /catalog privacy boundary/u.test(error.message) && !error.message.includes("leak-me-please"),
      field,
    );
  }
});

test("prompt-profile metadata rejects every PR-specific identifier", () => {
  for (const field of privacyFields.identifyingFields) {
    const poisoned = [
      { alias: "p", version: "1.0.0", digest: "1".repeat(64), compatibleHandlers: ["pr-agent"], [field]: "x" },
    ];
    assert.throws(
      () => decodePromptProfileRegistry(poisoned),
      /catalog anonymization boundary/u,
      field,
    );
  }
});

// --- quarantine overlay -----------------------------------------------------

test("a quarantine overlay is keyed to an alias and never mutates a pinned version", () => {
  const quarantined = decodeCandidateQuarantine({
    schemaMajor: 2,
    catalogDigest: "1".repeat(64),
    alias: "kimi-review",
    state: "quarantined",
    reason: "provider incident",
    effectiveAt: "2026-08-05T00:00:00Z",
  });
  assert.equal(quarantined.state, "quarantined");
  assert.equal(quarantined.mutatesPinnedVersion, false);

  const replaced = decodeCandidateQuarantine({
    schemaMajor: 2,
    catalogDigest: "1".repeat(64),
    alias: "kimi-review",
    state: "replaced",
    reason: "portable model swap",
    effectiveAt: "2026-08-05T00:00:00Z",
    replacementModel: "kimi/k2-review-next",
  });
  assert.equal(replaced.replacementModel, "kimi/k2-review-next");

  assert.throws(
    () => decodeCandidateQuarantine({
      schemaMajor: 2,
      catalogDigest: "1".repeat(64),
      alias: "kimi-review",
      state: "quarantined",
      reason: "bad",
      effectiveAt: "2026-08-05T00:00:00Z",
      candidates: [],
    }),
    /never mutates a pinned catalog version/u,
  );
  assert.throws(
    () => decodeCandidateQuarantine({
      schemaMajor: 2,
      catalogDigest: "1".repeat(64),
      alias: "kimi-review",
      state: "quarantined",
      reason: "bad",
      effectiveAt: "2026-08-05T00:00:00Z",
      replacementModel: "kimi/k2-review-next",
    }),
    /replacementModel is valid only for a replaced overlay/u,
  );
});

// --- version transition / rollback -----------------------------------------

test("a pinned version cannot mutate in place; a change requires a new version", () => {
  const previous = decodeCandidateCatalog(baseCatalog);
  const mutated = clone(baseCatalog);
  mutated.candidates[0].model = "kimi/k2-review-next";
  const next = decodeCandidateCatalog(mutated);
  assert.notEqual(next.digest, previous.digest);
  // Same version string but different content fails closed.
  assert.throws(
    () => describeCatalogTransition(previous, { ...next, version: previous.version }),
    /must not mutate in place/u,
  );
});

test("a new version transition reports change and a rollback restores an earlier version", () => {
  const previous = decodeCandidateCatalog(baseCatalog);
  const forward = decodeCandidateCatalog({ ...clone(baseCatalog), version: "3.2.0" });
  const forwardTransition = describeCatalogTransition(previous, forward);
  assert.equal(forwardTransition.versionChanged, true);
  assert.equal(forwardTransition.rollback, false);

  const rolledBack = decodeCandidateCatalog({ ...clone(baseCatalog), version: "2.0.0" });
  const rollbackTransition = describeCatalogTransition(previous, rolledBack);
  assert.equal(rollbackTransition.rollback, true, "an earlier version is a rollback, not a mutation");
});

test("changing a profile digest invalidates every referencing candidate/profile tuple", () => {
  const previous = decodeCandidateCatalog(baseCatalog);
  const changed = clone(baseCatalog);
  changed.version = "3.2.0";
  const newDigest = "5555555555555555555555555555555555555555555555555555555555555555";
  changed.promptProfiles.find((p) => p.alias === "gate-specific").digest = newDigest;
  changed.candidates.find((c) => c.alias === "gate-deep").promptProfile.digest = newDigest;
  const next = decodeCandidateCatalog(changed);
  const transition = describeCatalogTransition(previous, next);
  const tuple = transition.invalidatedTuples.find((t) => t.candidateAlias === "gate-deep");
  assert.ok(tuple, "the candidate bound to the changed profile is invalidated");
  assert.equal(tuple.profileAlias, "gate-specific");
  assert.equal(tuple.nextDigest, newDigest);
});

// --- retention classification (reference-aware 13-month tail) ---------------

function classify(scenario) {
  return classifyCatalogRetention({
    subject: scenario.subject,
    createdAt: retentionClock.createdAt,
    referenced: scenario.referenced,
    ...(scenario.lastReferencedAt ? { lastReferencedAt: scenario.lastReferencedAt } : {}),
    retentionPolicyId: "standard-v1",
    version: "1.0.0",
    digest: STANDARD_V1.digest,
  });
}

test("catalog retention classification drives the reference-aware fake clock", () => {
  for (const scenario of retentionClock.scenarios) {
    const record = classify(scenario);
    const hold = scenario.hold ? decodeLegalHold(scenario.hold) : undefined;
    const lifecycle = computeRecordLifecycle(record, { nowIso: scenario.nowIso, hold });
    for (const [key, expected] of Object.entries(scenario.expect)) {
      assert.deepEqual(lifecycle[key], expected, `${scenario.name}: ${key}`);
    }
  }
});

test("a conflicting retention classification fails closed rather than choosing a duration", () => {
  assert.throws(
    () => classifyCatalogRetention({
      subject: "catalog_version",
      subjects: ["catalog_version", "prompt_profile"],
      createdAt: "2026-01-01T00:00:00Z",
      retentionPolicyId: "standard-v1",
      version: "1.0.0",
      digest: STANDARD_V1.digest,
    }),
    /single subject, not a subjects set/u,
  );
  assert.throws(
    () => classifyCatalogRetention({
      subject: "catalog_version",
      secondarySubject: "prompt_profile",
      createdAt: "2026-01-01T00:00:00Z",
      retentionPolicyId: "standard-v1",
      version: "1.0.0",
      digest: STANDARD_V1.digest,
    }),
    /a conflicting classification fails closed/u,
  );
});

test("a referenced version rejects a lastReferencedAt and a static profile rejects PR content", () => {
  assert.throws(
    () => classifyCatalogRetention({
      subject: "catalog_version",
      createdAt: "2026-01-01T00:00:00Z",
      referenced: true,
      lastReferencedAt: "2026-06-01T00:00:00Z",
      retentionPolicyId: "standard-v1",
      version: "1.0.0",
      digest: STANDARD_V1.digest,
    }),
    /valid only once the version is no longer referenced/u,
  );
  assert.throws(
    () => classifyCatalogRetention({
      subject: "prompt_profile",
      createdAt: "2026-01-01T00:00:00Z",
      referenced: true,
      pullRequestNumber: 42,
      retentionPolicyId: "standard-v1",
      version: "1.0.0",
      digest: STANDARD_V1.digest,
    }),
    /catalog anonymization boundary/u,
  );
});

test("no dangling retained receipt survives once the tail elapses", () => {
  const record = classify({ subject: "prompt_profile", referenced: false, lastReferencedAt: "2026-06-01T00:00:00Z" });
  const afterTail = computeRecordLifecycle(record, { nowIso: "2028-01-01T00:00:00Z" });
  assert.equal(afterTail.lifecycleState, "deleted");
  assert.equal(afterTail.finalForm, "digest_only", "only the non-reversible digest fact remains");
});

// --- canonicalization helpers ----------------------------------------------

test("canonical catalog JSON is stable and the digest changes with any field", () => {
  assert.equal(stableCatalogJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
  const first = deriveCatalogDigest({ a: 1, b: [{ d: 4, c: 3 }] });
  const reordered = deriveCatalogDigest({ b: [{ c: 3, d: 4 }], a: 1 });
  assert.equal(first, reordered);
  assert.notEqual(first, deriveCatalogDigest({ a: 2, b: [{ c: 3, d: 4 }] }));
});
