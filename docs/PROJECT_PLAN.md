# SD GitHub Review Project Plan

## Purpose

`sd-github-review` should provide a small, auditable GitHub Action that routes
pull requests to the least-expensive appropriate review path without weakening
deterministic CI or human review. It selects a route; it does not become an LLM
credential broker or a replacement for branch protection.

## Current Baseline

- The canonical architecture, selection rules, output contract, security
  boundaries, and backend plan are documented in `DESIGN.md`.
- Thirty routing, orchestration, GitHub-client, and metadata tests pass
  locally; the candidate CI run remains part of the release gate.
- The repository is public, `main` is protected, and the SD AI command pack is
  installed for the active local frameworks.

## Delivery Principles

1. Keep the router dependency-free unless a concrete reliability requirement
   justifies a runtime dependency.
2. Treat AI review as supplemental to deterministic checks and human policy.
3. Minimize token permissions and never execute pull-request code with secrets
   from an `issue_comment` workflow.
4. Make every paid or privileged review request explicit, observable, and as
   idempotent as GitHub permits.
5. Ship a narrow, verified action before adding provider-specific convenience.

## Roadmap

### Phase 0: Project Foundation

- Replace the generic full-stack Trellis spec scaffolding with conventions
  derived from this JavaScript GitHub Action.
- Keep developer journals and other local-only framework state out of public
  history.

### Phase 1: First-Release Hardening

- Short-circuit irrelevant events and explicit routes before automatic-only
  file enumeration.
- Add contract tests for GitHub pagination, failures, reviewer requests,
  action inputs, outputs, summaries, and event handling.
- Validate action/workflow metadata in CI and pin third-party Actions by SHA.
- Document a repeatable release gate and a runnable consumer smoke test.

The initial Trellis task is
`.trellis/tasks/07-21-harden-first-release/`.

### Phase 2: Pilot Adoption

- Treat a successful internal pilot as a prerequisite for public `v0.1.0`.
- Use a dedicated private repository,
  `platypeeps/sd-github-review-pilot`, so pilot failures cannot affect an
  existing project and automatic Copilot review does not mask the request path.
- Exercise automatic, command, and label routing plus a live Copilot review
  request. Validate cheap/deep as outputs only; do not connect an external
  reviewer or provider credentials during the initial pilot.
- Create the documented `review:*` labels needed by the pilot scenarios.
- Record false-positive routing, duplicate-trigger behavior, API usage, and
  operator friction before broad rollout.

### Phase 3: Operational Maturity

- Add bounded retry/backoff and clearer rate-limit diagnostics.
- Define concurrency and deduplication behavior for synchronize, label, and
  command events.
- Add tested Gito and PR-Agent adapter examples, followed by a documented
  command or HTTP contract for internal review services.
- Publish semantic releases and immutable SHA examples, then test upgrades in
  a small consumer fleet.
- Add optional setup tooling only for repeated, evidenced adoption pain.

## Potential Issues

| Priority | Issue | Evidence | Planned response |
| --- | --- | --- | --- |
| P1 | Events that should be no-ops still reach pull-request file enumeration before routing. Explicit routes also enumerate files even though path risk cannot change the result. Very large PRs can therefore fail despite the error advising an explicit route. | `src/index.js:86`, `src/index.js:105`, `src/github.js:39` | Phase 1 event/decision staging and regression tests. |
| P1 | Tests cover routing rules but not the GitHub client or action entrypoint, leaving pagination, API errors, output encoding, reviewer deduplication, and event payload handling unverified. | `test/router.test.js:1`, `src/index.js:31`, `src/github.js:20` | Phase 1 contract and orchestration tests. |
| P1 | There is no release or tag, while the quick start requires consumers to pin a released commit SHA. | `README.md:14`; live repository has no tags or releases | Define and pass a release gate before publishing `v0.1.0`. |
| P2 | The example intentionally contains an action placeholder and a nonexistent external-reviewer command; copying it without completing both edits fails at runtime. | `examples/review-router.yml:20`, `examples/review-router.yml:41` | Add a smoke-tested example and an explicit preflight checklist. |
| P2 | CI runs unit tests and syntax checks only; it does not validate action metadata or workflow syntax, and third-party Actions use floating major tags. | `.github/workflows/ci.yml:11` | Add metadata/workflow validation and pin Actions by full SHA. |
| P2 | Empty cheap/deep model inputs can still emit `run-external-reviewer=true`, leaving provider-default behavior implicit in each consumer. | `src/index.js:135`, `src/index.js:148`, `action.yml:31` | Decide whether empty means consumer default or configuration error, then test and document it. |
| P2 | GitHub-hosted runners have deprecated the Node.js 20 action runtime and force it onto Node.js 24. | Initial private pilot run `29887640242` | Declare `node24`, test on Node.js 24 in CI, and repin the pilot to the corrected candidate. |
| P2 | The Trellis bootstrap task and specs assume a generic full-stack application, so future agents may receive irrelevant database/frontend guidance. | `.trellis/tasks/00-bootstrap-guidelines/prd.md:1` | Complete or replace the bootstrap guidance before broad implementation. |
| P3 | GitHub requests have no bounded retry/backoff or rate-limit-specific diagnostics. | `src/github.js:20` | Defer until pilot evidence shows the needed policy. |
| P3 | External reviewer invocations have no cross-run deduplication contract. | `examples/review-router.yml:35` | Measure during pilot, then define concurrency behavior. |
| P3 | GitHub removes Copilot from requested reviewers after it accepts, so requested-reviewer-only deduplication can re-request a completed review for the same commit. | Initial private pilot review state | Also inspect completed reviews for the current head SHA before requesting Copilot. |

## Explicit Non-Goals

- Hosting or selecting an LLM provider for consumers.
- Storing provider credentials in this action.
- Replacing required CI, security tooling, or human approval.
- Supporting every GitHub event or review vendor in the first release.

## Success Measures

- Automatic routing decisions are deterministic and covered by tests.
- Irrelevant events make no unnecessary pull-request file requests.
- A consumer can install a pinned release and complete a smoke PR using only
  documented configuration.
- The pilot demonstrates routing outputs and a live Copilot request without
  introducing external reviewer credentials.
- Public `v0.1.0` is published only after the internal pilot meets its exit
  criteria.
- Review requests are explainable from step outputs and summaries.
- Pilot data supports any later retry, concurrency, or setup automation.
