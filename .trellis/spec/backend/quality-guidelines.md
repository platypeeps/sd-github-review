# Quality Guidelines

> Code quality standards for the dependency-light GitHub Action runtime.

## Overview

Production code is modern ECMAScript modules running on the Node version
declared by `action.yml`. Keep routing policy pure in `src/router.js`, GitHub
transport in `src/github.js`, standalone orchestration in `src/index.js`,
durable operations in `src/operations.js`, and the versioned routed-review
protocol in `src/protocol.js`.
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
- `decodeAdapterRequest(value) -> normalizedAdapterRequest`
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
- Sensitive/large-change floors use the validated `high-risk-route`
  (`deep|copilot`) and, together with configured independent-review floors,
  apply after automatic reductions. Explicit route intent retains precedence
  over automatic reduction but is bounded above by `policy.routePolicy` (the
  repository's `REVIEW_ROUTE_MODE`); an explicit route outside it is refused
  before routing and before any receipt write. `auto` is always permitted, so
  the floor and risk rules still choose the automatic route.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Reordered equivalent allow-listed input | Produce the same canonical digest |
| New head, or new attempt with a matching `rerequestOf` | Produce a new logical identity and fingerprint |
| `attempt` above 1 without `rerequestOf` | Throw at decode, before identity derivation |
| New correlation alias | Preserve identity and fingerprint |
| New route, policy reference, or validated evidence | Preserve logical identity; change fingerprint |
| Spoofed compatibility digest | Throw before future dispatch |
| Non-positive local outcome with positive confidence | Throw |
| Sensitive/large change plus local-clean reduction | Retain the configured high-risk floor |
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
- A matching retry reuses the receipt and may append correlation aliases,
  unless the stored receipt records a skip and the fresh decision does not --
  that one case replaces the receipt in place and authorizes its first
  dispatch, because a skip represents no dispatched work. A conflicting
  fingerprint throws before another dispatch is possible.
- `started`, `acknowledged`, and `observed` are monotonic. An interrupted
  `started` mutation returns `in-flight` until the receipt outlives
  `stranded-receipt-minutes` or its dispatch is recorded failed, and
  reconciliation required thereafter. Ambiguous GitHub writes return
  reconciliation required immediately. Neither ever recommends fallback
  dispatch.
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
| Matching identity and fingerprint | Return existing receipt; never dispatch twice, except a recorded skip below |
| Recorded skip whose fresh decision is not a skip | Supersede the receipt in place and authorize its first dispatch |
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

## Scenario: Run An On-Demand Routed Review

### 1. Scope / Trigger

Use this contract for `operation=route|acknowledge|finalize|query` and for the
published setup descriptor/on-demand workflows.

### 2. Signatures

- `runDurableAction(options) -> operationResult`
- `normalizeOperation(value) -> standalone|route|acknowledge|finalize|query`
- `buildAdapterAcknowledgment(adapterRequest, outcome, acknowledgedAt) -> normalizedAcknowledgment`
- `writeDurableSummary(result, sinks) -> Promise<void>`

### 3. Contracts

- Every durable operation accepts one decoded v1 `review-request` and uses its
  protocol-derived identity; no output or adapter request derives another ID.
- `route` re-reads the live head, calculates trusted routing context, calls
  `ReceiptStore.begin()`, and performs a side effect only when
  `dispatchAllowed=true`.
- Copilot checks pending/current-head review state before one request. External
  routes emit exactly one bounded canonical adapter request and no credentials.
- PR-Agent workflow examples require one explicit model-provider selector and
  a nonempty routed model. Their provider-neutral API-key secret is referenced
  only by the PR-Agent container step and conditionally mapped to an allow-listed
  single-key credential setting; it never enters a router input, output,
  preflight step, summary, or receipt. Except for OpenAI, enabled mappings
  require an explicit `<provider>/<model-id>` value.
  `PR_AGENT_MODEL_PROVIDER` accepts `openai`, `gemini`, `openrouter`,
  `anthropic`, `cohere`, `replicate`, `groq`, `sambanova`, `xai`, `deepseek`,
  `deepinfra`, `mistral`, or `codestral`. The fixed credential mappings are
  `OPENAI__KEY`, `GOOGLE_AI_STUDIO__GEMINI_API_KEY`, `OPENROUTER__KEY`,
  `ANTHROPIC__KEY`, `COHERE__KEY`, `REPLICATE__KEY`, `GROQ__KEY`,
  `SAMBANOVA__KEY`, `XAI__KEY`, `DEEPSEEK__KEY`, `DEEPINFRA__KEY`,
  `MISTRAL__KEY`, and `CODESTRAL__KEY`, respectively. Exactly one receives
  `PR_AGENT_MODEL_API_KEY`; all unselected mappings receive an empty value.
- PR-Agent runs through a direct `docker run` of the immutable CLI-image digest
  so the image retains its `/app` working directory. The command passes only
  allow-listed environment-variable names, mounts no repository workspace,
  and invokes exactly the `review` CLI command. Do not use `uses: docker://`
  with the CLI image because GitHub overrides its working directory.
- `acknowledge` performs no GitHub or provider call. It validates the adapter
  request identity, backend, route, and declared finding channels, then maps
  only `success|failure|cancelled|skipped` to canonical acknowledgment JSON.
  It copies no provider output and accepts no raw error text.
- `finalize` requires a matching v1 acknowledgment, revalidates the head, and
  advances the same receipt to failed or observed. Replays are idempotent.
- `query` is read-only. A started receipt is `in-flight` while a dispatching job
  could still be running, and `reconciliation-required` only once it is older
  than `stranded-receipt-minutes` or its dispatch is recorded failed. Neither is
  permission to dispatch, and absence is `not-found`, which is not either.
- Same-workflow `receipt` output is byte-for-byte canonical protocol JSON from
  the persisted Check Run. Durable outputs include only bounded normalized
  fields and never sensitive paths. Ambiguous writes set
  `receipt-verified=false`, leave the canonical receipt and phase outputs
  empty, and retain only the known logical identity for reconciliation.
- The setup descriptor and workflow agree on contract major, identity,
  intents, operations, permissions, no-checkout, and noninteractive behavior.
- Both published on-demand workflows expose identical trusted policy inputs:
  `rerequest-authorized` is boolean and defaults to `false`, while
  `independent-review-floor` is a `none|cheap|deep|copilot` choice that
  defaults to `none`. Pass both unchanged to the initial route/query Action
  call. Finalization remains bound only to the canonical request and
  acknowledgment.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| First external route | Emit one adapter request and started receipt |
| Matching route replay | Emit no adapter request; return existing/reconciliation state |
| Attempt greater than one with rerequest authorization off | Reject before adapter dispatch |
| Authorized valid rerequest | Create one distinct attempt receipt and dispatch once |
| Configured independent-review floor | Do not reduce an automatic route below the selected floor |
| Current-head Copilot pending/reviewed | Mark already present; do not request again |
| Valid adapter request plus success outcome | Emit acknowledged JSON with the same logical ID, backend ID, and finding channels; construct no GitHub client |
| Failure/cancelled/skipped adapter outcome | Emit failed JSON with `adapter-failed`, `adapter-cancelled`, or `adapter-skipped` |
| Malformed request or unsupported outcome | Throw before emitting an acknowledgment |
| Missing or unknown PR-Agent provider | Fail preflight before the container runs |
| Empty PR-Agent model | Fail preflight before the container runs |
| Non-OpenAI model without the selected provider prefix | Fail with the required `<provider>/<model-id>` format |
| Valid allow-listed provider and compatible model | Populate only its fixed credential environment key and run PR-Agent |
| Valid external acknowledgment | Finalize the same receipt as observed |
| Failed external acknowledgment | Complete the same receipt as failed |
| Changed head during finalization | Require reconciliation; do not mutate or fall back |
| Trusted bookkeeping-only successor | Create a distinct current-head receipt; select none only when policy permits |
| Query misses exact identity | Return not-found and dispatch forbidden |

### 5. Good/Base/Bad Cases

- Good: `gemini` plus `gemini/<model-id>` maps the neutral API key only to
  `GOOGLE_AI_STUDIO__GEMINI_API_KEY` and dispatches the pinned container.
- Base: `openai` plus a supported unqualified OpenAI model maps the neutral API
  key only to `OPENAI__KEY`.
- Bad: an unknown provider, empty model, or mismatched provider prefix fails
  before PR-Agent starts and exposes no secret to the preflight step.

### 6. Tests Required

- Keep every standalone event test green.
- Cover native Copilot, external comment/check, none, replay, conflicting
  retry, rerequest, successor head, missing/failed acknowledgment, changed
  head, ambiguous mutations, canonical output mirroring, and privacy bounds.
- Cover acknowledgment success and every failure outcome, malformed exact-head
  identity, wrong backend kind, and the no-GitHub-client boundary.
- Parse the setup descriptor, discovery cases, and workflow; assert durable
  permissions, immutable placeholders, no checkout, and no PR-controlled run
  step.
- Parse both on-demand workflows and assert identical rerequest/floor input
  names, types, defaults, choices, and Action mappings.
- Parse both PR-Agent workflows and assert every fixed provider/credential
  mapping, valid provider-qualified models, rejection of unknown providers and
  incompatible model prefixes, and exclusive secret placement on the
  container step.

### 7. Wrong vs Correct

```js
// Wrong: an adapter copies provider output into a receipt acknowledgment.
const acknowledgment = { ...adapterRequest, findings, error: providerError };

// Wrong: provider selection dynamically constructs a secret name.
const apiKey = secrets[`PR_AGENT_${provider.toUpperCase()}_KEY`];

// Correct: decode once and project only bounded protocol identity and outcome.
const acknowledgment = buildAdapterAcknowledgment(
  adapterRequest,
  stepOutcome,
  acknowledgedAt,
);

// Correct: the workflow conditionally maps one neutral secret to fixed keys.
const credentialKey = allowedProviderMappings[provider];
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
- `requestCopilotReviewer({ client, pullRequestNumber, reviewer, headSha,
  forceRerequest }) -> Promise<{ alreadyRequested, alreadyReviewed,
  alreadyPresent, requested, rerequested, landing }>`, where `landing` is
  `not-attempted|confirmed|absent|unverified`

### 3. Contracts

- `mode`: `auto|cheap|deep|copilot|none`; explicit configuration outranks
  commands, labels, draft gating, and automatic risk rules.
- `high-risk-route`: `deep|copilot`, default `deep`; both sensitive-path and
  changed-line threshold rules select it. PR-Agent profiles set `deep`
  explicitly, which now matches the default. Consumers wanting the previous
  behavior set `copilot`.
- `low-confidence-route`: `deep|copilot`, default `deep`; it remains separate
  from structural high-risk routing.
- Trusted `/review <mode>` commands and `review:<mode>` labels override only
  automatic routing. Unrelated comments and labels return `none` before client
  construction.
- `route`, `reason`, `model`, `pull-request-number`, `changed-lines`,
  `sensitive-files`, `run-external-reviewer`, and `copilot-requested` are
  delimiter-form GitHub outputs.
- `GITHUB_REPOSITORY` and `GITHUB_API_URL` configure REST calls;
  `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are optional output sinks.
- `github-token` is required only once a route needs GitHub API access.
- `GitHubClient#request()` retries only `GET`, at most three total attempts.
  Its injected sleeper and clock make exponential and rate-limit delays fully
  deterministic in tests. Mutating methods remain one attempt.
- Safe read retries cover transport failures, HTTP 408/429/500/502/503/504,
  and only evidence-backed rate-limit HTTP 403 responses. Directed waits use
  `retry-after`, then zero-remaining `x-ratelimit-reset`, then the 60-second
  secondary fallback; over-cap directives fail rather than being shortened.
- A mutation's success is read back, never inferred. `requested: true` means
  the reviewer was observed present in a probe taken *after* the POST.
  GitHub can return a non-error response to `requestReviewer` and add nobody,
  so a pre-call probe is evidence about the old state only. `landing` carries
  which of the four outcomes actually occurred; `absent` (accepted, added
  nobody) and `unverified` (post-probe itself failed) are distinct facts and
  must not collapse into one another.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown mode or confidence | Throw a field-specific validation error |
| Invalid high-risk or low-confidence route | Throw before dispatch or reviewer request |
| Missing/invalid PR number | Throw before GitHub client construction |
| Untrusted or unrelated comment | Emit `none`; make no GitHub request |
| Conflicting review labels | Throw and fail the Action |
| Automatic route over 3,000 files | Throw and require an explicit route |
| Non-success GitHub response | Include method, path, and API message in the error |
| Eligible transient `GET` succeeds on retry | Return the successful response after a bounded injected delay |
| Eligible `GET` exhausts three attempts | Throw the original GitHub message with attempt context |
| Permission/validation response without transient evidence | Throw after one request |
| Rate-limit directive exceeds 60 seconds | Throw with allow-listed limit context and make no early retry |
| Interrupted reviewer request or Check Run mutation | Make exactly one mutation attempt; reconcile/fail closed in the owning layer |
| Existing Copilot request/review for current HEAD | Do not request again; emit `copilot-requested=false` |
| Reviewer POST returns non-error and the post-probe finds nobody | `landing=absent`, `requested=false`; the durable caller fails closed to `reconciliation-required` and never calls `store.observe` |
| Post-probe itself throws after the POST | `landing=unverified`, `requested=false`; fail closed, and report the outcome as unknown rather than as absent |

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
- An injected client's `requestReviewer` adds the reviewer to the set its
  `getRequestedReviewers` returns. A fake that accepts the POST and adds
  nobody *is* the `landing=absent` defect, so a happy-path case built on one
  asserts success against a client reproducing the failure. Non-landing
  behavior is an explicit per-test opt-out, never the fake's default.
- Transport tests assert the API-version/auth headers, pagination termination,
  request payload, safe retry/status matrix, injected delay sequence,
  primary/secondary limit context, mutation non-retry, and surfaced error text.
- Metadata tests parse every checked-in workflow/example and reject floating
  third-party Action and Docker references.

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

```js
// Wrong: `requested` restates the probe taken before the call. A 2xx that
// added nobody is reported as a landed request, and the durable caller mints
// a satisfied receipt for a review that was never requested.
if (!alreadyPresent) {
  await client.requestReviewer(pullRequestNumber, reviewer);
}
return { alreadyPresent, requested: !alreadyPresent };

// Correct: read the state back and report what is there.
if (!alreadyPresent) {
  await client.requestReviewer(pullRequestNumber, reviewer);
  const landing = await probeLanding(client, pullRequestNumber, reviewer);
  return { alreadyPresent, requested: landing === LANDING_CONFIRMED, landing };
}
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

## Scenario: Gate Published Tag/Commit Pairs

### 1. Scope / Trigger

Use this contract when adding or changing a published document that names a
release tag, a first-party pin, or an installer provenance example — and when
adding any gate whose subject is authored inside the pin-advance commit.

### 2. Signatures

- `assertReleasePairReferences({ repositoryRoot, listDocuments, isCommit,
  resolveTag }) -> Promise<void>`
- Seams: `listDocuments(root) -> string[]`, `isCommit(root, sha) -> boolean`,
  `resolveTag(root, tag) -> string|null` (`null` = tag does not exist)
- Runs inside `assertPinFreshness`, so both `npm run validate:metadata` and the
  `SD_RELEASE_TAG` release form execute it.

### 3. Contracts

- Fail when one Markdown **block** contains both a literal `v<semver>` and a
  40-hex token that `isCommit` confirms is a commit of this repository.
- A block is a fenced code block, or a paragraph delimited by blank lines.
  **Never a line** — see the Design Decision below.
- Either half alone passes: a bare tag documents a flag; a bare pin remains
  `assertProseCommitReferences`' subject.
- `.trellis/` is excluded (archived task records quote historical pairs);
  `CHANGELOG.md` is **not** — cite historical commits abbreviated.
- Fail in the pre-tag window too, reporting `(no such tag yet)`.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Tag and confirmed commit in one block | Fail; name file, block range, tag, resolved commit, paired commit |
| Same pair split across lines of one block | Fail identically |
| Tag alone, or pin alone | Accept |
| Tag beside 40-hex that is not a commit | Accept (protocol fixtures are 40-hex) |
| Tag does not resolve | Fail, reporting `(no such tag yet)` |
| Tag and pin in separate blocks of one file | Accept |

### 5. Good/Base/Bad Cases

- Good: `--source-tag vX.Y.Z --source-commit <the commit that tag resolves to>`.
- Base: a setup guide prints the literal pin with no tag beside it.
- Bad: `--source-tag v0.6.1 --source-commit 6ba1eff…` — shipped in `0.4.0` and
  again in `0.6.1`; `v0.6.1` resolves to `ee1a162` and `6ba1eff` is its ancestor.

### 6. Tests Required

- Reject a pair in one block; assert the block range appears.
- Reject the same pair **split across two lines** — the case a line rule passes.
- Accept a lone tag (else the gate forbids documenting `--source-tag`).
- Accept a lone pin; accept a tag beside non-commit 40-hex.
- Reject in the pre-tag window; assert `no such tag yet`.
- Run every assertion against a deliberately broken implementation first.

### 7. Wrong vs Correct

```js
// Wrong: verify the pair. Unsatisfiable where the defect is authored -- inside
// the pin-advance commit the tag does not exist yet, so this can only pass
// after tagging, leaving that commit green.
if ((await resolveTag(root, tag)) !== sha) throw new Error("stale pair");

// Correct: refuse the conjunction. Decidable with no tag in existence.
if (tags.length && shas.length) throw new Error("tag beside literal commit");
```

### Design Decision: Block-Scoped, Not Line-Scoped

**Context**: `SETUP-PR-AGENT.md` paired a tag and a pin on one line, which makes
a per-line rule look sufficient.

**Decision**: Scope to the block. Every other flag in that example already sits
on its own backslash continuation, so splitting the two flags apart is the
natural next formatting edit — and under a per-line rule it silently disables
the gate while still reporting green. **A gate a routine reflow turns off is
worse than no gate, because it also reports success.** When choosing a rule's
unit, pick the one a plausible edit cannot slip between.

### Common Mistake: Gating A Defect The Procedure Induces

**Symptom**: A published tag/commit pair is wrong at nearly every release, and
each fix rewords the instance.

**Cause**: `docs/RELEASE_CHECKLIST.md` requires the pin advance to be committed
before the tag is cut, with the tag on that commit. An author editing the line
is inside the commit about to be tagged: the tag does not exist and a commit
cannot contain its own SHA, so the only writable SHA is the previous one.

**Fix**: Gate the class, and correct the instruction in the same change.

**Prevention**: When a defect recurs, ask what the procedure *forces* an author
to write. A gate that fires where the procedure gives no correct option trains
people to route around it.

> **Warning**: Gates can conflict. `assertProseCommitReferences` requires a
> prose SHA to equal the current pin, so correcting this example to the honest
> commit would have *failed* validation — the false pair was green and the true
> pair unshippable. Before adding a gate, check whether an existing one already
> forbids the correct output.

## Scenario: Gate Workflow Permission Grants

### 1. Scope / Trigger

Use this contract when changing a shipped lane's `permissions:` block, the
descriptor's `requiredPermissions`, or the metadata gates that compare them.
A lane is any workflow under `.github/workflows/` or `examples/`.

### 2. Signatures

- `assertDescriptorLaneGrants(doc, filePath, requiredPermissions) -> void`
- `assertNoDeadIssuesGrant(lanes) -> void`
- `laneGrantUnion(doc) -> Record<string, string>`
- CLI: `npm run validate:metadata`

### 3. Contracts

- `assertJobPermissions` is a deliberate **lower** bound: a job may hold scopes
  for steps that are not this action. A-023 supplies the missing **upper**
  bound, in two gates that guarantee different things. Do not describe them as
  one gate; that overstates the coverage.
- `assertDescriptorLaneGrants` covers **the descriptor's own lane only**,
  resolved from `workflow.path`. Everything that lane grants anywhere -- its
  jobs' effective permissions folded with its workflow-level block, higher
  level per scope -- must equal `requiredPermissions` exactly, failing in both
  directions. The workflow-level block counts even when every current job
  overrides it: the grant is still written down, and the next job added
  inherits it.
- `assertNoDeadIssuesGrant` sweeps **every** lane on disk, but for the `issues`
  scope only. Other lanes may legitimately hold scopes the descriptor does not
  declare.
- No lane may grant `issues` at any level. On a pull request,
  `pull-requests: write` governs the `/repos/{owner}/{repo}/issues/...`
  endpoints; the `/issues/` prefix is REST layout, not the permission scope.
- Both gates fail closed on a declaration they cannot read. An input the
  validator cannot parse must never score as granting nothing -- that reports
  clean on exactly the lane whose scopes are unknown. Reject, do not ignore:
  an absent `permissions:` block (the token falls back to the repository
  default, which the lane does not control), a bare `permissions:` key, an
  unrecognized scalar, a non-map value, an unknown scope name, a non-string
  level, and a level reachable only through the prototype chain.
- Validate scope names against `GITHUB_PERMISSION_SCOPES` and each scope's
  level against the set GitHub accepts *for that scope*. The level set is not
  uniform: `models` takes no `write`, `id-token` takes no `read`. A global
  none/read/write check accepts declarations GitHub's parser rejects.
- Membership and level sets are settled by probe against GitHub's workflow
  parser, not from memory or documentation alone. Record the probe evidence
  next to the constant.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Descriptor lane grants a scope the descriptor omits | Fail and name the lane, scope, and direction |
| Descriptor omits a scope the lane grants | Fail and name the direction |
| Lane grants `read-all` / `write-all` | Fail as a blanket grant over every scope |
| Any lane grants `issues` at any level | Fail and name the lane |
| Workflow-level `issues` grant no current job inherits | Fail, reported distinctly from the job union |
| Neither workflow nor job declares `permissions:` | Fail closed on the repository default |
| Bare `permissions:` key, unknown scope, or unknown level | Fail as a malformed declaration |
| Descriptor `workflow.path` matches no lane on disk | Fail; a gate that silently did not run is not a pass |

### 5. Good/Base/Bad Cases

- Good: a lane's job union equals `requiredPermissions`, and its workflow-level
  block is a subset of that union.
- Base: a non-descriptor example lane holds a scope the descriptor omits, and
  passes because only `issues` is swept there.
- Bad: a top-level `packages: write` that every current job overrides passes
  because the gate read the job union alone.

### 6. Tests Required

- Assert both directions of the equality gate, not just the extra-grant one.
- Cover each malformed-input shape as its own case: absent block, bare key,
  unrecognized scalar, unrecognized level, non-string level,
  prototype-inherited level, unknown scope name, and `__proto__` as both a
  scope name and a level.
- Derive the shipped-lane scope expectations from disk rather than restating
  them, so a new lane cannot drift past the test.
- Prove each gate non-vacuous by mutation: the assertion must fail when the
  gate is reverted. When a fix makes an existing non-vacuity witness obsolete,
  replace the witness -- a test that starts passing for a new reason proves
  nothing about the branch it was written for.

### 7. Wrong vs Correct

```js
// Wrong: an unreadable declaration scores as granting nothing, so the lane
// whose scopes are unknown is the one that reports clean.
const rank = PERMISSION_LEVELS[level] ?? 0;

// Correct: reject what cannot be read, and read own properties only --
// `in` walks the prototype chain and `Object.hasOwn` coerces its key.
if (typeof level !== "string") return 0;
return Object.hasOwn(PERMISSION_LEVELS, level) ? PERMISSION_LEVELS[level] : 0;
```

## Scenario: Compile A Routed Review Configuration

### 1. Scope / Trigger

Use this contract for the pure higher-layer compiler in
`src/routed-review-compiler.js` that turns a decoded explicit-mode v2 human
source plus mode-specific inputs into a canonical compiled manifest. It sits one
layer above the leaf contracts: it imports the v2 source decoder from
`protocol-v2.js` and the immutable candidate safe projection from
`review-candidate-catalog.js`, and performs no network, credential, filesystem,
clock, environment, or output access.

### 2. Signatures

- `compileRoutedReviewConfiguration({ source, catalog, handlerProfiles }) -> frozen manifest`
- `stableCompiledJson(value) -> canonical JSON string`
- `candidateProjectionDigest(value) -> content digest a managed lane references`
- `COMPILER_SCHEMA_MAJOR` equals `PROTOCOL_V2_SCHEMA_MAJOR`.

### 3. Contracts

- Mode comes solely from the decoded source; it is never inferred or rewritten
  from the presence of an endpoint, credential, catalog, or handler-profile
  input.
- Managed mode requires a digest-matching bounded catalog safe projection and
  validates every lane's candidate reference by exact alias/version/digest,
  prompt-profile identity, and handler/lane/slot compatibility.
- Standalone mode requires only setup-discovered fixed handler profiles and
  rejects every catalog, candidate, and budget field.
- Composition levers (imports, inheritance, presets, independent overrides,
  candidate/slot label configuration including `overrides.labels`, chain refs)
  are rejected by NORMALIZED key at any depth, so a case/separator variant
  (`Overrides`, `runtime_presets`, `LABELS`) cannot slip a lever past the
  boundary.
- `budgetExhaustion.<lane>.merge` is explicit and required with no default;
  legacy names fail post-cutover.
- Source is at most 32 KiB, catalog 64 KiB, and each handler profile 16 KiB;
  short text 128 bytes, collections 32 items, and 32-level nesting are bounded
  before composition.
- Output is canonical JSON carrying stable source, catalog, and output digests;
  diagnostics are field-located and redact the offending value.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Reordered equivalent source/catalog | Compile byte-for-byte identically; same output digest |
| Any semantic source or catalog change | Change the output digest |
| Stale or substituted catalog projection (managed) | Never satisfy the compilation; throw |
| Supplied catalog on a standalone source | Never upgrade to managed; reject the field |
| Supplied handler profiles on a managed source | Never downgrade to standalone |
| Missing `budgetExhaustion.<lane>.merge` | Throw; no default merge policy |
| Composition lever under any spelling variant | Reject by normalized key, naming the field, not echoing its value |
| Endpoint/credential/handler-profile presence | Never infer or rewrite the source mode |

### 5. Good/Base/Bad Cases

- Good: a managed source whose lanes reference candidates by exact
  `candidateProjectionDigest` compiles to a canonical manifest with no candidate
  or slot label configuration exposed.
- Base: an all-local standalone source compiles with no handler profiles.
- Bad: a lane references a candidate present only in a stale projection, or a
  standalone source carries a catalog/candidate/budget field.

### 6. Tests Required

- Load every valid/invalid fixture from `fixtures/protocol/v2/`.
- Assert reproducibility, digest sensitivity, and that a stale/substituted
  projection can never satisfy a managed compilation.
- Assert a composition-lever diagnostic names the field and boundary without
  echoing its value, and that no compiled manifest exposes candidate/slot label
  configuration.
- Cover managed/standalone cross-contamination, forbidden levers, no-network and
  no-filesystem purity, and the full protocol test gate.

### 7. Wrong vs Correct

```js
// Wrong: infer managed mode from a supplied catalog.
const mode = catalog ? "managed" : "standalone";

// Correct: take mode from the decoded source; inputs only validate it.
const decoded = decodeSourceContract(source);
return decoded.mode === "standalone"
  ? compileStandalone(decoded, catalog, handlerProfiles)
  : compileManaged(decoded, catalog, handlerProfiles);
```

## Forbidden Patterns

- Do not check out or execute pull-request-authored code in a secret-bearing
  `issue_comment` workflow.
- Do not use floating third-party Action references in checked-in workflows or
  examples. Examples may use an explicit `@<...>` substitution placeholder;
  every non-placeholder reference must use a 40-character commit SHA.
- Do not use floating `docker://` image references in workflows or examples;
  pin the manifest digest with `@sha256:<64 hex characters>`.
- Do not use floating images in direct `docker run` adapter steps.
- Do not mount the Actions workspace into a provider-credentialed container.
- Do not replace the tested CLI invocation with a Docker Action form that
  changes its workdir.
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
- Keep GitHub API calls in `GitHubClient`; inject `fetch`, retry sleep, and the
  clock for transport contract tests.
- Keep routing precedence centralized in `routeReview()` and add regression
  coverage whenever precedence or event gating changes.
- Pin consumer examples to reviewed full commit SHAs before use; placeholders
  in templates must be called out in the accompanying documentation.
- Keep PR-Agent provider expansion explicit: extend the preflight allowlist,
  container-step credential mapping, documentation, and metadata tests
  together. Never construct a GitHub secret name from router or PR data.

## Testing Requirements

Use `node:test` and `node:assert/strict`. Behavior changes require focused unit
or orchestration tests, including negative side-effect assertions when a route
must avoid a GitHub call. GitHub transport tests cover request headers,
pagination, payloads, and surfaced API errors.

Injected-boundary unit tests do not cover the shipped composition roots
(`src/index.js`, `scripts/install-consumer.mjs`) — argument parsing, env reads,
exit status, redaction, and the `gh`/git boundaries. Cover those with hermetic
subprocess tests that run the real entrypoint via `node <entrypoint>` with a
temporary event/output/summary file, a fake `gh` on `PATH`, and a locally
git-initialised target. Keep them hermetic: no real repository, network,
secret, or user directory, and use an unroutable `GITHUB_API_URL` so an
accidental client build fails loudly. Reuse `test/support/subprocess.mjs`.

Coverage floors guard against boundary regressions: `npm run test:coverage`
runs `scripts/check-coverage.mjs`, which enforces a conservative global floor
plus per-file floors for the critical entrypoints. Set floors a few points
below current coverage — high enough to catch a regression, low enough not to
flake — and never inflate them by faking side-effecting terminal boundaries
(the interactive TTY prompt and secret readline stay honestly uncovered).

Before review, run:

```sh
npm test
npm run test:coverage
npm run check
npm run validate:metadata
python3 ~/.agents/bin/sd-ai-command-pack-install-audit.py
git diff --check
```

CI must run the JavaScript, test, coverage, and metadata gates on the exact PR
head.

## Code Review Checklist

- Routing precedence still matches `DESIGN.md` and `test/router.test.js`.
- Irrelevant and explicit events avoid unnecessary GitHub API work.
- New side effects have success, failure, and deduplication coverage.
- Workflow permissions are minimal and no provider secret reaches PR code.
- Action runtime, metadata, examples, and README installation guidance agree.
- Release or consumer references use immutable reviewed SHAs.
- Shipped entrypoints keep hermetic subprocess coverage and pass the
  documented coverage floors; new boundaries are not hidden below them.
