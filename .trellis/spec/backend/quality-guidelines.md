# Quality Guidelines

> Code quality standards for the dependency-light GitHub Action runtime.

## Overview

Production code is modern ECMAScript modules running on the Node version
declared by `action.yml`. Keep routing policy pure in `src/router.js`, GitHub
transport in `src/github.js`, event orchestration in `src/index.js`, and the
versioned routed-review protocol in `src/protocol.js`.
Prefer injected boundaries over process-wide mocks so behavior can be tested
with Node's built-in test runner.

## Scenario: Decode And Select A Routed Review

### 1. Scope / Trigger

Use this contract for the v1 request/receipt protocol consumed by later durable
receipt and on-demand dispatch work. The protocol layer is pure: it validates
and canonicalizes caller data but never reads GitHub, the checkout, process
state, or output files.

### 2. Signatures

- `decodeReviewRequest(value) -> normalizedRequest`
- `deriveLogicalDispatchId(request) -> 64-character SHA-256 digest`
- `deriveRequestFingerprint(request) -> 64-character SHA-256 digest`
- `decodeLocalReviewSummary(value, expectedIdentity?) -> normalizedSummary`
- `decodeBackend(value) -> normalizedBackend`
- `decodeAdapterAcknowledgment(value) -> normalizedAcknowledgment`
- `decodeSuccessorEvidence(value) -> normalizedEvidence`
- `decodeReceipt(value) -> normalizedReceipt`
- `selectProtocolRoute({ request, routingContext, policy }) -> decision`

### 3. Contracts

- Schema major is the numeric value `1`; scalar and container types are exact.
- Repository owner/name and full 40- or 64-character head OIDs normalize to
  lowercase before identity or fingerprint derivation.
- Logical dispatch identity hashes only schema, repository, PR, head, and
  attempt. The request fingerprint hashes every normalized dispatch-relevant
  field but excludes primary, alias, and superseded correlation IDs.
- Compatibility identity/fingerprint fields are recomputed and must match.
- Requests are at most 16 KiB, local/supporting envelopes 8 KiB, and receipts
  32 KiB. Field, collection, and 32-level JSON nesting bounds are enforced
  before later side effects.
- Paths, source, prompts, findings, transcripts, credentials, configuration
  values, and local artifact contents are recursively rejected even inside
  otherwise unknown additive v1 fields.
- Exact-head clean or fully dispositioned local evidence may lower only
  `auto`; failed, cancelled, skipped, stale, dirty, malformed, or
  low-confidence evidence contributes no positive confidence.
- Only normalized GitHub-compare successor evidence matching the declared
  prior receipt and current head may take the bookkeeping-only `none` path.
- Sensitive/large-change and configured independent-review floors apply after
  automatic reductions. Explicit route intent retains precedence.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Reordered equivalent allow-listed input | Produce the same canonical digest |
| New head or attempt | Produce a new logical identity and fingerprint |
| New correlation alias | Preserve identity and fingerprint |
| New route, policy reference, or validated evidence | Preserve logical identity; change fingerprint |
| Spoofed compatibility digest | Throw before future dispatch |
| Non-positive local outcome with positive confidence | Throw |
| Sensitive/large change plus local-clean reduction | Retain the Copilot floor |
| Bookkeeping successor plus required remote floor | Emit the floor, not `none` |
| Receipt/backend/finding-channel mismatch | Throw before publication |

### 5. Good/Base/Bad Cases

- Good: exact-head, fully dispositioned local evidence lowers a low-confidence
  automatic `deep` route to configured `cheap`, then a configured floor is
  applied if present.
- Base: no local or successor evidence leaves existing automatic router policy
  unchanged.
- Bad: a caller changes correlation ID and supplies a conflicting fingerprint,
  or uses `skipped:bookkeeping-successor` as trusted comparison evidence.

### 6. Tests Required

- Load every canonical valid/invalid fixture from `fixtures/protocol/v1/`.
- Assert stable identity/fingerprint invariants and compatibility rejection.
- Cover strict types, malformed identity, privacy fields, size limits, local
  outcomes, successor classes, explicit routes, and independent-review floors.
- Keep the existing router suite green to prove standalone behavior is
  unchanged.

### 7. Wrong vs Correct

