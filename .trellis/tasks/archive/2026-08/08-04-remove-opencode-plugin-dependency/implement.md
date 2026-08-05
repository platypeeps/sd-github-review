# Implement — Remove unlocked unused OpenCode plugin dependency (A-016)

## Ordered checklist

1. **Add the hygiene-lock test first** in `test/metadata.test.js`:
   - `the nested OpenCode package declares no unlocked runtime dependency (A-016)`:
     read `../.opencode/package.json`, assert
     `Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })` is empty.
   Run `node --test test/metadata.test.js` — RED pre-fix (declares
   `@opencode-ai/plugin`).

2. **Apply the fix**: replace `.opencode/package.json` contents with
   `{ "type": "module" }` (removes the unused dependency; types the ESM plugin
   files). Keep the file present.

3. **Re-run targeted**: `node --test test/metadata.test.js` — GREEN.

4. **Confirm no importer remains** (sanity): `grep -rn "@opencode-ai/plugin"
   .opencode/` returns nothing (only docs reference it).

5. **Full suite**: `npm test` — expect 232 baseline + 1 = 233, 0 failures.

6. **Full gate**: `npm run check:full` — 0 failures (plus expected changed
   Trellis-task-directory WARN).

## Validation commands

```bash
node --test test/metadata.test.js
grep -rn "@opencode-ai/plugin" .opencode/   # expect: no matches
npm test
npm run check:full
```

## Verification limits

- OpenCode plugin loading is not exercised (external runtime). The in-repo
  checks above (dependency removed, no importer, valid JSON, suite + gate green)
  are what this task verifies; the OpenCode-runtime smoke is an operator check.

## Rollback point

- Single-commit change to one config file + one test. Rollback = `git revert`.

## Finish steps

- Set `.trellis/audit/ledger.md` A-016 → `fixed` with verification note (naming
  the external OpenCode-loading gap), owner reassigned to
  `08-04-remove-opencode-plugin-dependency`; add the child reference to the
  parent PRD child map.
