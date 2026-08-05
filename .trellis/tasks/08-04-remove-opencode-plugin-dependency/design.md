# Design — Remove unlocked unused OpenCode plugin dependency (A-016)

## Current state

`.opencode/package.json`:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.14.39"
  }
}
```

- No lockfile, no `node_modules` under `.opencode/`.
- No importer: `.opencode/plugins/*.js` import only `fs`, `path`, and local
  `../lib/*.js`.
- No `"type"` field, while root `package.json` is `"type": "module"` and the
  plugin files use ESM `import`.

## Fix

Replace the file contents with:

```json
{
  "type": "module"
}
```

- Removes the unlocked, unused `@opencode-ai/plugin` declaration → resolves
  A-016 (no ranged nested dependency, so no missing lockfile to worry about).
- Adds `"type": "module"` so plain-Node resolution of `.opencode/**/*.js`
  matches the `import` syntax those files already use — strictly more correct
  than the current no-`type` state, and consistent with the repo root.
- Keeps a `package.json` present so OpenCode's directory recognition (if it
  relies on the file existing) is preserved; only the dependency set changes.

## Regression lock

Add a test (in `test/metadata.test.js`) asserting `.opencode/package.json`
declares no runtime or dev dependencies. This fails if a future change
reintroduces a ranged nested dependency without a committed lockfile.

## Blast radius

- One config file: `.opencode/package.json`.
- One test added.
- No `src/` or `scripts/` change; no build/runtime code path reads this file in
  the Node test harness.

## Verification limits

- OpenCode plugin loading uses the external OpenCode runtime and cannot be
  exercised here. Verified in-repo: dependency removed, no importer, valid ESM
  metadata JSON, suite + gate green. The runtime smoke is an operator check.

## Compatibility / rollback

- Removing an unused declaration and adding a correct `type` is behavior-neutral
  for Node consumers; OpenCode discovery is by directory convention.
- Rollback = restore the prior `.opencode/package.json` and drop the test.
