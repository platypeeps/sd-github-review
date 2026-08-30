# Design — installer ships the descriptor and the durable sd-review.yml lane

Baseline captured before any edit: `npm test` = 608 passing / 0 failing on `main` at
`053f156`. The PRD's 595 figure predates PRs #63 and #66.

## What the PRD did not say, and what it changes

Four constraints surfaced from reading the probe, the installer, and the executable spec
rather than the PRD. Two of them change the shape of the work.

### The workflow name is load-bearing, not cosmetic

`scripts/sd-ai-command-pack-review.py:814-816` compares the descriptor's declared
`workflow.name` against the workflow metadata GitHub reports, and returns
`workflow-name-mismatch` when they differ. GitHub derives that metadata name from the
workflow file's own `name:` field.

The descriptor declares `"name": "SD routed review"`. The natural template source,
`examples/pr-agent-on-demand-review-router.yml`, is named `SD routed review with PR-Agent`.
Copying it unchanged produces an installation that passes every local check and then reports
`invalid / workflow-name-mismatch` against the live API — the same silent-no-op class of
failure this task exists to remove, one layer deeper.

`examples/sd-review.yml` must declare `name: SD routed review` verbatim. That is a contract
between two files with no compile-time link, so it needs a test (AC 2 already asks for the
path half; the name half is added).

### The PRD's instruction to repoint `WORKFLOW_PATH` would break the fleet

The PRD asks that `WORKFLOW_PATH` and `TEMPLATE_PATH` be changed so the installer writes
`.github/workflows/sd-review.yml`. Following that instruction literally is not a rename. It is
a lane replacement plus a fleet-wide orphaning, on five separate mechanisms:

1. **It removes a capability.** The shipped template today is `examples/pr-agent-router.yml`,
   triggered by `pull_request: [opened, synchronize, reopened, ready_for_review, labeled]` and
   `issue_comment` (`examples/pr-agent-router.yml:3-8`). The durable template declares
   `on: workflow_dispatch:` and nothing else (`pr-agent-on-demand-review-router.yml:3-4`).
   Every consumer that ran `update` would lose automatic on-PR review.
2. `decodeManifest` validates `workflow.path` by exact equality (`codecs.mjs:174`), so every
   live manifest stops decoding — "workflow ownership is malformed".
3. `decodeManifest` validates `source.template` the same way (`codecs.mjs:181`), and existing
   manifests record the old constant (`plan.mjs:110`).
4. `loadLocalState` reads the workflow from `WORKFLOW_PATH` only (`persistence.mjs:163`), so
   `local.workflow` is `null` while the manifest is `active` and `assertWorkflowCanBeManaged`
   throws "missing from an active managed installation" (`plan.mjs:39-43`) **before** any
   migration logic could run.
5. `HISTORICAL_TEMPLATE_HASHES` (`codecs.mjs:87-99`) holds hashes of `pr-agent-router.yml`, a
   different file. `recognizeTemplate` (`codecs.mjs:306`) would reject every manual install as
   "not a recognized sd-github-review template" (`consumer-installer.mjs:241`), and
   `test/consumer-installer.test.js:1047` requires those templates to stay adoptable.

D2 resolves this by making the durable lane additive. See there.

### The published and installed descriptors are byte-identical

`config/routed-review-setup-v1.json` already carries exactly the values the probe checks:
`integrationId`, `supportedIntents`, `supportedOperations`, `durableReceipt.checkName`,
`noninteractive`, `checkoutRequired`, and an immutable `actionReference`. There is nothing
consumer-specific in it. Installation is a verbatim copy, not a render — which removes an
entire class of drift and makes the digest comparison trivial.

### The executable spec currently forbids this task

`.trellis/spec/backend/consumer-installer.md:16-17` states that "Durable on-demand workflows,
Copilot account settings, branch protection, commits, pushes, and pull requests are outside
this command boundary." This task moves durable on-demand workflows *inside* that boundary, so
the sentence is not incidental documentation — it is the contract being amended, and it must
be revised in the same change. `.trellis/spec/backend/directory-structure.md:31` likewise
declares `config/` as the published descriptor location.

## Decisions

### D1 — The descriptor move is split out into `08-09-descriptor-contract-path`

