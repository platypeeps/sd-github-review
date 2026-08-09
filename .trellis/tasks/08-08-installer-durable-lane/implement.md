# Implementation plan — installer descriptor and durable lane

Baseline to beat, captured before any edit: `npm test` = 608 passing / 0 failing.
Record the actual number again at step 0; do not trust this figure if other work has
merged since.

There is no operator gate on this task. `v0.3.0` is published, which is what unblocked it.

Design D2 rejected the PRD's literal instruction to repoint `WORKFLOW_PATH`/`TEMPLATE_PATH`.
Nothing below changes those constants, `examples/pr-agent-router.yml`, or
`HISTORICAL_TEMPLATE_HASHES`. If a step seems to require it, stop — the design is wrong, not
the constant.

## Step 1 — prerequisite: the descriptor move ships first

**Not this task's work.** `08-09-descriptor-contract-path` moves the published descriptor to
`contract/routed-review-setup-v1.json` and updates its ten readers. This task is `blockedOn`
it and starts from a tree where that has already merged.

Before step 2, confirm the prerequisite actually landed rather than assuming it:

```bash
test -f contract/routed-review-setup-v1.json && echo "source present"
test -e config/routed-review-setup-v1.json && echo "STOP: old path still present"
git grep -nE 'config/routed-review-setup-v1|"config", *"routed-review-setup-v1' -- scripts
```

Expect `contract/` to hold the file, the old path to be absent, and exactly four `config/` hits
under `scripts/` — `sd-ai-command-pack-review.py:31`, `sd-ai-command-pack-review-local.py:274`
and `:323`, and the `consumer-installer/codecs.mjs:74` comment — all naming the installed
consumer path. Grep the old path specifically, not the bare basename: the basename now matches
every `contract/` reader and every documentation mention, so it cannot distinguish a completed
move from an untouched tree. If `config/routed-review-setup-v1.json` still exists, stop — this
task would then define `DESCRIPTOR_SOURCE_PATH` pointing at a file that is not there.

## Step 2 — `examples/sd-review.yml`

Copy `examples/pr-agent-on-demand-review-router.yml` and change `name:` to exactly
`SD routed review`. Change nothing else; its pins already carry `v0.3.0`.

Then add the test AC 2 requires, asserting **both** halves against the descriptor rather than
against a literal:

- the template's `name:` equals `descriptor.workflow.name`; and
- `DURABLE_WORKFLOW_PATH` equals `descriptor.workflow.path`.

Assert against the parsed descriptor, not a hardcoded string — a test that repeats the
literal passes when both sides drift together, which is the failure it exists to catch.

`test/metadata.test.js` `exampleCount` moves 6 -> 7.

Validation: mutate the template's `name:` and confirm the new test fails; restore.

## Step 3 — new constants and schema 3

In `scripts/consumer-installer/codecs.mjs`, **add** (do not repoint anything):

- `DURABLE_WORKFLOW_PATH = ".github/workflows/sd-review.yml"` (destination)
- `DURABLE_TEMPLATE_PATH = "examples/sd-review.yml"` (source)
- `DESCRIPTOR_SOURCE_PATH = "contract/routed-review-setup-v1.json"` (source)
- `DESCRIPTOR_PATH = "config/routed-review-setup-v1.json"` (destination)
- `MANIFEST_SCHEMA_VERSION` 2 -> 3

Both source constants are required. The descriptor's source and destination differ — the
prerequisite task moved the source to `contract/` — and without the source constant there is
nothing to compare a stale install against in step 5's freshness check.

`decodeManifest` per design D3a. Two conditions change, and **both** must change:

- the accept condition (`codecs.mjs:161-164`) widens to schema 1, 2, or 3;
- the provenance-validation condition (`codecs.mjs:188`) is currently
  `value.schemaVersion === MANIFEST_SCHEMA_VERSION`. Widening the first while leaving this one
  bound to the constant silently stops validating `source.commit` / `source.tag` / `released` on
  every schema-2 manifest in the fleet — the fields
  `.trellis/spec/backend/consumer-installer.md:61` still requires. It becomes
  `value.schemaVersion >= 2`.

Then validate `descriptor` and `durableWorkflow` blocks when `schemaVersion === 3`, with the
same exact-equality and `SHA256_PATTERN` rigor the existing `workflow` block gets
(`codecs.mjs:172-177`).

Tests, in this order of importance:
1. schema-1 and schema-2 manifests still decode unchanged — the fleet-breaking direction;
2. a **malformed** schema-2 manifest (missing `source.commit`, then a bad `source.tag`) is still
   rejected. Write these against the pre-change code first and confirm they pass, then re-run
   after the bump. If they pass before and after but you never made them fail, they are not
   testing the regression D3a describes — mutate the provenance condition to
   `=== MANIFEST_SCHEMA_VERSION` and confirm they fail;
