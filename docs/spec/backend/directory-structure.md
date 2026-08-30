# Directory Structure

> Module boundaries for the GitHub Action and its repository tooling.

## Directory Layout

```text
src/                   # dependency-free Action runtime
  index.js             # standalone/durable entrypoint and GitHub outputs
  operations.js        # on-demand route/acknowledge/finalize/query orchestration
  router.js            # route-policy owner: routeReview + selectProtocolRoute
  protocol.js          # versioned request/receipt decoding, canonical identity, decodeRoutingInputs
  protocol-v2.js       # pure v2 budget-aware contracts: decoders, vocabularies, fingerprints
  retention-policy.js  # pure standard-v1 retention/deletion/legal-hold/purge contracts (injected time)
  review-candidate-catalog.js # pure immutable candidate/prompt-profile catalog, safe projection, retention classification (injected time)
  routed-review-compiler.js # pure compiler: explicit-mode v2 source + catalog safe projection/handler profiles -> canonical manifest with source/catalog/output digests
  review-budget-ledger.js # pure leaf: authoritative budget observations, shared/independent pools, idempotent reservations/leases, overdrawn/quarantine, retention classification (injected time)
  review-plan-authorization.js # pure: exact-head managed plan preparation, trusted-command/route-label precedence, bounded /review options discovery, control-plane request shaping, idempotent durable authorization/deferral (injected time)
  review-usage-reconciliation.js # pure leaf: monotonic reconciliation of an authorized reserve against full actual usage/cost, soft budget_overrun vs hard policy_violation classification, overdrawn/quarantine, preserved unknown usage, retention classification (injected time)
  review-deferred-recovery.js # pure leaf: bounded deferred records, explicit idempotent authorized recovery creating a distinct linked attempt, changed-head supersession, exact-head assurance/gate Check projection with monotonic revision + compare-and-swap, repository-lifecycle eligibility, retention classification (injected time)
  receipt.js           # exact-head Check Run receipt storage and reconciliation
  risk-context.js      # shared normalized routing-context builder
  reviewer-dispatch.js # shared Copilot presence probe and reviewer request
  normalize.js         # leaf: value canonicalizers and input parsers
  path-match.js        # leaf: glob matching and sensitive-file selection
  github.js            # GitHub REST transport
test/                # node:test suites mirroring runtime boundaries
fixtures/protocol/   # canonical versioned protocol behavior fixtures
fixtures/setup/      # read-only setup discovery fixtures
contract/            # published versioned setup capability descriptor; deliberately
                     # NOT config/, which is the path consumers install their own
                     # copy to and the vendored probe reads (R1)
config/              # this repository's OWN installed copy, written by
                     # install-consumer.mjs, not hand-authored. It exists only
                     # because this repository is now a consumer of its own
                     # Action; keep it byte-identical to contract/ or the
                     # installer refuses update/uninstall
scripts/             # repository validation, consumer lifecycle, and SD pack helpers
  install-consumer.mjs        # thin consumer-installer CLI entrypoint (process I/O)
  consumer-installer.mjs      # consumer lifecycle orchestration + public re-exports
  consumer-installer/         # decomposed installer boundaries (downhill deps)
    codecs.mjs                # leaf: constants, manifest/config/CLI codecs, validation
    transport.mjs             # gh/git subprocess transport, GitHubCli, provenance
    persistence.mjs           # path-containment guard, atomic write/remove, local state
    plan.mjs                  # pure lifecycle planning from decoded snapshots
examples/            # consumer-owned workflow templates
  sd-review.yml      # durable workflow_dispatch lane; its `name:` must equal the
                     # descriptor's workflow.name, which GitHub reports as the
                     # workflow metadata name the probe validates
docs/                # project and release operations
.github/workflows/   # ci.yml is this repository's own CI. The other two --
                     # ai-review-router.yml and sd-review.yml -- are installer-
                     # managed copies of examples/pr-agent-router.yml and
                     # examples/sd-review.yml. Never edit them in place: a
                     # managed file that differs from its recorded hash makes
                     # the installer preserve the edit and refuse
                     # update/uninstall. Change the example, then rerun
                     # `node scripts/install-consumer.mjs update`.
.github/sd-github-review.json  # installer ownership manifest (schema 3)
```

`action.yml` is the public runtime manifest. `DESIGN.md` owns architecture and
routing semantics; `README.md` owns consumer installation.

