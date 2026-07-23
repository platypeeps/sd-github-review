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

## Scenario: Validate Public Repository Metadata

### 1. Scope / Trigger

Use this contract when adding or changing Trellis, AI-tool, workspace, install
receipt, environment-template, or other repository metadata paths.

### 2. Signatures

- `prohibitedPublishedMetadataReason(filePath) -> string|null`
- `validateMetadata(repositoryRoot) -> Promise<{ workflowCount,
  exampleCount, trackedPathCount, ... }>`
- CLI: `npm run validate:metadata`

### 3. Contracts

- Classify normalized POSIX-style paths from `git ls-files -z`; ignore rules
  are not evidence that an already tracked path is safe.
- Keep shared Trellis workflow/spec/task data, bounded workspace Markdown,
  platform adapters, and command-pack receipts public.
- Reject environment secrets, Trellis runtime/identity/temp state, workspace
  transcripts or attachments, and AI-tool cache/log/session/local state.
- `docs/PUBLIC_METADATA_POLICY.md` owns the complete human allow/deny policy
  and existing-history decision.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Tracked path matches a prohibited family | Fail and list the path plus reason |
| `git ls-files` fails | Fail closed with repository and Git context |
| Shared adapter or task/spec path | Accept |
| Workspace `index.md` or `journal-N.md` | Accept as public project history |
| Other tracked workspace file | Fail as an unsupported publication surface |

### 5. Good/Base/Bad Cases

- Good: a generated shared skill is tracked and its cache remains ignored.
- Base: a reviewed Trellis journal records commits and test outcomes only.
- Bad: `.trellis/.developer` is force-added and validation silently passes.

### 6. Tests Required

- Table-test representative prohibited and public paths.
- Force-add a prohibited fixture path to a temporary Git index and assert the
  full validator rejects it.
- Run the validator against the repository and assert tracked-path inspection
  succeeds.

### 7. Wrong vs Correct

```js
// Wrong: ignored files are assumed to be untracked.
if (isIgnored(filePath)) return;

// Correct: validate the authoritative tracked-file set.
const trackedPaths = await gitLsFiles(repositoryRoot);
const failures = trackedPaths.filter(prohibitedPublishedMetadataReason);
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