3. schema-3 block validation.

Validation: `npm test`. Nothing existing changed shape, so there should be no failures. A
failure means the schema-2 decode path regressed; read it, do not patch the fixture.

## Step 4 — write and own the two new resources

`plan.mjs` `createManifest` records the `descriptor` and `durableWorkflow` blocks;
`planResources` includes them; `persistence.mjs` loads, writes, and removes them.

Copy the published descriptor verbatim (design D3 — it is byte-identical to what a consumer
needs). Do not template it.

Then the five guards D3 names, each mirroring its workflow counterpart and each with its own
test, applied to **both** new resources:

| Guard | Precedent | Test |
| --- | --- | --- |
| collision | `plan.mjs:30-33` | pre-existing unmanaged descriptor / durable workflow refuses install, before any mutation |
| `check` drift | `consumer-installer.mjs:339-341` | `check` reports a hash mismatch for each |
| removal | `consumer-installer.mjs:410-414` | `uninstall` refuses to remove an operator-modified copy of each |
| `update` overwrite | `plan.mjs:45-52` | `update` **throws** on an active install whose descriptor or durable workflow was modified; assert the file is byte-unchanged afterward |
| source freshness | `consumer-installer.mjs:343` | with the manifest recording an older source hash, `check` reports that a newer source is available |

The removal and `update`-overwrite guards are the ones that matter — they are the difference
between a lifecycle command and data loss. Write both before the happy path. Note they are
genuinely separate: `check` reporting drift does nothing to stop a direct `update` from
clobbering the file (`consumer-installer.mjs:195-199`).

Validation: `npm test`, plus the end-to-end check in step 6.

## Step 4a — `adopt` handles both new resources

`adoptInstallation` (`consumer-installer.mjs:212-296`) reads only `TEMPLATE_PATH` and writes only
the manifest and the event-driven workflow, while its comment promises the result behaves
"exactly like install so check/update/rollback/uninstall work afterward". Under schema 3 that
promise breaks: `createManifest` records `descriptor`/`durableWorkflow` blocks for files `adopt`
never wrote, so the adopted install is immediately unhealthy.

Give `adopt` the same collision checks, writes, pending-state recovery, and report lines for the
descriptor and durable workflow that `install` gets. The event-driven adoption path — including
`recognizeTemplate` and `HISTORICAL_TEMPLATE_HASHES` — is untouched.

Validation: `test/consumer-installer.test.js:1061` already requires an adopted install to finish
healthy and uninstall cleanly. It must still pass. Add one asserting an adopted install has both
new resources on disk and reports no `check` issues.

## Step 5 — migration in `check` and `update`, and the converged no-op

`check` reports a schema-2 manifest, and an active install missing either new resource, as
migration issues. `update` adds the descriptor and the durable workflow to a schema-2
installation and rewrites the manifest at schema 3. The event-driven workflow is untouched
throughout.

Migration applies the **collision** guard, not the overwrite guard (design D3b): a schema-2
manifest records no hash for either new resource, so the step-4 overwrite guard cannot fire and
the unconditional write path (`consumer-installer.mjs:195-199`) would clobber a hand-placed
file. For each new resource whose destination already exists with no recorded hash:

- differing bytes: refuse before any mutation, with `adopt`-style reconcile guidance
  (`consumer-installer.mjs:239-243`);
- byte-identical bytes: adopt it — record the hash, write nothing.

Two tests, both against a schema-2 install: one with a hand-placed differing
`.github/workflows/sd-review.yml` asserting the refusal *and* that the file is byte-unchanged,
one with a byte-identical file asserting adoption without a write. Repeat for the descriptor.

## Step 5a — release provenance must cover every copied source artifact

`templateDirty()` checks only `TEMPLATE_PATH` (`transport.mjs:287-289`), and its single result
is what permits `released: true` (`transport.mjs:334`). Once `install` also copies the
descriptor and the durable template, a dirty version of either can be installed while the
manifest records clean tagged provenance — the manifest would assert a release the bytes do not
come from.

Widen it to every copied source artifact: `TEMPLATE_PATH`, `DURABLE_TEMPLATE_PATH`, and
`DESCRIPTOR_SOURCE_PATH`. One `git status --porcelain` invocation over all three paths is
sufficient and keeps the existing single-call shape.

Validation: `test/consumer-installer.test.js:667` dirties only the event-driven template and
must still yield `released: false`. Add the two symmetric cases — dirty durable template, dirty
descriptor source — and confirm each fails against the unwidened `templateDirty`.

Then D4's converged no-op. The predicate is **not** "recorded hashes match disk" — that would
suppress two behaviors the suite already requires. Implement all four conditions from D4:

