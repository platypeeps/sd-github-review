# Apply route-control precedence before label parsing (A-011)

## Goal

Close audit finding A-011 so a fixed configured mode or a trusted `/review`
command can route a pull request even when that PR carries two conflicting
`review:*` labels — instead of the whole run throwing on the label conflict.

## Audit Finding

- ID: A-011 · severity P2 · effort S · confidence Plausible · dimension correctness
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: Lower-priority label conflicts can block fixed modes and trusted
  commands. Conflicting review labels throw before higher-priority controls run,
  so fixed mode and trusted commands cannot recover.

## Evidence Boundary

- `src/index.js:200` — `modeFromLabels(labels)` is called (and can throw) before
  `commandMode` is resolved (`src/index.js:215`) and before
  `resolveExplicitMode` applies precedence (`src/index.js:225`).
- `src/normalize.js:62` — `modeFromLabels` throws `conflicting review labels
  select multiple routes` whenever more than one explicit route label is present.
- Why: label parsing is unconditional and eager. `resolveExplicitMode`
  (`src/normalize.js:97`) already gives `configuredMode` (fixed) and
  `commandMode` (trusted command) precedence over `labelMode`, so in those cases
  the label value is discarded anyway — but the eager throw pre-empts that
  precedence and fails the run before the higher control is consulted.

Confirmed on main @ HEAD (2026-08-04): the only caller of `modeFromLabels` is
`src/index.js:200`. `modeFromLabels` is also unit-tested to throw on conflict
(`test/router.test.js:111`) — that contract stays; the fix is to stop *calling*
it when a higher-precedence control already resolves the route.

## Requirements

- When `configuredMode` is a fixed route (not `auto`), a PR carrying two or more
  conflicting `review:*` labels MUST route via the fixed mode, not throw.
- When a trusted `/review <mode>` command is present, a PR carrying two or more
  conflicting `review:*` labels MUST route via the command mode, not throw.
- When no higher-precedence control resolves the route (auto mode, no trusted
  command), conflicting labels MUST still throw — genuine ambiguity with no
  override stays a hard error (no silent misroute).
- The resolved route for every non-conflicting case (single label, no label,
  fixed mode, trusted command) MUST be unchanged from current behavior.

## Acceptance Criteria

- [x] A test proves: fixed `mode` input + PR with two conflicting `review:*`
      labels → run routes via the fixed mode, no throw. (`test/action.test.js`
      "fixed mode routes despite conflicting review labels (A-011)".)
- [x] A test proves: trusted `/review <mode>` command + PR with two conflicting
      `review:*` labels → run routes via the command mode, no throw.
      (`test/action.test.js` "trusted command routes despite conflicting review
      labels (A-011)".)
- [x] A test proves: auto mode + no trusted command + two conflicting labels →
      still throws `conflicting review labels`. (`test/action.test.js` "auto mode
      with conflicting review labels still throws (A-011)".)
- [x] `modeFromLabels` unit contract (`test/router.test.js:111`) still passes
      unchanged.
- [x] Full suite green (baseline 224/224 → 227/227 with 3 new tests; check:full
      0 failures).
- [x] `.trellis/audit/ledger.md` A-011 set to fixed after verification, per the
      parent epic rule; owner reassigned to this dedicated child.

## Out of Scope

- Standalone/durable protocol routing label handling beyond the action
  entrypoint (`src/index.js`); no other caller of `modeFromLabels` exists.
- Changing the `modeFromLabels` throw contract itself.
- Budget-aware review plan work in `07-25-authorize-budget-aware-review-plans`
  (the prior ledger owner for A-011).
