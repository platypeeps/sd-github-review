# Implement — close the two v0.5.0 defects the fleet reviewer found

Ordered so that every step is verifiable on its own and the fleet is never left
in a state where a lane can fail closed against a variable that is not set.

D1 and D2 are independent up to the release. D1 can land and merge on its own at
any point. D2 spans the action, the lane template, and the installer, and only
its final phase touches consumers.

Baseline: `0.5.0`, `main` at the tip. Target: `0.6.0`.

## Phase 0 — establish the baseline

- [ ] `npm run check:full` on a clean tree. Record the test count. Every later
      phase compares against this number, not against zero failures — a suite
      that shrinks silently passes just as well as one that grows.
- [ ] Confirm both descriptor copies are still byte-identical:
      `shasum -a256 contract/routed-review-setup-v1.json config/routed-review-setup-v1.json`
      → both `ea6f34bb…`.

**Rollback point.** Nothing changed yet.

## Phase 1 — D1, the descriptor gate

Gate before value, so the gate is seen failing against the real defect rather
than against a fixture. A gate first observed passing has proven nothing.

- [ ] Add the permission-union gate to `scripts/validate-action-metadata.mjs`.
      Both halves already exist in that file and neither needs re-reading: the
      descriptor is loaded and validated from `setupDescriptorPath`
      (line 26, read at line 255), and `laneDocuments()` (line 978) enumerates
      `.github/workflows` and `examples` from the filesystem so a lane added
      later reaches the gate without an edit here. Resolve the lane from the
      descriptor's own `workflow.path` basename; do not list lanes.
- [ ] Require **set equality** between the union and `requiredPermissions`, and
      make the failure message name the offending key and its direction
      (lane-requests-but-descriptor-omits, or the reverse).
- [ ] `npm run validate:metadata` — **must fail now**, naming `issues: write`.
      Quote that line into the task record. This is the only moment the gate can
      be proven against the genuine defect.
- [ ] Add `"issues": "write"` to `requiredPermissions` in
      `contract/routed-review-setup-v1.json`, then copy to
      `config/routed-review-setup-v1.json`.
- [ ] `npm run validate:metadata` — passes.
- [ ] `shasum -a256` both copies again — still identical, new digest.
- [ ] Mutation proof, both directions:
      - remove `issues: write` from the descriptor → gate fails;
      - add a permission no lane requests (`packages: write`) → gate fails.
      Revert both. A gate that only catches omission is half a gate.
- [ ] Unit test at the gate's own seam, following `R-008`'s shape in
      `test/metadata.test.js`: assert the thrown message, and assert the fixture
      genuinely carries the drift (`assert.notEqual(drifted, original)`) so a
      mis-anchored fixture cannot make the test vacuous.
- [ ] `npm run check:full`. Test count strictly greater than Phase 0.

**Review gate.** D1 is independently mergeable here. Open it as its own pull
request so the D2 diff stays readable.

**Rollback point.** Revert the D1 commit; nothing outside this repository has
changed.

## Phase 2 — D2, the lane and the action

- [x] `examples/sd-review.yml`: delete the `independent-review-floor`
      `workflow_dispatch` input, including its `options` list.
- [x] Add the fail-closed guard step to the `review` job, `case`-ing over
      `none|cheap|deep|copilot`, `""` → error naming
      `REVIEW_INDEPENDENT_FLOOR`, `*` → error showing the received value. Copy
      the shape of the `REVIEW_ROUTE_MODE` guard in
      `examples/pr-agent-router.yml`; do not invent a second idiom.
- [x] Wire `independent-review-floor: ${{ vars.REVIEW_INDEPENDENT_FLOOR }}`.
- [x] Rewrite the comment above it. The current text is accurate about the pack
      and false about a human dispatching from the Actions UI, which is how the
      defect survived review. Say which caller it constrains.
- [x] `action.yml`: rewrite the tail of the `route-policy` description. It
      currently warns that "the neighbouring policy inputs on the shipped lane
      are deliberately wired the other way" — after this change that sentence
      describes the defect as intentional. Name both inputs as variable-wired.
- [x] **Do not** add a `${{ … }}` expression to any `action.yml` description
      while editing it. `R-008` will catch it, but the reason is worth holding:
      that is the exact edit that made `0.5.0` unloadable for every consumer.
- [x] Test that the lane guard's accepted set equals the installer's accepted
      floor set, extracting the `case` arms from the lane the way the existing
      `ROUTE_MODES` test does. Two expressions of one set.
