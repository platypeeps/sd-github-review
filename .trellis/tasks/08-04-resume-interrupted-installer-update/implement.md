# Implement — Resume installer updates interrupted before workflow replacement (A-013)

## Ordered checklist

1. **Add failing + lock tests first** in `test/consumer-installer.test.js`
   (reuses `makeSource(workflow)`, `makeTarget`, `runConsumerInstaller`,
   `readManifest`, `FakeGitHub`, `sha256Hex`):

   - `resumes an update interrupted before the workflow was replaced (A-013)`:
     1. `install` with `sourceV1 = makeSource("name: managed v1\n")` → active.
     2. Craft the interrupted state: read the manifest, set `state = "pending"`,
        set `workflow.sha256` and `source.sha256` to `sha256Hex("name: managed v2\n")`,
        write it back. Leave the on-disk workflow as v1.
     3. `update` with `sourceV2 = makeSource("name: managed v2\n")`.
     4. Assert manifest ends `active`, `workflow.sha256 === sha256Hex(v2)`,
        on-disk workflow equals the v2 content.
     Pre-fix this REJECTS with `/modified after installation/u`.

   - `active install still rejects an operator-modified workflow (A-013 lock)`:
     1. `install` with a source → active.
     2. Overwrite the on-disk workflow with operator bytes.
     3. `await assert.rejects(update..., /modified after installation/u)`.
     GREEN both before and after (guard for active is unchanged).

   Run `node --test test/consumer-installer.test.js` — first RED, second GREEN.

2. **Apply the fix** in `scripts/consumer-installer.mjs`
   `assertWorkflowCanBeManaged`: add `local.manifest.state !== "pending"` as a
   conjunct to the `sha256(local.workflow) !== local.manifest.workflow.sha256`
   guard (see design.md). Do not touch `decodeManifest` or the manifest schema.

3. **Re-run targeted**: `node --test test/consumer-installer.test.js` — both new
   tests GREEN.

4. **Full suite**: `npm test` — expect 227 baseline + 2 = 229, 0 failures.

5. **Full gate**: `npm run check:full` — expect 0 failures (the WARN for changed
   Trellis task directories is expected and acceptable).

## Validation commands

```bash
node --test test/consumer-installer.test.js   # targeted: 2 tests
npm test                                       # full suite, no regressions
npm run check:full                             # gate: 0 failures
```

## Review gate

- Confirm the behavior matrix in design.md: only the pending+differ cell flips
  to resume; the active+differ cell still throws (locked by the second test).

## Rollback point

- Single-commit fix. Rollback = `git revert` (reverts the one-line guard change
  and the two added tests). No schema/state migration.

## Finish steps

- Set `.trellis/audit/ledger.md` A-013 → `fixed` with verification note and owner
  reassigned to `08-04-resume-interrupted-installer-update`, after the suite and
  gate pass. Add the child reference to the parent PRD child map.
