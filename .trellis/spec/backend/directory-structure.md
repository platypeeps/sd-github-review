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
  receipt.js           # exact-head Check Run receipt storage and reconciliation
  risk-context.js      # shared normalized routing-context builder
  reviewer-dispatch.js # shared Copilot presence probe and reviewer request
  normalize.js         # leaf: value canonicalizers and input parsers
  path-match.js        # leaf: glob matching and sensitive-file selection
  github.js            # GitHub REST transport
test/                # node:test suites mirroring runtime boundaries
fixtures/protocol/   # canonical versioned protocol behavior fixtures
fixtures/setup/      # read-only setup discovery fixtures
config/              # published versioned setup capability descriptor
scripts/             # repository validation, consumer lifecycle, and SD pack helpers
  install-consumer.mjs        # thin consumer-installer CLI entrypoint (process I/O)
  consumer-installer.mjs      # consumer lifecycle orchestration + public re-exports
  consumer-installer/         # decomposed installer boundaries (downhill deps)
    codecs.mjs                # leaf: constants, manifest/config/CLI codecs, validation
    transport.mjs             # gh/git subprocess transport, GitHubCli, provenance
    persistence.mjs           # path-containment guard, atomic write/remove, local state
    plan.mjs                  # pure lifecycle planning from decoded snapshots
examples/            # consumer-owned workflow templates
docs/                # project and release operations
.github/workflows/   # repository CI only
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
  `src/review-candidate-catalog.js` — in their own leaf modules. The pure
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