- [x] Test that a dispatch input cannot lower the floor — assert the lane
      declares no `independent-review-floor` input at all. Asserting the wiring
      string alone would pass against a lane that kept the input and ignored it.
- [x] Test that the lane **passes the `independent-review-floor` key at all**.
      This is the one genuine fail-open in the design: `input()` uses `??`
      (`src/operations.js:30`), so an empty variable throws in `normalizeMode`
      and fails closed, but an *absent* key reaches the `"none"` fallback and
      silently unfloors the lane. A future edit reasoning "the variable is unset
      everywhere, drop the line" would do exactly that. Assert the key is
      present and wired to the variable, not merely that no input exists.
- [x] Do **not** justify the guard step as preventing a silent `none`. It does
      not; the decoder already throws on an empty value. The guard's value is
      failing at the lane with an error naming the variable, and symmetry with
      the `REVIEW_ROUTE_MODE` guard. `design.md` records the corrected analysis.
- [x] `npm run check:full`.

**Rollback point.** Revert Phase 2; Phase 1 stands on its own.

## Phase 3 — D2, the installer

Mirror `REVIEW_ROUTE_MODE`'s arrival at schema 4 step for step.

- [x] `codecs.mjs`: manifest schema `5 → 6`; add `6` to
      `SUPPORTED_MANIFEST_SCHEMA_VERSIONS`; add the `| 6 |` row to the matrix
      comment.
- [x] `export const REVIEW_FLOOR_MIN_SCHEMA_VERSION = 6`. Gate on the version
      the requirement was introduced at — never `=== MANIFEST_SCHEMA_VERSION`,
      which narrows an existing tier instead of adding one. The comment on
      `ROUTE_MODE_MIN_SCHEMA_VERSION` says why.
- [x] Add the new variable tier. **Deviation, deliberate:** the plan said to add
      `FLOOR_CONFIG_VARIABLES` spreading `CONFIG_VARIABLES`, which would have
      left the floor out of `MANAGED_VARIABLE_NAMES`, `variableValues`, and
      `CONFIGURATION_FIELDS` — all three read `CONFIG_VARIABLES` as "everything
      managed now", so the variable would have been unmanaged everywhere that
      matters while looking added. The existing convention is the opposite: the
      previous top constant is renamed for its own tier and `CONFIG_VARIABLES`
      keeps naming the newest set. So `CONFIG_VARIABLES` became
      `BACKEND_CONFIG_VARIABLES` and the new `CONFIG_VARIABLES` spreads it and
      adds `REVIEW_INDEPENDENT_FLOOR: { field: "reviewFloor" }`. The layering is
      unchanged: `configVariablesForSchema` gained one branch.
- [x] `consumer-installer.mjs`: add the `check` drift row (mirror line 216) and
      the schema-ladder upgrade message (mirror lines 474–490).
- [x] Decide and record the install-time default. `--route-mode` has no default
      and must be chosen explicitly; the floor should behave the same way rather
      than acquiring a silent one.
- [x] Decode tests for a schema-5 manifest (must keep decoding) and a schema-6
      one missing the variable (must be rejected). Four cases, because there are
      four ways a schema-6 manifest can be wrong: variable dropped, configuration
      field dropped, the two disagreeing, and the tier below still decoding with
      no floor at all.
- [x] **Added beyond the plan.** Operator documentation, which the plan did not
      list and the installer spec explicitly warns is the piece that gets
      missed. `--review-floor` is now required, so every runnable
      `install-consumer.mjs install` in `README.md` and `SETUP-PR-AGENT.md`
      fails without it. The existing documented-invocation test only enforced
      `--route-mode`; it has a `--review-floor` twin now, so this cannot recur
      silently for the next required flag either.
- [x] `npm run check:full`.

**Review gate.** Phases 2 and 3 merge together — the lane fails closed against a
variable only Phase 3 can write, so neither is complete alone.

**Rollback point.** Last point before anything outside this repository changes.
Everything after this is fleet-visible.

## Phase 4 — release `0.6.0`

- [ ] Bump `package.json` to `0.6.0`. Justify minor over patch in the CHANGELOG:
      a removed dispatch input, a newly required repository variable, a schema
      bump, and a lane that fails closed without it.
- [ ] CHANGELOG entry covering both defects, how the reviewer found them on its
      own install pull requests, and the upgrade step consumers must take.
- [ ] Cut the pin-advance commit. It must touch neither `src/` nor `action.yml`,
      and must pin a parent whose action code is byte-identical.
- [ ] Tag `v0.6.0` on the pin-advance commit. Never force-move a published tag —
      if the tag is wrong, cut a new version.
