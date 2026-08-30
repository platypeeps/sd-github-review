# Routed Review Configuration Lifecycle Implementation Plan

> **Verified against the codebase 2026-08-20.** Execution order below is sound
> and unchanged. Preconditions and Validation are updated: the compiler
> interface this plan waits on already exists, and the validation list was
> missing gates the repository actually runs. Evidence in
> `research/2026-08-20-research.md`.

## Child Delivery Tasks

1. `07-25-scaffold-routed-review-source`
2. `07-25-migrate-routed-review-configuration-v2`
3. `07-25-manage-compiled-review-configuration-promotion`

Each child must pass its own acceptance criteria before this parent runs the
combined lifecycle validation below.

> **STALE — none of the three exist.** `task.json` records `"children": []`;
> none appear in `.trellis/tasks/` or either archive month. This plan currently
> orders work that has no owner. Create the three tasks or fold them into this
> parent, and record which.

## Preconditions

- ~~Approve the parent v2 configuration contract and sibling compiler
  interface.~~ **DELIVERED.** The interface exists, is pure, and is tested:
  `compileRoutedReviewConfiguration({ source, catalog, handlerProfiles })`
  (`src/routed-review-compiler.js:442`), `decodeSourceContract`
  (`src/protocol-v2.js:595`), `decodeSetupDiscoveryV2`
  (`src/protocol-v2.js:1397`), `candidateProjectionDigest`
  (`src/routed-review-compiler.js:211`). No approval step remains; what remains
  is wiring it to a shipped path.
- Confirm the managed catalog-resolution transport and credential owner;
  standalone remains independent of both.
  **BLOCKED.** The stated owning dependency
  `07-25-define-consumer-review-control-plane` does not exist in the active or
  archived task tree. Either create it as a real blocker or scope this wave to
  standalone mode, which needs neither.
- **Decide the two artifact questions first** (both UNRESOLVED in `design.md`):
  the consumer source path — the originally proposed `.github/sd-review.yml`
  collides with the installer-overwritten
  `.github/workflows/sd-review.yml` (`scripts/consumer-installer/codecs.mjs:16`)
  — and whether the compiled manifest joins `.github/sd-github-review.json`
  (`:8`) or gets its own pending/active pair. Both are load-bearing for every
  child task and expensive to unwind after code exists.
- Curate implementation and check context before `task.py start`. The two
  jsonl entries point at `.trellis/spec/backend/consumer-installer.md` and
  `.trellis/spec/backend/quality-guidelines.md`; both exist.

## Execution Order

1. Add standalone/managed source, catalog-projection, fixed-profile, explicit
   budget-exhaustion merge-policy, compiled-manifest, and semantic-diff
   fixtures.
2. Add fresh-install scaffolding for one complete explicit source.
3. Integrate mode-specific compiler inputs and managed-only catalog resolution.
4. Implement dry-run and pending/active promotion with prior-state preservation.
5. Implement update/check/drift and one-time v1-to-v2 migration.
6. Implement ownership-aware uninstall plus reserved candidate/slot-label
   detection without label adoption or mutation.
7. Add branch-protection readiness diagnostics and explicit-authorization
   migration/legacy-retirement fixtures.

   > **BOUNDARY — do not build Check publication here.** The parent's
   > Component Ownership table assigns receipts, Checks, and setup discovery to
   > the engine child `07-25-compile-and-execute-budget-aware-review-plans`
   > (`07-25-budget-aware-review-degradation/design.md`, `sd-github-review`
   > engine row). Publishing `sd-review / assurance` and `sd-review / gate` is
   > runtime behavior on the exact head; this task owns only the installer-side
   > *readiness diagnostics* over them — that only the gate is branch-protection
   > required, that the gate is present, and that the legacy Check is retired
   > only after a successor exists on the head. `prd.md`'s "Publish the stable
   > assurance/gate Checks on the current head before retiring a legacy Check"
   > is a sequencing constraint on the engine child, not a deliverable of this
   > one. Confirm the split with the owner before step 7 starts; today both
   > tasks read as owning it.
8. Update setup, migration, rollback, and troubleshooting documentation.

### Reachability step, required not optional

The first change that imports `src/routed-review-compiler.js` from a shipped
path must, in the same PR:

- remove `"src/routed-review-compiler.js"` (and any other module it makes
  reachable) from the `QUARANTINED` list in `scripts/check-coverage.mjs:38-47`,
  and add a file floor beside the existing ones; and
- add it to the `node --check` chain in `package.json`'s `check` script, which
  today covers 11 `src/` files and 5 installer files and none of the eight
  quarantined v2 modules.

This is not housekeeping. `scripts/check-coverage.mjs:35-37` already states the
rule — "delete an entry here the moment its module becomes reachable; a
reachable module that is silently excluded is far worse than an unmeasured
parked one." Skipping it ships 450 lines of compiler behind a coverage gate
that has been told to ignore them.

Current measurement for reference: 9,390 of 13,136 `src/*.js` lines are
unreachable from `src/index.js` (28.5% reachable, 3,746 lines across 11
modules). Unchanged from the 2026-08-15 park re-verification, and matching the
repository's own figure in `scripts/check-coverage.mjs:31-32`.

## Validation

- Installer fresh/update/check/dry-run/reapply/uninstall tests.
- Reserved candidate/slot-label preservation and unsupported-control tests.
  Note these are guarding a namespace that is currently *empty*:
  `review-candidate:*` and `review-slot:*` appear nowhere in the repository,
  and `ROUTING_LABELS` (`scripts/consumer-installer/codecs.mjs:72-98`) is
  disjoint from both. Write the test anyway — it converts a true-by-accident
  property into a true-by-construction one.
- Catalog missing/stale/mismatch, standalone no-catalog, mixed-mode, and
  compiler-failure tests. Mode-confusion cases already have compiler-level
  coverage to build on (`src/routed-review-compiler.js:310`, `:371`).
- Interrupted promotion and managed-drift tests.
- Branch-protection missing-gate, required-assurance, authorized migration, and
  legacy-retirement tests.
- v1 migration and post-cutover rejection tests. The v1 fixed route is now a
  local, versioned, migratable input rather than live GitHub state: PR #99
  brought `REVIEW_ROUTE_MODE` into the manifest at schema 4
  (`scripts/consumer-installer/codecs.mjs:136-139`). Extend the existing
  version-gated tier pattern (`:164-171`) rather than gating on equality with
  `MANIFEST_SCHEMA_VERSION` — the spec records that mistake as a worked "Wrong"
  example at `.trellis/spec/backend/consumer-installer.md:380-390`.
- `npm test`, `npm run check`, `npm run validate:metadata`,
  `npm run test:coverage`, and `npm run validate:ci-parity` — the original list
  omitted the last two, which the repository's own gates run. `npm run
  check:full` runs all of them plus the command-pack full check.

## Rollback Gate

Do not promote a new compiled manifest until its source/output and applicable
managed catalog digests plus validation pass. Preserve the prior active version
on every error.
