# Directory Structure

> Module boundaries for the GitHub Action and its repository tooling.

## Directory Layout

```text
src/                 # dependency-free Action runtime
  index.js           # standalone/durable entrypoint and GitHub outputs
  operations.js      # on-demand route/finalize/query orchestration
  router.js          # pure routing policy
  protocol.js        # versioned request/receipt decoding and canonical identity
  receipt.js         # exact-head Check Run receipt storage and reconciliation
  github.js          # GitHub REST transport
test/                # node:test suites mirroring runtime boundaries
fixtures/protocol/   # canonical versioned protocol behavior fixtures
fixtures/setup/      # read-only setup discovery fixtures
config/              # published versioned setup capability descriptor
scripts/             # repository validation and SD pack helpers
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

- Put deterministic policy, parsing, trust, and glob behavior in
  `src/router.js`.
- Put versioned routed-review decoding, privacy validation, stable hashing,
  receipt envelopes, and pure local/successor policy inputs in
  `src/protocol.js`. It must not access the network, filesystem, environment,
  or GitHub output surfaces.
- Put HTTP mechanics and GitHub endpoint methods in `src/github.js`.
- Put durable Check Run marker encoding, receipt lookup/reconciliation, and
  trusted successor-compare normalization in `src/receipt.js`.
- Put durable operation input staging, dispatch, bounded outputs, and summaries
  in `src/operations.js`; keep standalone event staging and the thin process
  entrypoint in `src/index.js`.
- Mirror each boundary in `test/router.test.js`, `test/protocol.test.js`,
  `test/receipt.test.js`, `test/github.test.js`, `test/operations.test.js`, and
  `test/action.test.js`.
- Put repository-only validation in `scripts/`; it must not become part of the
  shipped Action runtime.

## Naming Conventions

Use lowercase hyphenated names for workflows/docs and lowercase module names
for JavaScript. Use behavior-oriented camelCase names for exports and instance
methods, such as `routeReview()`, `GitHubClient#listPullRequestFiles()`, and
`writeSummary()`.

## Examples

- `resolveExplicitMode()` in `src/router.js` centralizes precedence used by
  both early orchestration and the final route decision.
- `GitHubClient` in `src/github.js` owns all REST headers and pagination.
- `runAction()` in `src/index.js` is injectable while `main()` remains the
  thin process entrypoint.