- [ ] `npm run validate:release`.
- [ ] Verify from a worktree at the tag, not from `main`. Run `npm ci` there
      first: `yaml` is a devDependency and its absence reads as a release defect
      when it is only a missing `node_modules`. `src/` imports only `node:`
      builtins and the action declares no runtime dependencies.
- [ ] Publish the GitHub release.

**Rollback point.** A bad tag is superseded by a new version, never repaired in
place.

## Phase 5 — fleet, variable first

**Ordering is load-bearing.** The new lane fails closed without
`REVIEW_INDEPENDENT_FLOOR`. Set the variable on all nine consumers *before* any
lane advances. The old lane does not read it, so writing it early is inert and
there is no window in which it is set and harmful. The reverse order has no safe
window at all and breaks all nine simultaneously.

- [ ] Set `REVIEW_INDEPENDENT_FLOOR=copilot` on all nine consumers. Enumerate
      them from the fleet manifest, not from memory. `copilot` is the explicit
      per-consumer choice required by Phase 3's no-silent-default rule, not a
      fallback; it matches each consumer's existing `REVIEW_ROUTE_MODE` and
      keeps the pair self-consistent. Its consequence is intended: with the
      floor at the top of `ROUTE_STRENGTH` and the policy refusing explicit
      `cheap`/`deep`, the paid routes stay unreachable, which is what lets the
      fleet hold no provider credential.
- [ ] Verify by reading the variable back from each of the nine. A write that
      reported success is not evidence the value is there.
- [ ] Confirm the fleet still routes on the *old* lane with the variable set —
      one dispatch is enough to show the early write is genuinely inert.
- [ ] Run `update` per consumer to advance lanes and pins. Canary first, exactly
      as the 0.5.0 rollout did: one consumer, verified, before the rest.
- [ ] Expect consumer-local policy gates to fire again on the install pull
      requests. Two are known: `docs/repomix-map.md` staleness in `hoa-manager`
      and `mezmo_benchmark`, and a required `Tooling/generated scope:` line in
      the `hoa-manager` pull-request body. A body edit alone will not clear the
      latter — `gh run rerun` replays the original event payload, so the branch
      needs a fresh push.
- [ ] After merge, verify from each default branch that all nine carry the new
      lane blob and the new pin. Enumerate; do not restate the install run.
- [ ] Smoke each of the nine: a throwaway pull request, `operation: route` with
      an explicit `route: "copilot"`, collect the `sd-github-review/receipt`
      check run, then close unmerged and delete the branch. Explicit for
      determinism — the receipt should record the same `selectedRoute` on every
      consumer so a difference means something.

      Not for the reason given in the 0.5.0 smoke and in an earlier draft here,
      that `auto` might land on `deep` and reach the paid adapter. That is
      **false**: `ROUTE_STRENGTH` is `none:0, cheap:1, deep:2, copilot:3`, so a
      floor of `copilot` outranks `deep` and `src/router.js:188` resolves the
      floor to `copilot`. `auto` is safe here. Do not carry the old rationale
      forward.
- [ ] Confirm `pr-agent` and `finalize` are `skipped` on all nine. Any other
      outcome means an external adapter ran and must be explained before the
      rollout is called done.

**Rollback point.** Consumers can be pinned back to `61a4492` (v0.5.0) by
reverting the lane; `REVIEW_INDEPENDENT_FLOOR` is inert to that lane and can be
left in place.

## Phase 6 — close out

- [ ] Tick the acceptance criteria in `prd.md` with the evidence that settled
      each, not with a restatement of the criterion.
- [ ] Record the D2 decision and its date in `prd.md`, where the open question
      currently sits.
- [ ] Archive the task.

## Validation commands

```bash
npm run check:full          # everything; the gate before each phase closes
npm test                    # node --test
npm run validate:metadata   # D1's gate, and R-008
npm run validate:release    # release-tag validation, Phase 4 only
npm run test:coverage
shasum -a256 contract/routed-review-setup-v1.json config/routed-review-setup-v1.json
```

## Standing constraints

- No provider credential reaches any consumer. The fleet installed with none and
  stays that way; `copilot` and `none` are the only modes that install without
  one, and `auto` can bill the key, which is why it stays strict.
- `docs/RELEASE_CHECKLIST.md` §2 puts a credentialed adapter pilot behind
  separate approval. This task does not request it, so the external `finalize`,
  adapter-replay, and changed-head reconciliation paths stay unit-covered and
  unexercised — recorded as a known gap, not folded into a pass.