**Moved out of this task.** After three rounds of adversarial review this task had grown from
six steps to a manifest schema-3 migration across all five lifecycle commands plus an
executable-spec rewrite, while the R1 descriptor move — which fixes the defect making this
repository's own pull requests fail review — remained independent of every part of it: no
installer module, no manifest schema, no lifecycle command.

`08-09-descriptor-contract-path` owns it, and this task is `blockedOn` that one. Its design
carries the path rationale, the ten readers that move, and the four references that
deliberately stay on `config/`.

What this task inherits once that ships: the published descriptor lives at
`contract/routed-review-setup-v1.json`, which becomes the **source** the installer copies from
(see D3), while `config/routed-review-setup-v1.json` becomes an installed-consumer-only path.

### D2 — The durable lane is an additional managed resource, not a replacement

`WORKFLOW_PATH` and `TEMPLATE_PATH` are unchanged. `examples/pr-agent-router.yml` keeps
shipping to `.github/workflows/ai-review-router.yml` exactly as today. The installer gains a
second managed workflow: `examples/sd-review.yml` -> `.github/workflows/sd-review.yml`.

This satisfies the PRD's actual goal — a consumer holding the descriptor *and* a workflow at
the path the descriptor declares — while removing every hazard enumerated above. No legacy
constants, no manifest migration loader, no adoption-registry surgery, and no consumer loses
the event-driven lane it already relies on.

Rejected: repointing the constants as the PRD's requirement bullet literally asks. It is a
smaller diff that converts every live installation into an undecodable manifest plus an
orphaned workflow file, and silently downgrades the fleet from automatic review to
dispatch-only. The requirement bullet describes a mechanism, not the outcome; the outcome is
preserved and the mechanism is not.

`examples/sd-review.yml` is `examples/pr-agent-on-demand-review-router.yml` with `name:`
changed to `SD routed review`, matching the descriptor per the constraint above. Nothing else
changes; its first-party pins already carry the current `v0.3.0` SHA, which is the whole reason
this task sequenced after the pin advance.

The generic `examples/on-demand-review-router.yml` is not the source: it carries an adapter
placeholder that a consumer must replace by hand, and the installer's contract is to produce a
working installation without hand-editing.

### D3 — The installer copies the descriptor verbatim and owns it in the manifest

Given the byte-identity finding above, `install` copies the published descriptor to
`config/routed-review-setup-v1.json` in the consumer.

The descriptor has a **source path distinct from its destination**, exactly as the workflow
does (`codecs.mjs:8-10`): source `contract/routed-review-setup-v1.json` in this repository,
destination `config/routed-review-setup-v1.json` in the consumer. Both constants are required;
defining only the destination leaves nothing to compare a stale install against.

Ownership is recorded so `check` can report drift and `uninstall` can remove it. "Exactly as
the workflow is handled today" is not a sufficient specification, so the guards are named
explicitly. There are **five**, not three — the fourth and fifth are the ones a partial reading
of the workflow precedent misses:

| Guard | Workflow precedent | Behavior for each new resource |
| --- | --- | --- |
| collision | `plan.mjs:30-33` | an existing unmanaged file refuses install rather than overwriting |
| `check` drift | `consumer-installer.mjs:339-341` | `check` reports a file whose hash differs from the manifest |
| removal | `consumer-installer.mjs:410-414` | `uninstall` refuses to remove an operator-modified file |
| **`update` overwrite** | `plan.mjs:45-52` | `update` **fails** on an active install whose file was modified after installation. `check` reporting drift does not protect a direct `update`; this is a separate guard and omitting it makes `installOrUpdate` silently clobber operator edits (`consumer-installer.mjs:195-199`). |
| **source freshness** | `consumer-installer.mjs:343` | `check` compares the manifest's recorded source hash against the *current* source file and reports "a newer source is available; run update". Without it a consumer stays "healthy" on an obsolete descriptor after a later release. |

That requires a manifest change: a `descriptor` block and a `durableWorkflow` block beside the
existing `workflow`/`source` pair, each carrying destination `path`, `sha256`, and the source
path it was rendered from. `decodeManifest` validates by exact equality, so added blocks must be
decoded, not ignored — which means **manifest schema 3**.

