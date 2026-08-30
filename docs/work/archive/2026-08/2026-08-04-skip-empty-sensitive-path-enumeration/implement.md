# Implement — Skip PR file enumeration when no sensitive paths are configured (A-014)

## Ordered checklist

1. **Add tests first**:
   - `test/action.test.js` (standalone, via `createHarness`):
     - `auto routing without sensitive paths skips file enumeration`: event
       `{ action: "opened", pull_request: basePullRequest }`, no
       `INPUT_SENSITIVE-PATHS`. Assert `harness.calls.listPullRequestFiles === 0`
       and `result.decision.route` is a routed value (e.g. `"cheap"`). Use the
       `listError` harness override to prove no fetch is attempted:
       `createHarness({ listError: new Error("should not list files") })`.
     - A companion assertion already exists at test/action.test.js:196-200
       (sensitive pattern → `listPullRequestFiles === 1`); no change needed, but
       reference it as the "still fetches when configured" proof.
   - `test/operations.test.js` (durable): a `route: "auto"` request with no
     `INPUT_SENSITIVE-PATHS` must not call `listPullRequestFiles`. Assert the
     fake client's `calls` contains no `["listPullRequestFiles", ...]` entry.
   Run the targeted files — the standalone `listError` test is RED pre-fix
   (fetch throws), durable test RED pre-fix (call recorded).

2. **Apply the fix** (see design.md):
   - `src/index.js`: change the `files` gate from `needsSensitivePathEvaluation`
     to `patterns.length > 0`.
   - `src/operations.js`: hoist `const sensitivePaths = parseList(input(
     "sensitive-paths", "", env))` above the `files` fetch, gate the fetch with
     `request.route === "auto" && sensitivePaths.length > 0`, and pass the hoisted
     `sensitivePaths` into `buildRiskContext`.

3. **Re-run targeted**: `node --test test/action.test.js test/operations.test.js`
   — all green.

4. **Full suite**: `npm test` — expect 229 baseline + new tests, 0 failures.

5. **Full gate**: `npm run check:full` — 0 failures (plus the expected changed
   Trellis-task-directory WARN).

## Validation commands

```bash
node --test test/action.test.js test/operations.test.js
npm test
npm run check:full
```

## Review gate

- Confirm the design.md matrix: the only changed cells are auto+empty-policy in
  both entrypoints (fetch dropped); every configured-pattern path still fetches;
  route and `sensitive-files` outputs unchanged.

## Rollback point

- Single-commit fix across two source files + added tests. Rollback = `git
  revert`. No state/schema migration.

## Finish steps

- Set `.trellis/audit/ledger.md` A-014 → `fixed` with verification note, owner
  reassigned to `08-04-skip-empty-sensitive-path-enumeration`; add the child
  reference to the parent PRD child map.
