# Implementation plan — v0.3.0 pin freshness

Baseline to beat, captured before any edit: `npm test` = 595 passing / 0 failing.

## Gate 0 — operator publishes the tag (blocking, not automatable here)

Nothing below can go green until `v0.3.0` exists, because the freshness check
resolves it. The operator runs, from a clean `main` at
`744a9f138bba7c60272c7f9e3f8412e435e11b89`:

```bash
git tag -a v0.3.0 744a9f138bba7c60272c7f9e3f8412e435e11b89 -m "v0.3.0"
git push origin v0.3.0
gh release create v0.3.0 --title v0.3.0 --notes "Advance first-party pin to current main."
```

Verify before proceeding: `git rev-list -n1 v0.3.0` prints
`744a9f138bba7c60272c7f9e3f8412e435e11b89`.

## Step 1 — advance all 13 pin sites

Replace `8636a3983d18de17c49907a4c48170a61b1bb713` with
`744a9f138bba7c60272c7f9e3f8412e435e11b89` at every site in the design's blast-radius
table, and change `--source-tag v0.1.0` to `--source-tag v0.3.0` at
`SETUP-PR-AGENT.md:123`. Bump `package.json` version to `0.3.0`.

Do this as one edit so `assertFirstPartyConsistency` never observes a split state.

Validation: `git grep -n 8636a3983d18de17c49907a4c48170a61b1bb713 -- ':!.trellis'`
returns nothing (expect exit 1, no output).

## Step 2 — freshness assertion in `validate-action-metadata.mjs`

Add a helper that lists `v<semver>` tags, orders them by semver precedence, and
resolves the highest to a commit. Export
`assertPinFreshness({ repositoryRoot, gitImpl })` requiring the descriptor's
`actionReference` SHA to equal that commit.

**Do not put this inside `validateMetadata`** — see design D2a. 20 fixture call
sites in `test/metadata.test.js` pass non-git temp roots and would throw on the
repository probe rather than on staleness. Call it instead from the CLI
entrypoint (`validate-action-metadata.mjs:567`, which is what CI runs) and from
`validateReleaseConsistency`.

Throw with a distinct message when zero release tags are found — never skip.
Inject the git lookup the same way `validateReleaseConsistency` already injects
`gitImpl.tagExists` (`validate-action-metadata.mjs:531`), so tests drive it
without real tags.

Validation additions: `npm test` must stay at 595 passing. If any pre-existing
metadata test starts failing, the check has been wired into the wrong path —
revert the wiring rather than editing the fixtures to accommodate it.

Validation, in order:
1. `node scripts/validate-action-metadata.mjs` exits 0.
2. Revert the descriptor pin to `8636a39…` and re-run: must exit non-zero with a
   staleness message, not a format message. Restore afterward. This is the
   decisive check — a freshness gate that cannot fail is not a gate.

## Step 3 — CI must have tags

`.github/workflows/ci.yml:15`: add `with: fetch-depth: 0` to the checkout step.
Without it the default `fetch-depth: 1` leaves CI with no tags and step 2's
assertion cannot resolve anything.

Validation: `npm run validate:ci-parity` exits 0 (it may assert package/CI
alignment and needs to stay consistent with step 4).

## Step 4 — quarantine the eight unreachable modules

Modules: `src/protocol-v2.js`, `src/retention-policy.js`,
`src/review-budget-ledger.js`, `src/review-candidate-catalog.js`,
`src/review-deferred-recovery.js`, `src/review-plan-authorization.js`,
`src/review-usage-reconciliation.js`, `src/routed-review-compiler.js`.

- `package.json:12` `check`: drop the eight `node --check` entries for them.
- `scripts/check-coverage.mjs`: keep `src/**` and add a documented
  `--test-coverage-exclude` entry per quarantined module, with a comment naming
  the reachability evidence.
- Files themselves: unchanged on disk. Verify with `git diff --stat -- src/`
  showing no entry for any of the eight.

**Already measured during planning — do not re-derive, just confirm.** The
post-quarantine numbers are 93.68 lines / 83.98 branches / 95.02 functions
against floors of 88 / 77 / 88 (design D6). No floor edit is required or
permitted. `npm run test:coverage` must print a global at or near those figures;
a materially different result means the exclude list does not match the eight
named modules, and the fix is the exclude list, never the floor.

## Step 5 — `supportedContractMajors`

Add the array to `config/routed-review-setup-v1.json` beside `contractMajor`.
Validate in `readSetupDescriptor`: present, non-empty array, every element in
`knownContractMajors`, and `contractMajor` included among them.

Add tests to `test/metadata.test.js` for: valid case, empty array, unknown
major, and scalar-not-in-array.

## Step 6 — correct the PRD

Rewrite AC 1 from `git tag --points-at HEAD` includes `v0.3.0` to: `v0.3.0`
exists and every first-party reference resolves to it. Record why in one line —
the original is unsatisfiable alongside AC 3.

Reconcile the reference count at every site it appears, not just the first one
found. The planning sweep located four in `prd.md` plus one in `task.json`:

| Location | Current text | Correction |
| --- | --- | --- |
| `prd.md:16` | "The nine references" | thirteen sites |
| `prd.md:38` | "Nine references across six files" | thirteen across nine files |
| `prd.md:61` | "all nine first-party references" | all thirteen sites |
| `prd.md:77` | AC 3 "All nine first-party references" | all thirteen |
| `task.json` description | "all five example router workflows and `config/…`" | add the four doc mentions |

Keep the distinction the numbers encode: nine are executable first-party pins
that `assertFirstPartyConsistency` reads, four are prose mentions that only AC
2's grep covers. State both counts rather than flattening them to one.

Do **not** update the "252 commits" figure in `prd.md` or `task.json` — see
design D3's closing note; it is a moving measurement, correct as of its own
date.

## Final validation

Run in this order and quote actual output in the PR body:

```bash
npm test                          # expect 595+ passing, 0 failing
npm run test:coverage
npm run check
npm run validate:metadata
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs
```

Then the negative test from step 2 once more, since it is the only evidence the
new gate actually bites.

## Rollback points

- After step 1: `git checkout -- .` restores every pin; nothing external changed.
- After step 4: coverage floors are the only lossy edit; the before/after numbers
  in the PR body are what makes that reversible.
- The published `v0.3.0` tag is not rolled back — see design, "Rollout and
  rollback".
