# Design — Remove unreachable hasManagedFiles export (A-021)

## Current state

`scripts/consumer-installer.mjs:1408`:

```js
export async function hasManagedFiles(target) {
  const root = path.resolve(target);
  return {
    manifest: await pathExists(path.join(root, MANIFEST_PATH)),
    workflow: await pathExists(path.join(root, WORKFLOW_PATH)),
  };
}
```

- Repo-wide grep for `hasManagedFiles` finds only this definition (plus
  audit/task docs). No test imports it; `runConsumerInstaller` and its
  lifecycle helpers never call it.
- `MANIFEST_PATH` (16 uses), `WORKFLOW_PATH` (18 uses), and `path` (26 uses)
  stay used by other installer code, so removing this function does not orphan
  them.
- **But `pathExists` (private helper, `consumer-installer.mjs:386-394`) is used
  only inside `hasManagedFiles` (lines 1411-1412).** Grep confirms exactly three
  occurrences: the definition plus the two calls in this function. Deleting only
  `hasManagedFiles` would leave `pathExists` as a new dead helper — trading one
  unreachable symbol for another and undercutting the A-021 bloat fix.

## Fix

Delete two things together:

1. `export async function hasManagedFiles(...)` (definition + body).
2. The now-orphaned private helper `async function pathExists(filePath)`
   (`consumer-installer.mjs:386-394`).

Nothing else changes: no call site, no re-export, no barrel file. `pathExists`
uses `readFile`, which stays used by `readOptional` (`consumer-installer.mjs:314,
753, 758`), so removing `pathExists` orphans nothing further. The lifecycle code
that needs presence/content checks already uses `readOptional` and reads the
manifest/workflow paths inline; it never called `pathExists`.

## Regression lock

Add a test that namespace-imports the installer
(`import * as installer from "../scripts/consumer-installer.mjs"`) and asserts
`"hasManagedFiles" in installer === false`. This fails RED today (symbol
present) and stays GREEN only while the dead export is absent, so a future
reintroduction of the unreachable helper trips the suite.

## Blast radius

- Two functions removed from `scripts/consumer-installer.mjs`: the exported
  `hasManagedFiles` and its sole-consumer private helper `pathExists`.
- One test added to `test/consumer-installer.test.js`.
- No `src/`, no workflow, no CLI-argument change; the installer's behavior is
  identical (neither function had a runtime call path).

## Verification limits

- Pure deletion of unreferenced code. The regression test and full installer
  suite cover it end to end; no external runtime is involved.

## Compatibility / rollback

- The symbol has no consumers, so removal is not a breaking change for any
  in-repo caller. (No published package re-exports the installer module.)
- Rollback = restore the function and drop the test.
