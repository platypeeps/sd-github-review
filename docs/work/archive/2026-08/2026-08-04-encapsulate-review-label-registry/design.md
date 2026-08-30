# Design — Encapsulate mutable review-label registry (A-020)

## Current state

`src/normalize.js:101`:

```js
export const reviewLabels = new Set(["review:auto", ...EXPLICIT_LABELS.keys()]);
```

- `EXPLICIT_LABELS` (`normalize.js:10`) maps `review:cheap|deep|copilot|none`
  to routes; the exported set adds `review:auto`.
- The `Set` is exported by reference, so any importer can `.add`/`.delete`/
  `.clear` it and mutate label routing for the whole process.

Consumers (repo-wide, all read-only):

- `src/index.js:170,227,260` — `reviewLabels.has(eventLabel)` → `isRelevantLabelEvent`.
- `test/consumer-installer.test.js:182` — parity: `new Set(ROUTING_LABELS.map(...))`
  deep-equals `reviewLabels`.

## Why not just freeze the Set

`Object.freeze(set)` does **not** prevent `set.add()/delete()/clear()` — freeze
only locks own properties, not a `Set`'s internal `[[SetData]]`. A frozen `Set`
is still mutable, so freezing is not a real fix. Overriding the mutator methods
on the instance is bypassable via `Set.prototype.add.call(set, …)`. The audit's
first suggestion — a predicate — removes the mutable reference entirely, so it
is the robust choice.

## Fix

In `src/normalize.js`, keep the label set **module-private** and expose only a
predicate plus a frozen enumeration:

```js
const reviewLabelSet = new Set(["review:auto", ...EXPLICIT_LABELS.keys()]);

export function isReviewLabel(label) {
  return reviewLabelSet.has(label);
}

// Frozen array for callers that must enumerate the canonical label names
// (e.g. installer↔router parity). Strings are immutable; freezing blocks
// add/reorder. No mutable collection escapes the module.
export const reviewLabelNames = Object.freeze([...reviewLabelSet]);
```

Remove `export const reviewLabels`. The set stays single-sourced from
`EXPLICIT_LABELS` + `review:auto`.

### Consumer updates

- `src/index.js`: import `isReviewLabel` instead of `reviewLabels`; the three
  `reviewLabels.has(eventLabel)` calls become `isReviewLabel(eventLabel)` —
  identical membership result.
- `test/consumer-installer.test.js`: import `reviewLabelNames`; the parity test
  compares `new Set(ROUTING_LABELS.map(({ name }) => name))` with
  `new Set(reviewLabelNames)` (same set of names, no mutable export needed).

## Regression lock

Add to `test/router.test.js` (which already imports from `normalize.js`):

1. Namespace-import `normalize.js`; assert `"reviewLabels" in normalize === false`
   (the mutable `Set` export is gone).
2. `isReviewLabel("review:auto")` and each `review:cheap|deep|copilot|none` are
   `true`; a non-label (`"review:bogus"`, `"random"`) is `false`.
3. `Object.isFrozen(reviewLabelNames) === true`, and mutating it
   (`reviewLabelNames.push("x")`) throws — proving no mutable registry escapes.

## Blast radius

- `src/normalize.js`: one export replaced by two (predicate + frozen array),
  set made private. No behavior change.
- `src/index.js`: import + three call sites, membership semantics unchanged.
- `test/consumer-installer.test.js`: import + parity assertion updated to the
  new surface.
- `test/router.test.js`: regression lock added.
- No routing-decision, protocol, or workflow change.

## Verification limits

- Entirely in-process. Unit tests cover membership, parity, and immutability;
  there is no external-runtime gap.

## Compatibility / rollback

- `reviewLabels` had no external (published) consumer; the only importers are in
  this repo and are migrated in the same change, so removing it is not a runtime
  break.
- Rollback = restore the `reviewLabels` export and revert the consumers/tests.