## Planning Ownership

Unfinished phases, risks, and follow-up work belong in independently valid
`.trellis/tasks/<task>/` records. Keep `README.md`, `DESIGN.md`, and `docs/`
focused on current behavior and operating procedures so they do not become a
second backlog that can drift from Trellis.

When retiring a standalone roadmap, first classify every entry as completed or
open. Record completion evidence in the migration task, create one Trellis task
for each independently deliverable open outcome, and only then delete the
roadmap and remove forward-looking references from live documentation.

```text
# Wrong: the same future work is tracked in two places
DESIGN.md: "Planned backend: ..."
docs/<standalone-roadmap>.md: "Phase 4: ..."

# Correct: current contract in docs, remaining work in Trellis
DESIGN.md: "Supported backend contract: ..."
.trellis/tasks/<task>/prd.md: acceptance criteria for the open outcome
```

This convention prevents completed work from being recreated and preserves a
single queryable source for priority, ownership, dependencies, and status.

## Module Organization

- Keep one downhill dependency direction. Leaf utilities import no local
  module; the codecs import only leaves; the policy owner imports the codec
  seam plus leaves; services and entrypoints import the policy owner. The codec
  (`src/protocol.js`) and persistence (`src/receipt.js`) layers must never
  import route policy. `test/dependency-boundaries.test.js` enforces the whole
  allowed-import matrix, including that `selectProtocolRoute` is defined in
  exactly one module.
- Put value canonicalizers (mode/route/confidence) and input parsers
  (list/command/label/trust/event-gate) in `src/normalize.js`; put glob
  matching and sensitive-file selection in `src/path-match.js`. Both are leaves
  with no local imports.
- Put the route policy in `src/router.js`: the automatic `routeReview` decision
  and the versioned `selectProtocolRoute` (floors, local-evidence reduction,
  successor handling). It is the single policy owner and imports the
  `decodeRoutingInputs` codec seam plus leaf canonicalizers, never codec
  internals.
- Put versioned routed-review decoding, privacy validation, stable hashing,
  receipt envelopes, and the `decodeRoutingInputs` typed routing-input record in
  `src/protocol.js`. It must not access the network, filesystem, environment,
  GitHub output surfaces, or route policy.
- Put pure versioned contract definitions — v2 budget-aware wire/storage shapes
  in `src/protocol-v2.js`, the `standard-v1` retention/deletion/legal-hold/
  purge contracts in `src/retention-policy.js`, and the immutable review
  candidate/prompt-profile catalog with its bounded safe projection and
  reference-aware retention classification in
  `src/review-candidate-catalog.js`, and the authoritative budget observations,
  shared/independent pools, idempotent reservations/leases, explicit
  overdrawn/quarantine state, and standard-v1 retention classification in
  `src/review-budget-ledger.js` — in their own leaf modules. The pure
  routed-review configuration compiler in `src/routed-review-compiler.js` sits
  one layer above those leaves: it imports the v2 source decoder from
  `src/protocol-v2.js` and the candidate safe projection from
  `src/review-candidate-catalog.js`, then compiles an explicit-mode v2 source
  (with a managed catalog safe projection or standalone setup-discovered handler
  profiles) into a canonical manifest with stable source, catalog, and output
  digests. It infers no mode and takes no ambient input beyond its arguments.
  Like `src/protocol.js` they must not access the network, filesystem,
  environment, GitHub output surfaces, or route policy, and they take no
  ambient time: every lifecycle/expiry computation receives an injected
  `nowIso` so fake-clock tests are deterministic. Each record carries exactly
  one retention data class; a conflicting classification fails closed rather
  than selecting the longer duration. New `src/*.js` modules must be added to
  the `check` script's `node --check` list and registered in
  `test/dependency-boundaries.test.js`.
- Put HTTP mechanics and GitHub endpoint methods in `src/github.js`.
- Put durable Check Run marker encoding, receipt lookup/reconciliation, and
  trusted successor-compare normalization in `src/receipt.js`; match
  bookkeeping paths through `src/path-match.js`, not the router.
- Put the shared normalized routing-context assembly in `src/risk-context.js`
  and the shared Copilot presence probe plus reviewer request in
  `src/reviewer-dispatch.js`. Both entrypoints use these services;
  entrypoint-specific concerns (standalone command/label/trust, the durable
  policy block, `route==="auto"` file gating, and successor compare) stay at the
  entrypoints.
