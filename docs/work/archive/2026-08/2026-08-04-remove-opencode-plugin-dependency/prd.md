---
title: Remove unlocked unused OpenCode plugin dependency (A-016)
status: done
created: 2026-08-04
---
# Remove unlocked unused OpenCode plugin dependency (A-016)

## Goal

Close audit finding A-016 so the `.opencode` runtime carries no unlocked,
unaudited nested dependency.

## Audit Finding

- ID: A-016 · severity P2 · effort S · confidence Plausible · dimension dependencies
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: OpenCode plugin dependency is unlocked and apparently unused.
  Executable dependency code can drift outside root locking and auditing.

## Evidence Boundary

- `.opencode/package.json:2` — declares `@opencode-ai/plugin: "^1.14.39"` with a
  version range and no committed lockfile (`.opencode/` has no
  `package-lock.json` / `node_modules`).
- `.opencode/package.json:4` — no code references the package.

Confirmed on main @ HEAD (2026-08-04): a repo-wide search for
`@opencode-ai/plugin` / `opencode-ai` finds the string only in
`.opencode/package.json` itself and in audit/task documents. The three plugin
modules (`.opencode/plugins/*.js`) import only Node built-ins (`fs`, `path`) and
local `../lib/*.js`; none import the package. The root `package.json` is
`"type": "module"`, but `.opencode/package.json` declares no `type`, so under
plain Node the ESM `import` syntax in those `.js` files would resolve as
CommonJS.

## Requirements

- The `@opencode-ai/plugin` dependency declaration is removed; no unlocked
  ranged nested dependency remains in `.opencode/package.json`.
- The `.opencode` plugin modules remain valid ES modules: replace the file
  contents with `{"type":"module"}` so Node resolves the `import` syntax those
  files use as ESM (strictly more correct than today; aligns with the root).
- No new runtime dependency is introduced.

## Acceptance Criteria

- [x] `.opencode/package.json` declares no runtime/dev dependencies.
- [x] A test proves the nested OpenCode package carries no unlocked dependency
      (guards against reintroducing a ranged nested dep with no lockfile).
- [x] Full suite green (baseline 232/232 after A-015; new test on top → 233/233).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-016 set to fixed only after verification;
      owner reassigned to this dedicated child.

## Verification Limits

- OpenCode plugin *loading* cannot be exercised in this repo's Node test harness
  (it needs the OpenCode runtime, an external tool not runnable here). Verified
  here: the dependency is removed, no importer exists, the JSON is valid ESM
  metadata, and the full suite + gate stay green. The OpenCode-runtime smoke is
  an external check left to the operator; the change only removes an unused
  declaration and adds a correct `type`, so plugin discovery by directory
  convention is not expected to change.

## Out of Scope

- Command-pack-wide dependency policy (this task owns only the nested
  `.opencode` runtime dependency).
- Any change to plugin behavior or the `.opencode/lib` modules.
