# Make REVIEW_ROUTE_MODE an installer-managed variable — Implementation Plan

One repository, one pull request. Everything lands in
`platypeeps/sd-github-review`; nothing upstream in the command pack is involved.

Branch from clean `main`: `task/installer-managed-route-mode`.

## Execution Order

### Stage A — bind the value set before anything can consume it

1. **Add the constant and the drift test, test first.** In `codecs.mjs`:

   ```js
   export const ROUTE_MODES = Object.freeze(["auto", "cheap", "deep", "copilot", "none"]);
   ```

   Then write the binding test in `test/consumer-installer.test.js` (design,
   "Drift binding"): read `examples/pr-agent-router.yml`, extract the `case
   "$REVIEW_ROUTE_MODE" in` pattern line, split on `|`, assert set equality with
   `ROUTE_MODES`; assert each mode also appears in the invalid-value error text.

   Prove the test is load-bearing before continuing: temporarily drop `none`
   from `ROUTE_MODES` and confirm the test fails naming it, then restore. A
   drift test that has never failed has not been shown to detect drift.

   This is acceptance criterion 4 and it is independent of every later stage.

### Stage B — schema tier

2. **Bump the schema with its tier constant.** In `codecs.mjs`:
   `MANIFEST_SCHEMA_VERSION = 4`, `SUPPORTED_MANIFEST_SCHEMA_VERSIONS` gains
   `4`, add `ROUTE_MODE_MIN_SCHEMA_VERSION = 4`, and extend the requirement
   matrix comment at `:126-138` with the new column.

3. **Version-gate the managed-variable set.** Split `CONFIG_VARIABLES` into the
   legacy three and the current four, add `configVariablesForSchema()`, and use
   it for **both** the name-set equality check and the value cross-check loop
   (`:299-310`). Do not gate on `=== MANIFEST_SCHEMA_VERSION` — spec
   `:340-353` forbids it and the reason applies verbatim here.

4. **Fix `check`'s migration ladder** (`consumer-installer.mjs:434-439`) into one
   branch per tier, with the new route-mode message. Verify by decoding a
   schema-3 fixture and asserting the message names route-mode management and
   **not** the durable review lane — the wrong-message defect is silent, so it
   needs an explicit assertion rather than a passing suite.

   The fixture already exists: `test/installer-modules.test.js:68-115` builds
   manifests with `manifestBody(schemaVersion)` under `>= 2` / `>= 3` tiers and
   loops "schema N must decode as itself" over the supported versions. Add the
   `>= 4` tier there and let the existing loop cover schema 4, rather than
   writing a standalone fixture that drifts from the tiers it is meant to model.

   Checkpoint: `npm test` must be green here, with no behaviour change yet
   beyond the migration message. Every existing schema-3 manifest still decodes.

### Stage C — manage the variable

5. **Add the configuration field.** `CONFIG_VARIABLES` gains
   `REVIEW_ROUTE_MODE: "routeMode"`. In `validateConfiguration`, validate
   `routeMode` against `ROUTE_MODES` when required/present, and append it as the
   **last** key of the return literal — see the design's key-order trap; getting
   this wrong makes every schema-4 install report configuration drift against
   itself.

6. **Make `variableValues()` omit undefined fields**, so a pre-schema-4 manifest
   manages three variables instead of reporting a phantom missing one.

7. **Add `resolveRouteMode({ optionValue, manifestValue, observedValue })`** to
   `codecs.mjs` implementing the four-step chain, including the two error paths:
   nothing to resolve, and an existing-but-invalid repository value. Unit-test
   it directly — it is pure and needs no fake GitHub.

8. **Wire it in the orchestrator**, which holds `target.snapshot.variables`:
   resolve the route mode, then pass it into `resolveConfiguration` as
   `options.routeMode`. Apply to `install`, `update`, and `adopt` in full.

   `check` is deliberately weaker on both ends: it must not *error* when nothing
   resolves, since checking an un-migrated or uninstalled consumer is a
   legitimate read, and it must not fold a resolved route mode into the compared
   configuration unless the manifest is already schema 4 or the operator passed
   `--route-mode`. Doing otherwise makes every schema-3 consumer report a
   configuration mismatch on top of its migration issue — see the design's
   problem 3.