- Put durable operation input staging, dispatch, bounded outputs, and summaries
  in `src/operations.js`; keep standalone event staging and the thin process
  entrypoint in `src/index.js`. Standalone stays policy-free and calls
  `routeReview` directly, never `selectProtocolRoute`.
- Mirror each boundary in `test/router.test.js`, `test/protocol.test.js`,
  `test/receipt.test.js`, `test/github.test.js`, `test/operations.test.js`,
  `test/action.test.js`, `test/dependency-boundaries.test.js`, and
  `test/shared-service-parity.test.js`.
- Put repository-only validation in `scripts/`; it must not become part of the
  shipped Action runtime.
- Treat every `sd-ai-command-pack-*` script as **pack-owned, not repo-owned**.
  This repository runs a thin install: the payload is not vendored here at all,
  it lives in the machine install under `~/.agents/bin/`, and the only pack
  files left in the tree are the repo-native surfaces plus the resolver at
  `.sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py`. The
  deterministic `pack.install-audit` check fails any local edit to a file the
  receipt still owns, reporting `installed target drifted from pack <version>
  content: <path>`, and the next pack refresh would overwrite the edit
  regardless. Change pack behavior upstream and consume it through a refresh;
  change pack *configuration* through the repo-owned JSON files under
  `.sd-ai-command-pack/`.

  ```text
  # Wrong: task planning names a pack-owned path as the change site
  relatedFiles: ["~/.agents/bin/sd-ai-command-pack-review.py"]

  # Correct: establish ownership from the machine install, not from memory
  ls ~/.agents/bin/sd-ai-command-pack-review.py   # present there, absent here -> pack-owned
  node ~/.agents/bin/sd-ai-command-pack-review-preflight.mjs  # the gate that refuses the edit
  ```

  Derive the editable set from the audit rather than from a list here: a list in
  this document goes stale silently while the audit stays authoritative. As
  observed against pack 0.64.3 it admitted only
  `.sd-ai-command-pack/{check,pr-body-scope,review-preflight,review}.json`.

  Establish ownership before planning, not after implementing: a task that
  reaches validation before discovering the boundary has already written work it
  must revert.

  A task parked on "resumes when a pack refresh carries the fix" is **not**
  cleared by the refresh happening. Nothing re-reads that sentence: the
  `PARKED:` title prefix and the `blocked`/`blockedOn` fields are what the
  backlog ranker machine-reads, so the task stays invisible until someone
  clears them by hand. Re-verify such a park against the pack file itself, not
  against the pack version number — a refresh that bumps the version without
  touching the file proves nothing in either direction. Under the thin install
  the file is on the machine, so read it there rather than from this
  repository's history, which stops at the conversion commit.

  ```bash
  # Does the machine copy carry the fix, and is the install pristine?
  grep -n "<the behavior you parked on>" ~/.agents/bin/sd-ai-command-pack-review.py
  python3 ~/.agents/bin/sd-ai-command-pack-install-audit.py   # prints payload provenance
  ```

  Observed 2026-08-15: `review.py` last changed at 0.71.1 while the repository
  had already advanced to 0.71.6, so the version alone answered neither
  question. The park outlived its blocker by four refreshes and the backlog
  reported one actionable task where there were two.

  Park a task with its resume condition in `blockedOn`, not with the `PARKED:`
  prefix alone. The prefix marks *that* a task is parked and nothing more:
  `candidate_block_status` in `~/.agents/bin/sd-ai-command-pack-work-loop.py` returns
  `reason_text or "parked"`, so a prefix-only park ranks as the literal string
  `parked` and a backlog report cannot tell a deliberate scope decision from a
  dependency block. Write what would unpark it and how to falsify it — the
  command or artifact to re-derive, not prose — because the next sweep re-checks
  the field, never the commit that created the park.

  ```bash
  # Does every parked record carry a reason the ranker can surface?
  python3 - <<'EOF'
  import json, pathlib
  for p in sorted(pathlib.Path(".trellis/tasks").iterdir()):
      if not p.is_dir() or p.name == "archive": continue
      t = json.loads((p / "task.json").read_text())
      if t.get("title", "").startswith("PARKED:") and not t.get("blockedOn"):
          print("prefix-only park:", p.name)
  EOF
  ```

  Observed 2026-08-15: sixteen tasks parked by one commit carried the prefix and
  nothing else, so their rationale survived only in that commit's message and
  every one of them ranked as the bare fallback `parked`. Answering "is this
  still valid?" meant reading git history.