`adopt` is part of this decision, not an afterthought. `adoptInstallation` today reads only
`TEMPLATE_PATH`, writes only the manifest and the event-driven workflow
(`consumer-installer.mjs:212-296`), and its own comment promises the result behaves "exactly
like install so check/update/rollback/uninstall work afterward". Under schema 3 that promise
breaks: `createManifest` would record `descriptor`/`durableWorkflow` blocks for files `adopt`
never wrote, and the existing tests requiring an adopted install to end healthy and uninstall
cleanly (`test/consumer-installer.test.js:1061`) would fail. `adopt` therefore performs the
same collision checks, writes, pending-state recovery, and report lines for both new resources.

### D3a — the schema 1/2/3 validation matrix is explicit, not inherited

`decodeManifest` admits schema 1 plus the current schema in one condition (`codecs.mjs:161-164`),
but gates provenance validation on `value.schemaVersion === MANIFEST_SCHEMA_VERSION`
(`codecs.mjs:188`). Bumping the constant to 3 while "admitting schema 2" would therefore make
schema-2 manifests skip the `source.commit` / `source.tag` / `released` validation they are
required to carry — `.trellis/spec/backend/consumer-installer.md:61` still mandates those
fields for schema 2. Widening the accept condition without splitting the validation condition is
a silent loss of validation on the exact manifests the fleet is running.

Required fields per version, stated once so the decoder can be read against it:

| Version | `workflow` + `source` | provenance (`commit`, `tag`, `released`) | `descriptor` + `durableWorkflow` |
| --- | --- | --- | --- |
| 1 | required | not present | not present |
| 2 | required | **required** | not present |
| 3 | required | required | required |

Schema 3 decodes schema-2 manifests as pre-durable installs (mirroring how schema 2 treats
schema 1 today: decode, flag for migration in `check`, add the missing resources on `update`) —
but with provenance still validated, which the "mirroring" shorthand alone would not deliver.

### D3b — schema-2 migration is a first install of the new resources, and needs the collision guard

A schema-2 manifest records no hash for either new resource, so the `update`-overwrite guard —
which compares disk bytes against a recorded hash — has nothing to compare and cannot fire.
Meanwhile `update` is instructed to add both resources, through the unconditional write path at
`consumer-installer.mjs:195-199`. A consumer that hand-placed `.github/workflows/sd-review.yml`
(as `sd-github-review-pilot` did, per the PRD) would have it silently overwritten.

Migration therefore applies the **collision** guard, not the overwrite guard: for each new
resource, when the destination already exists and the manifest carries no hash for it,

- bytes differing from the source: **refuse before any mutation**, with the same
  reconcile-manually guidance `adopt` gives an unrecognized workflow
  (`consumer-installer.mjs:239-243`);
- bytes byte-identical to the source: adopt it — record the hash and write nothing. This is
  the `adopt` precedent for a current-template match (`consumer-installer.mjs:245`,
  `refreshWorkflow === false`), and refusing here would strand exactly the hand-placed installs
  this task exists to bring under management.

### D4 — A converged second run performs no writes

AC 6 is not satisfied by the current code and is not satisfied by anything else in this design,
so it gets its own decision. `installOrUpdate` unconditionally writes the pending manifest, the
workflow, and the active manifest (`consumer-installer.mjs:195-199`), and `actionDescriptions`
is always populated (`:178-183`). The existing idempotency test asserts only that no additional
GitHub calls occur (`test/consumer-installer.test.js:242-247`) — it would pass unchanged if
every local file were rewritten on every run.

Convergence is **not** "the recorded hashes match disk". `installOrUpdate` computes several
other inputs before it writes (`consumer-installer.mjs:146-169`): the resolved configuration,
the planned remote actions, the lifecycle state, the manifest schema, and the source release
provenance. Two existing tests exist precisely because those inputs change a seemingly healthy
installation — a provider/model change must still mutate it
(`test/consumer-installer.test.js:297`), and a source-commit change must be detected even when
the template bytes are identical (`:740`). A hash-only short-circuit would suppress both, which
is a regression dressed as an optimization.

`install` is a no-op — empty `actions`, no filesystem writes, no remote calls — only when all
of the following hold:

1. the manifest is `active` and already at `MANIFEST_SCHEMA_VERSION`;
2. the manifest that *would* be written is deep-equal to the one already on disk (this subsumes
   configuration and provenance, so neither needs its own predicate);
3. `planResources` yields zero remote actions; and
4. every managed file's bytes match its recorded hash.

Anything else takes the existing write path in full. This is a short-circuit on the fully
converged case, not a new code path for partial states.

### D5 — This repository's own rollout is out of scope

