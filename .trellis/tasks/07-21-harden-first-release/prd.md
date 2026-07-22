# Harden MVP for first release

## Goal

Make the existing GitHub Action safe and verifiable enough for a first pilot
release without expanding it into a hosted reviewer or provider integration.

The task delivers confidence in the action's event handling, GitHub API
behavior, published metadata, and consumer setup. The release strategy is an
internal pilot first; public `v0.1.0` follows only after the pilot exit criteria
pass.

## Background

- The routing policy is implemented in `src/router.js` and has twelve passing
  unit tests in `test/router.test.js`.
- `src/index.js:86-106` fetches PR metadata and enumerates changed files before
  `routeReview()` can reject unrelated events or honor an explicit route.
- `src/github.js:39-48` rejects PRs beyond 3,000 files even though an explicit
  route should not require automatic sensitive-path evaluation.
- `src/github.js` and the orchestration/output behavior in `src/index.js` have
  no direct automated coverage.
- `.github/workflows/ci.yml` runs tests and syntax checks but does not validate
  action/workflow metadata; its third-party Actions use floating major tags.
- The public repository has no tags or releases, while `README.md:14-17`
  instructs consumers to pin a released SHA.

## Requirements

- **R1 — Preserve routing semantics.** Fixed mode, trusted command, label,
  draft, sensitive path, size, confidence, and default precedence must remain
  consistent with the documented routing order.
- **R2 — Avoid unnecessary API work.** Unrelated issue comments and unrelated
  label events must return `none` without fetching PR files. Explicit routes
  must not enumerate files when sensitive-path evaluation cannot alter the
  result.
- **R3 — Cover GitHub contracts.** Automated tests must cover request headers,
  pagination, API error propagation, the 3,000-file boundary, requested-reviewer
  deduplication, and reviewer request payloads.
- **R4 — Cover action orchestration.** Automated tests must cover representative
  pull-request, label, trusted/untrusted comment, draft, explicit, and Copilot
  flows, including outputs, summaries, and error annotations.
- **R5 — Validate shipped metadata.** CI must validate `action.yml` and checked-in
  workflow syntax in addition to Node tests and syntax checks. Third-party
  Actions in CI must be pinned to immutable commit SHAs.
- **R6 — Define consumer readiness.** Documentation must distinguish the
  runnable router from required consumer-owned model variables and external
  reviewer adapter, and provide a first-release checklist and smoke scenario.
- **R7 — Keep the runtime small.** The shipped action must remain compatible
  with Node.js 20 and dependency-free unless implementation evidence shows a
  dependency is necessary.
- **R8 — Preserve security boundaries.** The example must not check out or run
  PR-authored code with provider secrets in an `issue_comment` context, and the
  router must continue to require only the minimum documented GitHub token
  permission.
- **R9 — Gate the public release on a pilot.** The release checklist must define
  an internal pilot, its success/failure evidence, and the explicit decision
  point before publishing `v0.1.0`.
- **R10 — Keep the pilot provider-free.** The initial pilot must exercise
  routing plus the live Copilot request path. Cheap/deep routes are validated
  through outputs only; no external reviewer runtime or provider credential is
  connected.
- **R11 — Isolate the pilot.** Use a dedicated private repository named
  `platypeeps/sd-github-review-pilot` with no automatic Copilot review ruleset,
  so the live request path is exercised without affecting an existing project.

## Acceptance Criteria

- [ ] Existing routing tests remain green and new tests lock the documented
  precedence without changing intentional behavior.
- [ ] Unrelated comments and labels perform no PR-file listing, verified with
  injected/mocked GitHub client assertions.
- [ ] A fixed or otherwise explicit route succeeds for a simulated PR beyond
  3,000 files without attempting automatic file enumeration.
- [ ] GitHub client tests cover multi-page results, final-page termination,
  HTTP failures, reviewer lookup, and reviewer-request payloads.
- [ ] Entrypoint/orchestration tests verify outputs and summaries for at least
  cheap, deep, Copilot, and none routes, plus one failing input/API case.
- [ ] CI validates JavaScript, tests, action metadata, and workflow syntax with
  immutable third-party Action references.
- [ ] The quick start clearly identifies every consumer-owned placeholder and
  includes a smoke-test procedure that does not expose secrets to PR code.
- [ ] A documented release checklist defines version/tag naming, required
  checks, immutable SHA guidance, and rollback steps.
- [ ] The checklist identifies the pilot repository, exercised routes,
  observation window, exit criteria, and rollback procedure.
- [ ] `platypeeps/sd-github-review-pilot` is private, contains no provider
  credentials, and has no automatic Copilot review ruleset during the request
  test.
- [ ] Pilot scenarios cover automatic, trusted-command, and label routing;
  at least one scenario creates or verifies a live Copilot review request.
- [ ] Cheap/deep scenarios assert `route`, `model`, and
  `run-external-reviewer` outputs without executing an external reviewer.
- [ ] The pilot workflow contains no LLM provider credentials.
- [ ] No public `v0.1.0` tag or release is created until the recorded pilot
  evidence satisfies the exit criteria.
- [ ] `npm test`, `npm run check`, metadata/workflow validation, and
  `git diff --check` all pass.

## Out of Scope

- Publishing a tag or GitHub release before the internal pilot passes and the
  maintainer separately approves publication.
- Implementing PR-Agent, Gito, or another external reviewer runtime.
- Provider credential storage or organization-wide rollout automation.
- Retry/backoff and cross-run deduplication unless required to make the pilot
  reliable.