- Treat `.trellis/**` as **template-managed, not vendored**. The two managed
  trees in this repository behave oppositely and the pack's rule does not carry
  over. `.trellis/.template-hashes.json` records the content hash Trellis last
  wrote; `trellis update` compares it and, for a file the user modified, prompts
  to overwrite, keep, or write `.new`. Trellis's own reference lists
  `.trellis/workflow.md`, `.trellis/config.yaml`, `docs/spec/**`, and
  `.trellis/scripts/**` as editable by default and states that update
  recognizing the result as user-modified is normal. So a hash entry means
  "reconciled by prompt", not "refuses your edit" — the opposite of
  `pack.install-audit`.

  ```bash
  # Is this path template-managed, and has anyone already diverged from it?
  python3 - <<'EOF'
  import hashlib, json, pathlib
  h = json.load(open(".trellis/.template-hashes.json"))["hashes"]
  for f, recorded in sorted(h.items()):
      p = pathlib.Path(f)
      if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() != recorded:
          print("locally modified:", f)
  EOF
  ```

  When a change must land in that tree, keep the tracked file's diff generic and
  minimal and put the repository-specific knowledge in a repo-owned path — a new
  file under `scripts/` carries no hash entry, so update never prompts for it.
  The diff you leave in a tracked file is the diff a human reconciles at the
  next update prompt.

  Check what a lifecycle extension point can actually do before designing
  against it. `run_task_hooks` in `.trellis/scripts/common/task_utils.py` prints
  `[WARN] Hook failed` on a nonzero exit and returns; Trellis documents only
  `after_*` events. An `after_start` hook therefore cannot refuse a start, and
  the ready gate at `.trellis/workflow.md` needs a check that runs *before* the
  status write — `cmd_start` in `.trellis/scripts/task.py`, which is the only
  path that flips a task to `in_progress`. `task.py create` activates the
  session pointer without that flip, so it is correctly outside the gate; a new
  task's manifests are always seed-only.

  Observed 2026-08-15: the pack rule was applied to `.trellis/` by analogy and a
  working route was nearly abandoned as unsafe. Both files involved were
  unmodified from template while 11 of the 259 tracked paths had already
  diverged.
- Keep consumer installation lifecycle code under `scripts/consumer-installer.mjs`
  and `scripts/consumer-installer/`, with a thin `scripts/install-consumer.mjs`
  entrypoint. It may manage consumer files and bounded GitHub metadata, but must
  not import into the Action runtime, commit consumer changes, or serialize
  provider credentials. The lifecycle is decomposed along one downhill
  dependency direction: `consumer-installer/codecs.mjs` is the leaf (constants,
  manifest/config/CLI codecs, `validateConfiguration`, `decodeManifest`);
  `transport.mjs` (subprocess `gh`/git transport, `GitHubCli`, source
  provenance), `persistence.mjs` (containment guard, atomic write/remove, local
  state), and pure `plan.mjs` (resource/manifest planning from decoded
  snapshots) import only the codec leaf; `consumer-installer.mjs` is
  orchestration (`resolveTarget`, `applyRemoteActions`, install/update/adopt/
  check/uninstall, `runConsumerInstaller`) and re-exports every public symbol so
  the entrypoint and test suite import from it unchanged. `plan.mjs` performs no
  filesystem, `gh`, git, or environment access.
  `test/installer-dependency-boundaries.test.js` freezes this import matrix
  (leaf purity, completeness, and acyclicity) so a future edit cannot re-invert
  transport/persistence/plan into a cycle.

## Naming Conventions

Use lowercase hyphenated names for workflows/docs and lowercase module names
for JavaScript. Use behavior-oriented camelCase names for exports and instance
methods, such as `routeReview()`, `GitHubClient#listPullRequestFiles()`, and
`writeSummary()`.

## Examples

- `resolveExplicitMode()` in `src/normalize.js` centralizes the precedence used
  by both early orchestration and `routeReview()` in `src/router.js`.
- `GitHubClient` in `src/github.js` owns all REST headers and pagination.
- `runAction()` in `src/index.js` is injectable while `main()` remains the
  thin process entrypoint.
