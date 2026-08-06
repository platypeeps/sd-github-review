# Deep-freeze v2 contract decoder outputs

## Goal

`Object.freeze` is shallow. Every v2 contract decoder freezes only the top-level
returned object, so nested decoded state stays mutable after validation. Make
"immutable decoded contract" mean immutable all the way down, consistently
across both contract modules.

## Origin

Raised as a blocking concern by the Codex lane during the planning adversarial
review of `08-04-define-v2-receipt-and-identity-contracts`, and rebutted there on
severity — it is a pre-existing module-wide property, not a defect introduced by
that task, and that task carried no deep-immutability acceptance criterion.
Deep-freezing only its five new decoders would have made them silently
inconsistent with every sibling contract. Deferred here deliberately.

## Problem

- `src/protocol-v2.js`: 27 `Object.freeze` call sites. `src/retention-policy.js`:
  28. Neither module defines a `deepFreeze` helper.
- Shared field builders return plain unfrozen objects, and their results are
  spread into frozen decoder output: `repositoryValue` (`protocol-v2.js:410`),
  `mutableBinding` (`:469`), `decodeLocalEvidenceBinding` (`:1084`).
- Consequently a decoded receipt's nested `repository`, `promptProfile`,
  `legalHold`, and any `candidates`/`entries` arrays remain writable.
- For fingerprinted contracts the divergence is worse than plain mutability: the
  `*Fingerprint` is computed once at decode time, so post-decode nested mutation
  leaves a fingerprint that no longer describes the object it is attached to.
- The test suite currently encodes the weaker guarantee: `Object.isFrozen`
  appears 2 times in `test/protocol-v2.test.js` and 7 times in
  `test/retention-policy.test.js`, always against the top-level object.

## Threat model — read before sizing this

These decoders are the validation boundary for **untrusted input**.
`rejectForbiddenFields` walks the entire input tree before decode, so forbidden
fields cannot cross the boundary. Deep freeze does **not** defend against a
hostile in-process caller, who can simply construct a different object.

What it does buy is protection against *accidental* post-validation mutation by
code that already holds a decoded contract, and it makes the fingerprint's claim
about its object structurally true rather than true-by-convention. That is a real
but bounded benefit. Size the work accordingly; this is hardening, not a
vulnerability fix. Priority P3 reflects that.

## Requirements

- Decoded output of every exported decoder in `src/protocol-v2.js` and
  `src/retention-policy.js` is frozen transitively: nested objects and arrays,
  and objects inside arrays.
- One shared helper, applied uniformly. Do not hand-freeze nested fields at
  individual call sites — that is what produced the current inconsistency.
- Decide and document the treatment of shared builders (`repositoryValue`,
  `mutableBinding`, `decodeLocalEvidenceBinding`): either they freeze their own
  output, or every decoder that spreads them freezes transitively at the end.
  Pick one rule; a mixed rule is how this drifts again.
- Deliberately-unfrozen returns stay unfrozen unless the change is justified in
  the same task. At least `decodeLocalReviewAuthorization` (`:1211`, unfrozen
  because it derives `attemptToken`) and `decodeCheckProjection` (`:1324`) are
  intentional today — confirm each before changing it.
- No decoder signature, field name, error message, or emitted field set changes.
  This is an immutability change only.
- Fingerprint values must be byte-identical before and after. Freezing must not
  perturb `canonicalize`/`stableV2Json` ordering or output.

## Acceptance Criteria

- [ ] Every exported decoder's output is transitively frozen: nested objects,
      arrays, and array members.
- [ ] Mutation-resistance tests prove it — attempting to mutate a nested field,
      an array, and an object inside an array all fail to take effect.
- [ ] A single shared deep-freeze helper is used; no per-call-site hand-freezing.
- [ ] Intentionally-unfrozen returns are enumerated with their reason, and each
      is either preserved or its change justified.
- [ ] All existing fingerprints are unchanged — a decoded fixture produces the
      same `*Fingerprint` before and after.
- [ ] Full gate green: `npm test`, `npm run test:coverage`, `npm run check`,
      `npm run validate:metadata`, `npm run validate:ci-parity`.

## Affected Files

- `src/protocol-v2.js` (27 freeze sites; builders at `:410`, `:469`, `:1084`;
  intentional unfrozen returns at `:1211`, `:1324`)
- `src/retention-policy.js` (28 freeze sites)
- `test/protocol-v2.test.js`, `test/retention-policy.test.js` (9 existing
  top-level `Object.isFrozen` assertions to extend)

## Out of Scope

- Changing any contract's field set, validation rules, or error messages.
- Revisiting the forbidden-field walker or the privacy boundary.
- Freezing anything outside the two contract modules.
