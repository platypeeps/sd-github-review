# Directory Structure

> Module boundaries for the GitHub Action and its repository tooling.

## Directory Layout

```text
src/                 # dependency-free Action runtime
  index.js           # input/event orchestration and GitHub outputs
  router.js          # pure routing policy
  github.js          # GitHub REST transport
test/                # node:test suites mirroring runtime boundaries
scripts/             # repository validation and SD pack helpers
examples/            # consumer-owned workflow templates
docs/                # project and release operations
.github/workflows/   # repository CI only
```

`action.yml` is the public runtime manifest. `DESIGN.md` owns architecture and
routing semantics; `README.md` owns consumer installation.

## Module Organization

- Put deterministic policy, parsing, trust, and glob behavior in
  `src/router.js`.
- Put HTTP mechanics and GitHub endpoint methods in `src/github.js`.
- Put environment input decoding, event staging, side effects, outputs, and
  summaries in `src/index.js`.
- Mirror each boundary in `test/router.test.js`, `test/github.test.js`, and
  `test/action.test.js`.
- Put repository-only validation in `scripts/`; it must not become part of the
  shipped Action runtime.

## Naming Conventions

Use lowercase hyphenated names for workflows/docs and lowercase module names
for JavaScript. Export behavior-oriented camelCase functions such as
`routeReview`, `listPullRequestFiles`, and `writeSummary`.

## Examples

- `resolveExplicitMode()` in `src/router.js` centralizes precedence used by
  both early orchestration and the final route decision.
- `GitHubClient` in `src/github.js` owns all REST headers and pagination.
- `runAction()` in `src/index.js` is injectable while `main()` remains the
  thin process entrypoint.
