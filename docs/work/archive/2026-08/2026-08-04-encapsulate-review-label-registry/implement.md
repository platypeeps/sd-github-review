# Implement — Encapsulate mutable review-label registry (A-020)

## Ordered checklist

1. **Add the regression lock first** in `test/router.test.js`:
   - `the review-label registry is immutable and not exported as a Set (A-020)`:
     - namespace-import `* as normalize from "../src/normalize.js"`; assert
       `"reviewLabels" in normalize` is `false`;
     - assert `normalize.isReviewLabel` is a function; `isReviewLabel` is `true`
       for `review:auto|cheap|deep|copilot|none`, `false` for `"review:bogus"`;
     - assert `Object.isFrozen(normalize.reviewLabelNames)` and that
       `normalize.reviewLabelNames.push("x")` throws.
   Run `node --test test/router.test.js` — RED pre-fix (`reviewLabels` still
   exported as a Set; `isReviewLabel`/`reviewLabelNames` undefined).

2. **Apply the normalize.js change**: replace
   `export const reviewLabels = new Set([...])` with a private
   `const reviewLabelSet = new Set(["review:auto", ...EXPLICIT_LABELS.keys()])`,
   `export function isReviewLabel(label)` returning `reviewLabelSet.has(label)`,
   and `export const reviewLabelNames = Object.freeze([...reviewLabelSet])`.

3. **Migrate `src/index.js`**: change the import `reviewLabels` → `isReviewLabel`;
   replace the three `reviewLabels.has(eventLabel)` calls with
   `isReviewLabel(eventLabel)`.

4. **Migrate `test/consumer-installer.test.js`**: change the import
   `reviewLabels` → `reviewLabelNames`; update the parity test to compare
   `new Set(ROUTING_LABELS.map(({ name }) => name))` with
   `new Set(reviewLabelNames)`.

5. **Re-run targeted**: `node --test test/router.test.js` and
   `node --test test/consumer-installer.test.js` — GREEN.

6. **Confirm no stale reference**:
   `grep -rn "reviewLabels\b" src/ test/ scripts/` returns only
   `reviewLabelNames` uses (no bare `reviewLabels` export/import remains).

7. **Full suite**: `npm test` — 0 failures (234 baseline + 1 new test = 235).

8. **Full gate**: `npm run check:full` — whitespace clean, preflight 0 failures.

## Validation commands

```bash
node --test test/router.test.js
node --test test/consumer-installer.test.js
grep -rn "reviewLabels\b" src/ test/ scripts/   # expect: only reviewLabelNames
npm test
npm run check:full
```

## Verification limits

- In-process API-surface change; unit tests fully cover membership, parity, and
  immutability. No external-runtime gap.

## Rollback point

- One src module + one src consumer + two test files. Rollback = `git revert`.

## Finish steps

- Set `.trellis/audit/ledger.md` A-020 → `fixed` with verification note; owner
  reassigned to `08-04-encapsulate-review-label-registry`; add the child
  reference to the parent PRD child map.