9. **CLI surface.** `parseArguments` gains `--route-mode`; the uninstall
   rejection at `codecs.mjs:497-499` extends to it ("uninstall does not accept
   provider, model, or route options"); `HELP` gains the flag under
   "Install/update/check configuration" with its accepted values and the note
   that install requires it.

### Stage D — evidence

10. **Acceptance tests**, one per criterion, in `test/consumer-installer.test.js`:
    - install on a fresh consumer writes `REVIEW_ROUTE_MODE` and records it
      owned in the manifest (criterion 1);
    - delete the variable from the fake GitHub after a successful install, then
      `check` reports an issue **naming `REVIEW_ROUTE_MODE`** (criterion 2);
    - `uninstall` deletes an installer-created variable, and a second fixture
      whose variable pre-existed the install is preserved and never appears in
      the delete actions (criterion 3);
    - a schema-3 manifest fixture still decodes, reports the route-mode
      migration issue **without** also reporting a configuration mismatch, and
      converges to schema 4 on `update` while recording the pre-existing
      repository value as unowned. Follow the existing schema-2 migration test
      at `test/consumer-installer.test.js:1826-1861`, which already sets
      `manifest.schemaVersion = 2` and asserts the migrated result equals
      `MANIFEST_SCHEMA_VERSION`; the schema-3 case is the same shape one tier up.

    Existing install tests that rely on `DEFAULT_CONFIG` now need an explicit
    `routeMode`. That churn is expected and is the signal, not an obstacle:
    every call site it touches is a place where a route would otherwise have
    been chosen for the operator.

11. **Verify against this repository**, which is itself a consumer with a
    hand-set variable: `node scripts/install-consumer.mjs check --target .` and
    the same with `update --dry-run`. Expected: the route-mode migration issue
    before, and a dry-run plan that records the existing value as unowned with
    **no `set-variable` action** for it. Record the actual output; do not assert
    the expectation.

### Stage E — documentation

12. **Spec sweep.** `.trellis/spec/backend/consumer-installer.md` names its own
    blast radius at `:131-139` — that entry, the README install call-out, and the
    install/check/uninstall descriptions above it. Also update the schema matrix
    at `:96-107`, the "rewrites each to schema 3" sentence at `:282`, and the
    schema-3 descriptor-presence example at `:518-520`. Enumerate with
    `grep -n "schema 3\|REVIEW_ROUTE_MODE" .trellis/spec/backend/consumer-installer.md`
    rather than from this list — a list written now is stale by the time it is
    checked.

13. **README.** The call-out at `:59-69` tells operators to set the variable by
    hand after installing. It becomes the `--route-mode` flag, with the manual
    `gh variable set` retained only as the pre-existing/adopt path.

13b. **Make the documented half of the sweep a test, not a habit.** Steps 12–13
    are a manual pass, and a manual pass over prose is the part of this stage
    that silently stops happening. Add a test that enumerates tracked Markdown
    outside `.trellis/` from `git ls-files`, rejoins shell line continuations,
    and fails any `install-consumer.mjs install` invocation without a valid
    `--route-mode`. Prove it load-bearing by stripping the flag from one README
    invocation before trusting it.

14. **Ship** through `sd-ship until=merge`.

## Validation Plan

| # | Command | Expected |
|---|---------|----------|
| 1 | `npm test` | all pass; run at the stage-B checkpoint and again at the end |
| 2 | Stage A step 1 negative check: drop `none` from `ROUTE_MODES`, rerun `npm test` | the drift test **fails** naming `none`; restore and rerun green |
| 3 | Stage B step 4 assertion on a schema-3 fixture | migration issue names route-mode management, not the durable review lane |
| 4 | `npm run validate:metadata` | passes (PRD criterion 6) |
| 5 | `npm run validate:ci-parity` | passes (PRD criterion 6) |
| 6 | `npm run check:full` | exit 0; whole-gate green including coverage |
| 7 | `node scripts/install-consumer.mjs check --target .` | before: route-mode migration issue. after `update`: healthy, with `REVIEW_ROUTE_MODE` recorded `owned: false` |

Checks 2 and 3 are the decisive ones. Check 1 passing proves the suite is green;
only 2 and 3 prove the two silent failure modes this design exists to prevent are
actually detected — a drift test that cannot fail, and a migration message that
lies about which migration is needed.

Check 7 is the only one exercising a real manifest against real GitHub state;
everything else runs against the fake. Its `owned: false` is the whole of
acceptance criterion 3's "preserves a pre-existing one" on live data.

## Documentation And Spec Updates

- `.trellis/spec/backend/consumer-installer.md` — schema matrix, the
  unmanaged-variable entry, install/check/uninstall descriptions, and the two
  stale "schema 3" references (criterion 5).
- `README.md` — install call-out.
- `HELP` in `codecs.mjs` — the flag is user-facing surface, not a comment.
- This task's `prd.md` acceptance boxes, checked only against real output.

## Review Notes

Worth stating in the PR body, because each is a place a reviewer will reasonably
push back:

- **The schema bump is not bookkeeping.** Without the version gate, a
  four-key `CONFIG_VARIABLES` makes every schema-3 manifest throw on decode,
  which would take out `check` on every installed consumer at once.
- **Install gains a required flag.** That is a deliberate UX regression chosen
  over silently picking a billing-capable route; the alternatives considered are
  recorded in `design.md`.
- **No consumer's variable value changes** unless an operator passes
  `--route-mode`. Migration adopts what is already set, unowned.
- **The lane's fail-closed gate is untouched.** This is a second line of
  defence, per the PRD's fourth requirement.

## Rollback Points

- After stage A: pure addition — a constant and a test. Revert is a file-level
  revert with no consumer impact.
- After stage B: this is the first point at which a schema-4 manifest can be
  written, because `createManifest` stamps `MANIFEST_SCHEMA_VERSION`
  unconditionally (`plan.mjs:178`) and the constant is now 4. Reverting is still
  free as long as no non-dry-run `install`/`update` has run against a real
  consumer; past that point the rollback below applies.
- After stage C/D: a consumer that ran `update` holds a schema-4 manifest that a
  reverted decoder will not read. Reverting then requires reverting the manifest
  with the code, or one `install` re-run. This is the only step with a
  non-file-local rollback and is why stage B ends with a checkpoint.
- Stage E is documentation and reverts freely.

## Follow-Ups

Explicitly outside this pull request:

- `08-08-fleet-rollout-smoke` — the rollout that makes the missing detection
  matter at scale. The PRD sequences this task first; it does not absorb it.
- Bringing the durable lane's own configuration under the same ownership model,
  if it ever grows a repository-variable input. It has none today.
