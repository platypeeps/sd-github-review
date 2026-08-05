# Implement — Remove unreachable hasManagedFiles export (A-021)

## Ordered checklist

1. **Add the surface-lock test first** in `test/consumer-installer.test.js`:
   - `the installer does not export the unreachable hasManagedFiles helper
     (A-021)`: `import * as installer` from the module, assert
     `"hasManagedFiles" in installer` is `false`.
   Run `node --test test/consumer-installer.test.js` — RED pre-fix (symbol
   still exported).

2. **Apply the fix**: delete two functions from `scripts/consumer-installer.mjs`:
   - the `export async function hasManagedFiles(...)` block (definition + body);
   - the now-orphaned private helper `async function pathExists(filePath)`
     (`consumer-installer.mjs:386-394`) — its only callers were the two
     `hasManagedFiles` lines. Leave `readOptional` and all other helpers intact.

3. **Re-run targeted**: `node --test test/consumer-installer.test.js` — GREEN.

4. **Confirm no orphan / no importer** (sanity):
   `grep -rn "hasManagedFiles\|pathExists" scripts/ src/ test/` returns no
   matches, and `grep -c "readFile" scripts/consumer-installer.mjs` stays > 0
   (still used by `readOptional`).

5. **Full suite**: `npm test` — expect 233 baseline + 1 = 234, 0 failures.

6. **Full gate**: `npm run check:full` — 0 preflight failures.

## Validation commands

```bash
node --test test/consumer-installer.test.js
grep -rn "hasManagedFiles" scripts/ src/ test/   # expect: no matches
npm test
npm run check:full
```

## Verification limits

- Pure dead-code deletion with no call sites; the regression test plus the full
  installer suite fully cover the change. No external runtime gap.

## Rollback point

- Single-commit change to one script + one test. Rollback = `git revert`.

## Finish steps

- Set `.trellis/audit/ledger.md` A-021 → `fixed` with verification note; owner
  reassigned to `08-04-remove-unused-installer-export`; add the child reference
  to the parent PRD child map.
