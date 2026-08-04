# Implement — Apply route-control precedence before label parsing (A-011)

## Ordered checklist

1. **Add failing regression tests first** in `test/action.test.js` (drives
   `runAction` through the existing `createHarness`):
   - `fixed mode routes despite conflicting review labels`:
     `env: { INPUT_MODE: "deep" }`, harness `pullRequest` override with
     `labels: [{ name: "review:cheap" }, { name: "review:copilot" }]`, event
     `{ action: "opened", pull_request: <override> }`.
     Assert `result.decision.route === "deep"` (no throw).
   - `trusted command routes despite conflicting review labels`:
     `eventName: "issue_comment"`, comment `/review deep` from a `MEMBER`,
     harness `pullRequest` override carrying the same conflicting labels.
     Assert `result.decision.route === "deep"` (no throw).
   - `auto mode with conflicting labels still throws`:
     no `INPUT_MODE`, event `opened` with conflicting labels.
     `await assert.rejects(harness.run({...}), /conflicting review labels/u)`.
   Run `node --test test/action.test.js` — first two RED (throw), third GREEN.

2. **Apply the fix** in `src/index.js` (see design.md): move the
   trusted-command resolution block (currently ~lines 201-215:
   `trustedAssociations`, `commandIsTrusted`, `commandMode`) above the label
   parse, then replace the eager `const labelMode = modeFromLabels(labels)` with:
   ```js
   const higherPrecedenceMode = configuredMode !== "auto" ? configuredMode : commandMode;
   const labelMode = higherPrecedenceMode ? null : modeFromLabels(labels);
   ```
   Keep `labels` computed before the block (needs `pullRequest`). Do not touch
   `src/normalize.js`.

3. **Re-run the targeted test**: `node --test test/action.test.js` — all three
   now GREEN.

4. **Full suite**: `npm test` — expect 224 baseline + 3 new = 227, 0 failures.

5. **Metadata/parity gates** (cheap, catch collateral): `npm run check:full`
   (or at minimum `npm test`).

## Validation commands

```bash
node --test test/action.test.js      # targeted: 3 new tests green
npm test                             # full suite, no regressions
```

## Review gate

- Confirm behavior matrix in design.md holds: only the two buggy cells flip to
  routing; the auto+conflict cell still throws; all non-conflict routes
  unchanged.
- Confirm `test/router.test.js` (the `modeFromLabels` throw contract) is
  untouched and still passes.

## Rollback point

- Single-commit fix. Rollback = `git revert` the fix commit (reverts
  `src/index.js` + the added `test/action.test.js` cases). No data/state
  migration involved.

## Finish steps

- Set `.trellis/audit/ledger.md` A-011 status → `fixed` with verification note
  and owner reassigned to `08-04-apply-control-precedence-before-labels` (only
  after the suite passes), mirroring the A-001/A-004 ledger updates.