1. manifest is `active` and already at `MANIFEST_SCHEMA_VERSION`;
2. the manifest that would be written is deep-equal to the one on disk;
3. `planResources` yields zero remote actions;
4. every managed file's bytes match its recorded hash.

Condition 2 is what makes this safe: it is computed from the same `resolveConfiguration` and
`resolveSourceRelease` results the write path uses (`consumer-installer.mjs:146-169`), so a
provider/model change and a source-commit change both fall out of convergence automatically
rather than needing their own predicates.

Validation, in order:
1. `test/consumer-installer.test.js:297` (a provider/model change mutates a healthy install) and
   `:740` (a source-commit change is detected though template bytes are unchanged) must both
   still pass. These are the regression this short-circuit would cause if written as a hash
   comparison — run them before anything else.
2. The existing idempotency test at `:242-247` asserts only that `github.calls.length` is
   unchanged, which is why AC 6 looked satisfied when it was not. Strengthen it to assert
   `second.actions` is empty and that every managed file's bytes and mtime are unchanged across
   the second run.
3. Confirm the strengthened assertion fails against the pre-D4 code before implementing it —
   otherwise it is not testing the thing it claims.
4. Mutate the predicate to the naive hash-only form and confirm test 1 fails. That is the only
   evidence conditions 1-3 are load-bearing rather than decorative.

## Step 5b — the executable contract and user documentation

`.trellis/spec/backend/consumer-installer.md` is the executable contract, not commentary. Step 1
moved only its published-path references; the substantive clauses move here:

| Site | Currently says | Must say |
| --- | --- | --- |
| `:16-17` | durable on-demand workflows are outside the command boundary | they are inside it |
| `:42-44` | `install`/`update` copy one workflow | three managed resources |
| `:61` | manifest schema is version `2` | version `3`, with the D3a matrix |
| `:186-190` | schema-1 -> 2 migration and schema-2 provenance assertions | plus schema-2 -> 3, the five guards, and the D3b collision cases |

Its `adopt`, `check`, `update`, `uninstall`, and rollback clauses each gain the two new
resources. A spec asserting one workflow and schema 2 against code shipping three and schema 3
is worse than no spec.

User documentation carries the same claims: `README.md:44` describes a single managed workflow,
and `SETUP-PR-AGENT.md:415-420` says rollback is "a clean `uninstall` at the current release …
so no older decoder ever sees a schema-2 file". That is the same false claim corrected in design
"Rollout and rollback", in the file a consumer actually follows — correct it to `uninstall` from
the release that performed the install.

Validation: `git grep -n "schema-2\|schemaVersion. 2\|ai-review-router" -- README.md SETUP-*.md DESIGN.md .trellis/spec` and account for every remaining hit as either historical narrative or a site that legitimately still describes schema 2.

## Step 6 — end-to-end acceptance

Against a scratch repository, assert:

- a fresh install produces `config/routed-review-setup-v1.json`,
  `.github/workflows/sd-review.yml`, **and** the unchanged
  `.github/workflows/ai-review-router.yml` (AC 1, plus the D2 non-regression);
- the installed durable workflow path equals the installed descriptor's `workflow.path`
  (AC 2);
- a second install run reports no change (AC 6, per step 5);
- `adopt` against a repository holding only a recognized event-driven workflow produces both new
  resources and reports no `check` issues (step 4a);
- `uninstall` removes all three.

AC 4 is verified locally and quoted: run the probe against this repository and confirm it no
longer reports a self-matched descriptor.

AC 3 is **not** verified here — see design D5. Once the descriptor exists the probe continues
to GitHub workflow metadata and only succeeds after validating the active path and name
(`sd-ai-command-pack-review.py:797-816`), which needs a live registered workflow in a real
consumer. State that the local half is verified (the file exists with the expected content and
the probe's local branch no longer returns `setup-descriptor-absent`) and that the live half
belongs to `08-08-fleet-rollout-smoke`. Do not claim a green probe that was never run.

## Final validation

```bash
npm test
npm run test:coverage
npm run check
npm run validate:metadata
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs
git grep -n "routed-review-setup-v1.json" -- ':!.trellis'
```

Quote actual output in the PR body. Re-run the step 2 name mutation and the step 5 idempotency
mutation, since those are the only evidence that the descriptor/template binding and the
converged no-op are real.

## Rollback points

- After step 1: `git checkout -- .` restores the descriptor and every reader.
- After step 3: the schema bump is the forward-only edit. Before merge it is a clean revert;
  after merge, rollback is `uninstall` run from the release that performed the install, per
  design "Rollout and rollback" — **not** from v0.3.0, whose decoder rejects schema 3.
- Steps 4-5 are additive to consumer repositories and removable by that `uninstall`.