The PRD notes that `sd-github-review` appears in the fleet manifest as a consumer of the
command pack as well as being the router. Actually installing into this repository is
`08-08-fleet-rollout-smoke`'s work. This task's obligation to itself is only D1: stop
self-matching. AC 4 is satisfied by the move, not by an install.

AC 3 — the probe returning a non-`absent` state — also belongs there. Once the descriptor
exists the probe continues to GitHub workflow metadata and only succeeds after validating the
active path and name (`sd-ai-command-pack-review.py:797-816`), which needs a live registered
workflow. This task verifies the local half and says so plainly; it does not claim a green
probe.

## Blast radius

| Surface | Change |
| --- | --- |
| `contract/routed-review-setup-v1.json` | read as the install source — **created by `08-09-descriptor-contract-path`, not by this task** |
| `examples/sd-review.yml` | new durable template, `name: SD routed review` |
| `examples/pr-agent-router.yml`, `WORKFLOW_PATH`, `TEMPLATE_PATH`, `HISTORICAL_TEMPLATE_HASHES` | **unchanged** — see D2 |
| `scripts/consumer-installer/codecs.mjs` | `DURABLE_WORKFLOW_PATH`, `DURABLE_TEMPLATE_PATH`, `DESCRIPTOR_PATH`, `MANIFEST_SCHEMA_VERSION` 2 -> 3, `decodeManifest` |
| `scripts/consumer-installer/plan.mjs` | new blocks in `createManifest`/`planResources`; collision guards |
| `scripts/consumer-installer/persistence.mjs` | load/write/remove the descriptor and durable workflow |
| `scripts/consumer-installer/transport.mjs` | `templateDirty` must cover every copied source artifact (see below) |
| `scripts/consumer-installer.mjs` | `check` drift + freshness + migration issues; `update` overwrite guard; `uninstall` guards; `adopt` writes both new resources; converged no-op (D4) |
| `scripts/validate-action-metadata.mjs` | `setupDescriptorPath` |
| `test/metadata.test.js`, `test/operation-contract.test.js`, `test/consumer-installer.test.js`, `test/installer-modules.test.js` | path + schema-3 + guard + idempotency coverage |
| `README.md`, `DESIGN.md`, `SETUP-COPILOT.md`, `SETUP-PR-AGENT.md` | published path |
| `.trellis/spec/backend/consumer-installer.md` | `:16-17` scope sentence excluding durable workflows; `:42-44` single-workflow copy contract; `:61` schema version; `:186` schema-1 -> 2 migration assertions (published-path references belong to `08-09-descriptor-contract-path`) |

`.trellis/spec/backend/consumer-installer.md` is the executable contract, so its
install/adopt/check/update/uninstall clauses, its schema statement, its migration assertions,
and its test-obligation list all move to schema 3 and three managed resources. Updating only the
descriptor path would leave the spec asserting a single event-driven workflow and schema 2 while
the code ships neither.

User documentation carries the same claims and moves with it: `README.md:44` describes one
managed workflow, and `SETUP-PR-AGENT.md:415-420` states rollback is "a clean `uninstall` at the
current release … so no older decoder ever sees a schema-2 file" — the same false claim
corrected in "Rollout and rollback" below, in a file a consumer actually follows.

`examples/sd-review.yml` adds a seventh example, so `test/metadata.test.js`'s `exampleCount`
assertion moves 6 -> 7. The metadata validator's first-party consistency check will read the new
template's pins, so they must carry the `v0.3.0` SHA from the start.

## Rollout and rollback

Rollback before merge is `git checkout -- .`; nothing external changes.

After merge, the lossy edit is the descriptor move: a consumer that had somehow fetched this
repository's published descriptor from the old raw URL would 404. No such consumer exists — the
PRD's own survey found the file installed in zero repositories — and the whole point of R1 is
that nothing should be reading it from that path.

The manifest schema bump is forward-only by design, matching 1 -> 2: a schema-N decoder reads
schema <= N (`codecs.mjs:161-164`). So the clean exit from a schema-3 installation is
`uninstall` run from **the release that performed the install**, not from the current v0.3.0 —
`uninstall` decodes the manifest before doing anything (`consumer-installer.mjs:391`), and
v0.3.0's decoder rejects schema 3. Consumers that never take the new release are unaffected;
their schema-2 manifests keep decoding and keep uninstalling at v0.3.0.
