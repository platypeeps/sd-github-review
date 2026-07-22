# Quality Guidelines

> Code quality standards for the dependency-light GitHub Action runtime.

## Overview

Production code is modern ECMAScript modules running on the Node version
declared by `action.yml`. Keep routing policy pure in `src/router.js`, GitHub
transport in `src/github.js`, and event orchestration in `src/index.js`.
Prefer injected boundaries over process-wide mocks so behavior can be tested
with Node's built-in test runner.

## Scenario: Route and Request a GitHub Review

### 1. Scope / Trigger

Use this contract whenever an Action input, supported GitHub event, routing
rule, output, or reviewer side effect changes. These boundaries span workflow
metadata, event orchestration, pure policy, and the GitHub REST API.

### 2. Signatures

- `runAction({ event, eventName, env, clientFactory, outputWriter,
  summaryWriter, logger }) -> Promise<{ decision, outputs, changedLines,
  sensitiveFiles, copilotRequested }>`
- `routeReview(context) -> { route, reason }`
- `GitHubClient.listPullRequestFiles(number) -> Promise<string[]>`
- `GitHubClient.requestReviewer(number, reviewer) -> Promise<object|null>`

### 3. Contracts

- `mode`: `auto|cheap|deep|copilot|none`; explicit configuration outranks
  commands, labels, draft gating, and automatic risk rules.
- Trusted `/review <mode>` commands and `review:<mode>` labels override only
  automatic routing. Unrelated comments and labels return `none` before client
  construction.
- `route`, `reason`, `model`, `pull-request-number`, `changed-lines`,
  `sensitive-files`, `run-external-reviewer`, and `copilot-requested` are
  delimiter-form GitHub outputs.
- `GITHUB_REPOSITORY` and `GITHUB_API_URL` configure REST calls;
  `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are optional output sinks.
- `github-token` is required only once a route needs GitHub API access.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown mode or confidence | Throw a field-specific validation error |
| Missing/invalid PR number | Throw before GitHub client construction |
| Untrusted or unrelated comment | Emit `none`; make no GitHub request |
| Conflicting review labels | Throw and fail the Action |
| Automatic route over 3,000 files | Throw and require an explicit route |
| Non-success GitHub response | Include method, path, and API message in the error |
| Existing Copilot request/review for current HEAD | Do not request again; emit `copilot-requested=false` |

### 5. Good/Base/Bad Cases

- Good: an explicit `deep` command fetches PR metadata, skips file listing,
  and emits the configured deep model.
- Base: a routine automatic PR lists files once and emits `cheap` plus
  `run-external-reviewer=true`.
- Bad: an unrelated comment constructs a GitHub client or a sensitive route
  requests Copilot again after it reviewed the current head.

### 6. Tests Required

- Router tests assert the entire precedence order and exact route/reason pair.
- Orchestration tests inject a client and assert both outputs and forbidden
  calls such as `listPullRequestFiles()` or `requestReviewer()`.
- Transport tests assert the API-version/auth headers, pagination termination,
  request payload, and surfaced error text.
- Metadata tests parse every checked-in workflow/example and reject floating
  third-party Action references.

### 7. Wrong vs Correct

```js
// Wrong: automatic-only API work happens before explicit routing is known.
const files = await client.listPullRequestFiles(number);
const decision = routeReview({ configuredMode, commandMode, labelMode, files });

// Correct: resolve event and explicit routes first; list files only when
// sensitive-path evaluation can still affect the decision.
const explicitMode = resolveExplicitMode({ configuredMode, commandMode, labelMode });
const files = explicitMode ? [] : await client.listPullRequestFiles(number);
```

## Forbidden Patterns

- Do not check out or execute pull-request-authored code in a secret-bearing
  `issue_comment` workflow.
- Do not use floating third-party Action references in checked-in workflows.
- Do not fetch pull-request files before event gating or when an explicit route
  makes automatic path evaluation irrelevant.
- Do not add a runtime dependency when a small standard-library solution is
  sufficient; justify any exception in the active task design.
- Do not swallow GitHub API failures or turn them into a successful routing
  result.

## Required Patterns

- Validate Action inputs at the boundary and produce explicit errors for
  invalid values.
- Escape workflow-command annotations and use delimiter-form GitHub outputs so
  multiline values cannot alter workflow syntax.
- Keep GitHub API calls in `GitHubClient` and inject `fetch` for contract tests.
- Keep routing precedence centralized in `routeReview()` and add regression
  coverage whenever precedence or event gating changes.
- Pin consumer examples to reviewed full commit SHAs before use; placeholders
  in templates must be called out in the accompanying documentation.

## Testing Requirements

Use `node:test` and `node:assert/strict`. Behavior changes require focused unit
or orchestration tests, including negative side-effect assertions when a route
must avoid a GitHub call. GitHub transport tests cover request headers,
pagination, payloads, and surfaced API errors.

Before review, run:

```sh
npm test
npm run check
npm run validate:metadata
python3 scripts/sd-ai-command-pack-install-audit.py
git diff --check
```

CI must run the JavaScript, test, and metadata gates on the exact PR head.

## Code Review Checklist

- Routing precedence still matches `DESIGN.md` and `test/router.test.js`.
- Irrelevant and explicit events avoid unnecessary GitHub API work.
- New side effects have success, failure, and deduplication coverage.
- Workflow permissions are minimal and no provider secret reaches PR code.
- Action runtime, metadata, examples, and README installation guidance agree.
- Release or consumer references use immutable reviewed SHAs.