```js
// Wrong: correlation is treated as a side-effect identity.
const id = sha256(request.correlationId);

// Correct: derive after validation from exact repository/PR/head/attempt.
const request = decodeReviewRequest(input);
const id = request.logicalDispatchId;
```

## Scenario: Persist And Reconcile A Routed-Review Receipt

### 1. Scope / Trigger

Use this contract when creating, querying, or advancing the durable
`sd-github-review/receipt` Check Run, or when deriving trusted successor
evidence from GitHub compare metadata.

### 2. Signatures

- `GitHubClient.compareCommits(base, head) -> comparison`
- `GitHubClient.listCheckRuns(head, name) -> checkRuns`
- `GitHubClient.createCheckRun(payload) -> checkRun`
- `GitHubClient.updateCheckRun(id, payload) -> checkRun`
- `ReceiptStore.begin(request, options) -> { state, receipt, dispatchAllowed, reconciliationRequired }`
- `ReceiptStore.query(identity) -> receipt|null`
- `ReceiptStore.acknowledge(input) -> transitionResult`
- `ReceiptStore.observe(input) -> transitionResult`
- `ReceiptStore.compareSuccessor(request) -> { evidence, counts, truncated }`

### 3. Contracts

- The Check Run name is `sd-github-review/receipt`, `head_sha` is the full
  request head, and `external_id` is the protocol-derived logical dispatch ID.
- Check output text is exactly one v1 marker plus canonical normalized receipt
  JSON. Noncanonical, malformed, wrong-head, contradictory, or duplicate
  evidence fails closed.
- `begin()` re-reads the live PR head before lookup, immediately before create,
  and after create before it returns dispatch authorization.
- A matching retry reuses the receipt and may append correlation aliases. A
  conflicting fingerprint throws before another dispatch is possible.
- `started`, `acknowledged`, and `observed` are monotonic. Interrupted
  `started` mutations and ambiguous GitHub writes return reconciliation
  required and never recommend fallback dispatch.
- Same-head rerequest requires the next attempt, exact prior receipt and
  logical identity, unchanged policy/route/backend, backend rerequest support,
  and explicit repository-policy authorization.
- Compare pagination follows commit pages. GitHub exposes changed files only
  on page one and caps them at 300, so the cap is treated as truncated.
- Successor normalization hashes path-sensitive metadata and returns only a
  bounded class, digest, counts, and truncation flag; raw paths and patches do
  not leave the receipt boundary.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Matching identity and fingerprint | Return existing receipt; never dispatch twice |
| Matching retry with new correlation | Append the alias through the same Check Run |
| Conflicting fingerprint or duplicate Check Runs | Throw before dispatch |
| Check mutation response is uncertain | Return reconciliation required with dispatch forbidden |
| Live head differs before/after create | Return no dispatch authorization |
| Valid acknowledgment then observation | Advance one Check Run monotonically |
| Rewritten or non-ancestral compare | Classify `non-comparable` |
| Incomplete/inconsistent compare | Classify `ambiguous` |
| 300-file cap or configured maximum exceeded | Classify `oversized` |
| Mixed bookkeeping and source files | Classify `mixed` |

### 5. Good/Base/Bad Cases

- Good: one exact-head receipt is created, re-read, and returned as the same
  canonical envelope written into the Check Run.
- Base: a matching retry reads the existing receipt and returns no new dispatch
  authorization.
- Bad: a failed create response causes the caller to try another backend
  without first reconciling the durable logical identity.

### 6. Tests Required

- Assert Check Run and compare endpoint methods, paths, headers, pagination,
  payloads, and errors through injected fetch.
- Cover create/query/update, alias retry, fingerprint conflict, malformed and
  duplicate checks, head changes, ambiguous mutations, phase transitions, and
  same-head rerequest gates.
- Cover bookkeeping-only, mixed, content-changing, oversized, rewritten,
  incomplete, and changed-head successor comparisons.
- Assert serialized receipt and successor results contain no raw paths,
  findings, prompts, credentials, configuration values, or pricing data.

### 7. Wrong vs Correct

```js
// Wrong: absence after an uncertain create authorizes a fallback provider.
await dispatchFallback();

// Correct: durable identity ambiguity always stops dispatch.
return { reconciliationRequired: true, dispatchAllowed: false };
```

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
