import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMPILER_SCHEMA_MAJOR,
  candidateProjectionDigest,
  compileRoutedReviewConfiguration,
  stableCompiledJson,
} from "../src/routed-review-compiler.js";

async function fixture(relative) {
  const url = new URL(`../fixtures/${relative}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const validSources = await fixture("protocol/v2/routed-review-source.valid.json");
const invalidSources = await fixture("protocol/v2/routed-review-source.invalid.json");
const catalogProjection = await fixture("protocol/v2/routed-review-catalog-projection.valid.json");
const handlerProfiles = await fixture("protocol/v2/routed-review-handler-profiles.valid.json");

function clone(value) {
  return structuredClone(value);
}

function optionsFor(entry) {
  return entry.mode === "managed"
    ? { source: entry.value, catalog: catalogProjection }
    : { source: entry.value, handlerProfiles };
}

const standalone = validSources.find((s) => s.mode === "standalone");
const managed = validSources.find((s) => s.mode === "managed");

// --- reproducibility + canonical shape (AC1, AC6) --------------------------

test("every golden source compiles into a frozen canonical manifest", () => {
  for (const entry of validSources) {
    const compiled = compileRoutedReviewConfiguration(optionsFor(entry));
    assert.equal(compiled.schemaVersion, COMPILER_SCHEMA_MAJOR, entry.name);
    assert.equal(compiled.mode, entry.mode, entry.name);
    assert.match(compiled.sourceDigest, /^[a-f0-9]{64}$/u, entry.name);
    assert.match(compiled.outputDigest, /^[a-f0-9]{64}$/u, entry.name);
    assert.ok(Object.isFrozen(compiled), entry.name);
  }
});

test("equivalent semantic inputs compile byte-for-byte identically across runs", () => {
  for (const entry of validSources) {
    const first = compileRoutedReviewConfiguration(optionsFor(entry));
    // Reorder the top-level keys of the source: an equivalent semantic input.
    const reordered = Object.fromEntries(Object.entries(clone(entry.value)).reverse());
    const options = entry.mode === "managed"
      ? { source: reordered, catalog: clone(catalogProjection) }
      : { source: reordered, handlerProfiles: clone(handlerProfiles) };
    const second = compileRoutedReviewConfiguration(options);
    assert.equal(
      stableCompiledJson(first),
      stableCompiledJson(second),
      `${entry.name}: canonical JSON is stable across key ordering`,
    );
    assert.equal(first.outputDigest, second.outputDigest, `${entry.name}: output digest is reproducible`);
  }
});

test("the compiler is pure: repeated compilation never mutates its inputs", () => {
  const before = stableCompiledJson(standalone.value);
  compileRoutedReviewConfiguration({ source: standalone.value, handlerProfiles });
  compileRoutedReviewConfiguration({ source: standalone.value, handlerProfiles });
  assert.equal(stableCompiledJson(standalone.value), before, "source input is not mutated");
});

// --- digest sensitivity (AC2) ----------------------------------------------

test("every semantic source change alters the canonical output digest", () => {
  const base = compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection });
  const changed = clone(managed.value);
  changed.configurationDigest = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  const next = compileRoutedReviewConfiguration({ source: changed, catalog: catalogProjection });
  assert.notEqual(next.outputDigest, base.outputDigest, "a changed configuration digest changes the output");
});

test("a semantic catalog change alters the output digest", () => {
  const base = compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection });
  // Swap the assurance candidate's model. Because the candidate identity is
  // content-addressed, the source lane must re-reference the new digest, and the
  // compiled lane's safe fields plus the output digest change with it.
  const changedCatalog = clone(catalogProjection);
  const assuranceCandidate = changedCatalog.candidates.find((c) => c.alias === "assurance-strict");
  assuranceCandidate.model = "qwen/qwen3-review-next";
  const changedSource = clone(managed.value);
  changedSource.lanes.assurance.candidate.candidateDigest = candidateProjectionDigest(assuranceCandidate);
  const next = compileRoutedReviewConfiguration({ source: changedSource, catalog: changedCatalog });
  assert.equal(next.lanes.assurance.candidate.model, "qwen/qwen3-review-next");
  assert.notEqual(next.outputDigest, base.outputDigest, "a changed catalog candidate changes the output");
});

// --- explicit block/allow policy (AC8, requirement 7) ----------------------

test("explicit block/allow exhaustion policy is normalized into each lane and changes the digest", () => {
  const allow = compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection });
  assert.equal(allow.lanes.assurance.budgetExhaustion.merge, "allow");
  assert.equal(allow.lanes.gate.budgetExhaustion.merge, "block");

  const flipped = clone(managed.value);
  flipped.lanes.assurance.budgetExhaustion.merge = "block";
  const block = compileRoutedReviewConfiguration({ source: flipped, catalog: catalogProjection });
  assert.equal(block.lanes.assurance.budgetExhaustion.merge, "block");
  assert.notEqual(block.outputDigest, allow.outputDigest, "flipping merge policy changes the output digest");
});

test("no default or contextual exhaustion policy is ever synthesized", () => {
  const missing = clone(managed.value);
  delete missing.lanes.assurance.budgetExhaustion;
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: missing, catalog: catalogProjection }),
    /budgetExhaustion must be an object/u,
    "a missing merge policy is never defaulted",
  );
});

// --- shared + candidate-specific profiles, mismatch failures (AC3, AC4) ----

test("shared and candidate-specific profiles compile and expose safe candidate fields", () => {
  const compiled = compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection });
  const assurance = compiled.lanes.assurance;
  assert.equal(assurance.candidate.kind, "external");
  assert.equal(assurance.candidate.promptProfile.mode, "referenced");
  assert.equal(assurance.candidate.promptProfile.alias, "assurance-strict");
  assert.equal(assurance.candidate.credentialRef, undefined, "no credential reference in a compiled lane");
  assert.equal(assurance.candidate.budgetRef, undefined, "no budget reference in a compiled lane");
  const gate = compiled.lanes.gate;
  assert.equal(gate.candidate.kind, "native");
  assert.equal(gate.candidate.promptProfile.mode, "handler-managed");
  assert.equal(gate.candidate.promptProfile.alias, undefined, "a native candidate carries no profile reference");
});

test("a lane referencing an absent candidate fails before an active manifest", () => {
  const bad = clone(managed.value);
  bad.lanes.assurance.candidate.candidateDigest = "0".repeat(64);
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: bad, catalog: catalogProjection }),
    /references a candidate absent from the catalog projection/u,
  );
});

test("a substituted or digest-mismatched profile fails closed", () => {
  const substituted = clone(managed.value);
  substituted.lanes.assurance.candidate.promptProfile.digest = "1".repeat(64);
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: substituted, catalog: catalogProjection }),
    /does not match the catalog candidate's exact prompt-profile identity/u,
  );
});

test("a candidate ineligible for its lane or slot fails as a composition/capability error", () => {
  // The gate candidate is eligible only for the gate lane and the parallel slot.
  const wrongSlot = clone(managed.value);
  wrongSlot.lanes.gate.slot = "managed";
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: wrongSlot, catalog: catalogProjection }),
    /is not an eligible slot for the candidate/u,
  );
});

test("two lanes binding the same candidate fail as an overlap", () => {
  const overlap = clone(managed.value);
  overlap.lanes.gate.candidate = clone(overlap.lanes.assurance.candidate);
  overlap.lanes.gate.slot = "managed";
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: overlap, catalog: catalogProjection }),
    /overlaps lane/u,
  );
});

// --- mode is never inferred (requirement 6, AC7) ---------------------------

test("standalone compiles with no catalog while managed fails without the exact projection", () => {
  const compiled = compileRoutedReviewConfiguration({ source: standalone.value, handlerProfiles });
  assert.equal(compiled.mode, "standalone");
  assert.equal(compiled.catalogDigest, undefined, "a standalone manifest carries no catalog digest");
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: managed.value }),
    /the exact catalog safe projection is required/u,
    "managed compilation fails closed without a catalog projection",
  );
});

test("a stale or substituted catalog projection can never satisfy a managed compilation", () => {
  const mismatchedCatalog = clone(catalogProjection);
  mismatchedCatalog.catalogDigest = "1".repeat(64);
  for (const candidate of mismatchedCatalog.candidates) candidate.catalogDigest = "1".repeat(64);
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: managed.value, catalog: mismatchedCatalog }),
    /does not match the source catalog digest/u,
  );
});

test("a supplied catalog never upgrades a standalone source to managed", () => {
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: standalone.value, catalog: catalogProjection, handlerProfiles }),
    /a candidate catalog projection is forbidden and never upgrades the mode/u,
  );
});

test("supplied handler profiles never downgrade a managed source to standalone", () => {
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection, handlerProfiles }),
    /standalone handler profiles are forbidden and never downgrade the mode/u,
  );
});

// --- standalone handler profiles (requirement 1, AC4) ----------------------

test("a direct-handler route must match a setup-discovered fixed handler profile", () => {
  const undiscovered = clone(standalone.value);
  undiscovered.routes.review.handler = "unknown-handler";
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: undiscovered, handlerProfiles }),
    /is not a setup-discovered handler profile/u,
  );

  const substituted = clone(standalone.value);
  substituted.routes.review.promptProfile.digest = "9".repeat(64);
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: substituted, handlerProfiles }),
    /does not match the fixed setup-discovered profile/u,
  );
});

test("a direct-handler route requires discovered handler profiles to be supplied", () => {
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: standalone.value }),
    /setup-discovered handler profiles are required/u,
  );
});

test("an all-local standalone source compiles with no handler profiles", () => {
  const allLocal = validSources.find((s) => s.name.includes("all-local"));
  const compiled = compileRoutedReviewConfiguration({ source: allLocal.value });
  assert.equal(compiled.mode, "standalone");
  for (const route of Object.values(compiled.routes)) {
    assert.equal(route.execution, "local-attested");
  }
});

// --- candidate/slot label configuration is unrepresentable (AC5) -----------

test("a compiled manifest never exposes candidate or slot label configuration", () => {
  const compiled = compileRoutedReviewConfiguration({ source: managed.value, catalog: catalogProjection });
  const json = stableCompiledJson(compiled);
  assert.ok(!/labels?/iu.test(json), "no label configuration appears in compiled output");
  assert.ok(!/overrides?/iu.test(json), "no override configuration appears in compiled output");
});

test("rejects every invalid source fixture with a field diagnostic", () => {
  for (const entry of invalidSources) {
    assert.throws(
      () => compileRoutedReviewConfiguration({ source: entry.value, catalog: catalogProjection, handlerProfiles: undefined }),
      new RegExp(entry.error, "u"),
      entry.name,
    );
  }
});

// --- diagnostics never leak secret or raw catalog data (requirement 5) -----

test("a composition-lever diagnostic names the field and boundary without echoing its value", () => {
  const poisoned = clone(standalone.value);
  poisoned.overrides = { labels: { review: "leak-me-please" } };
  assert.throws(
    () => compileRoutedReviewConfiguration({ source: poisoned, handlerProfiles }),
    (error) => /is forbidden/u.test(error.message) && !error.message.includes("leak-me-please"),
  );
});

// --- content-addressed candidate identity ----------------------------------

test("candidateProjectionDigest is the stable content digest a lane references", () => {
  const [, assuranceCandidate] = catalogProjection.candidates;
  const digest = candidateProjectionDigest(assuranceCandidate);
  assert.equal(digest, managed.value.lanes.assurance.candidate.candidateDigest);
  // Reordered but semantically equivalent input yields the same digest.
  const reordered = Object.fromEntries(Object.entries(clone(assuranceCandidate)).reverse());
  assert.equal(candidateProjectionDigest(reordered), digest);
});
