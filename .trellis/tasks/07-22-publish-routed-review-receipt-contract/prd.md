# Publish routed review receipt contract

## Goal

Publish a versioned, exact-head review request and receipt contract that lets
`sd-ai-command-pack` use this router as the review control plane. The router
selects the most appropriate configured backend by deterministic cost/quality
policy, honors explicit overrides, coordinates exactly one dispatch, and
exposes enough observation metadata for the command pack's unified `sd-review`
PR lifecycle. An optional bounded summary from an exact-head local review may
inform remote selection, but this router never invokes local-checkout providers
or receives their raw findings.

## Dependency And Ownership

- This task publishes the protocol before
  `platypeeps/sd-ai-command-pack` task
  `07-22-integrate-routed-review-backends` implements its consumer.
- The consumer is part of command-pack parent task
  `07-22-streamline-sd-skill-workflows`. It also consumes the exact-head
  eligibility contract from `07-22-centralize-pr-eligibility-gates`; this
  router must publish enough current-head evidence for that gate without
  becoming the merge authority.
- This repository owns routing policy, setup and selection/dispatch protocol,
  durable receipts, canonical fixtures, and GitHub Action examples.
- Provider credentials and external reviewer runtimes remain in the consuming
  workflow adapter. This router must not become an LLM credential broker.
- The command pack continues to own deterministic preflight, finding
  remediation, local-provider selection/execution and receipts, fix rounds,
  thread resolution, and the final merge gate.
- The command pack's portable structured-question task does not make this
  event-driven router interactive. User choices are normalized into explicit
  request intent before invocation; ambiguous router state fails closed.

## Requirements

- R1: Define versioned JSON request and receipt schemas with canonical valid
  and invalid fixtures. Bind every request and receipt to owner/repository, PR
  number, and full head SHA.
- R2: Accept `auto`, `cheap`, `deep`, `copilot`, and `none`. Explicit intent
  takes precedence; `auto` applies repository-configured risk, cost tier,
  capability, change-size, sensitive-path, and trusted-confidence policy.
- R3: Keep automatic policy deterministic and explainable. The first release
  may use configured cost/quality tiers; it must not claim measured optimality
  until observed cost, latency, and finding outcomes exist.
- R4: Represent backend identity, model or cost tier, selection reason, policy
  version, material capabilities, review authors, check identities, finding
  channels, and rerequest support in the receipt.
- R5: Coordinate exactly one logical dispatch for each
  repository/PR/head/attempt identity. Store a normalized request fingerprint
  and reject conflicting retries for the same identity. Correlation IDs are
  trace aliases, not permission to dispatch again. Native Copilot and external
  adapters must share one idempotency model and distinguish requested,
  already-present, skipped, delegated, and failed states. A same-head rerequest
  requires an explicit prior-receipt identity, the next attempt, supported
  backend capability, and policy authorization.
- R6: Publish a durable receipt that a local command-pack client can query after
  the GitHub workflow step has ended. Same-workflow Action outputs must mirror
  the durable receipt rather than define a second contract.
- R7: Fail closed on malformed requests, unsupported schema majors, stale PR
  heads, conflicting explicit routes, unknown backend configuration, missing
  external dispatch acknowledgment, or contradictory idempotency evidence.
- R8: Keep provider credentials, tokens, raw reviewer output, and sensitive
  pricing data out of requests, receipts, logs, summaries, and fixtures.
- R9: Preserve current pull-request and issue-comment routing for standalone
  Action users. Add an explicitly invoked mode suitable for unified `sd-review`
  after its deterministic gate; do not force existing event-driven Action
  users to migrate in the first release.
- R10: Keep findings on declared GitHub-observable surfaces: reviews, inline
  review comments, conversation comments, or checks. A backend that exposes no
  observable channel cannot participate in the integrated lifecycle.
- R11: Expose selected backend, route reason, cost tier, dispatch latency,
  workflow URL, and limitations so the command pack can present one stable but
  honest report shape.
- R12: Accept an optional bounded local-review summary containing only local
  receipt/schema identity, exact repository/PR-head scope identity, provider
  IDs and declared tiers, normalized outcome/disposition counts, bounded
  confidence, latency/cost tier, and a non-secret scope/configuration digest.
  Accept `skipped` only as a zero-confidence exact-head outcome with a stable
  reason; reject dirty-worktree, wrong-head, stale, malformed, or unsupported
  evidence.
- R13: Prohibit source text, paths, prompts, raw findings, provider transcripts,
  credentials, configuration values, and local artifact contents in the
  routing request, durable receipt, logs, and fixtures. Size-bound and
  allow-list the accepted local summary.
- R14: Let local evidence influence `auto` only. A clean or fully dispositioned,
  sufficiently capable exact-head result may reduce remote cost within
  repository policy; missing, unavailable, failed, cancelled, stale,
  low-confidence, or skipped evidence supplies no positive confidence and never
  triggers a silent expensive fallback. A successor decision uses trusted
  prior-receipt/GitHub-compare evidence independently of the caller's skipped
  reason. Explicit remote intent remains authoritative.
- R15: Enforce configured independent-review floors. Local evidence cannot
  select `none` or a weaker backend for sensitive paths, large changes, or
  policy classes that require remote independent review.
- R16: Publish a canonical versioned setup descriptor and on-demand workflow
  example that let a command-pack client perform a read-only capability
  preflight. The descriptor declares workflow identity, supported contract
  major, supported route intents, durable-receipt capability, and required
  permissions without dispatching a reviewer or requiring provider credentials.
- R17: Define setup and invocation states precisely enough for the client to
  distinguish a truly absent integration before dispatch from a declared but
  missing, disabled, incompatible, or unreadable workflow and from failure or
  ambiguity after a request begins. Router outputs and receipts must expose the
  last proven dispatch phase; an invocation with uncertain side effects must be
  reconcilable by the durable idempotency identity and must never invite a
  second fallback request.
- R18: Treat every new PR head, including a finish-work or task-bookkeeping
  commit, as a new routing and receipt identity. Never reuse an older-head clean
  receipt as current-head evidence and never accept a caller-issued prose or
  path-label exemption.
- R19: Accept an optional `supersedes` identity containing a prior durable
  receipt/logical dispatch/correlation and full prior head. Validate the prior
  receipt and use trusted GitHub compare metadata to classify only the
  prior-head-to-current-head delta. Reject missing, rewritten, ambiguous,
  oversized, or non-comparable ancestry.
- R20: In `auto`, a verified configured bookkeeping-only successor delta may
  select `none` when repository independent-review policy permits. Emit a new
  exact-current-head receipt recording the prior receipt identity, normalized
  delta class/digest, policy reason, and applicable floor. The caller cannot
  force this classification; explicit remote intent and required review floors
  still win.
- R21: Keep the router noninteractive. It must not invoke
  `AskUserQuestion`, infer an answer from unavailable user-input tooling, or
  pause for operator choice. Missing or conflicting intent/configuration is a
  structured failure returned to the caller.
- R22: Do not check out or execute pull-request-controlled code in setup probe,
  on-demand routing, comparison, dispatch, or receipt finalization. Consume
  validated request data and trusted GitHub metadata/API surfaces only.
- R23: Publish behavioral fixtures for successor heads, bookkeeping-only
  `none`, mixed/content-changing successors, required floors, explicit
  overrides, non-comparable histories, changed heads during comparison, and
  interrupted successor dispatch.

## Acceptance Criteria

- [ ] Versioned schemas and fixtures cover `auto` plus every explicit route,
  native Copilot, an external comment backend, an external check backend, and
  `none`.
- [ ] The same exact request/head is idempotent; a different head cannot reuse
  prior dispatch or receipt evidence.
- [ ] Retrying the same logical request with a different correlation ID returns
  or reconciles the existing dispatch instead of spending again. A same-head
  rerequest is rejected unless its explicit prior receipt, attempt, capability,
  and policy checks pass.
- [ ] Native and external paths produce the same receipt envelope and declare
  the correct backend-specific observation channels and limitations.
- [ ] The durable receipt is queryable by owner/repository, PR, head, logical
  dispatch identity, and any correlation alias after the workflow completes,
  with same-workflow outputs matching it.
- [ ] Malformed, unsupported, stale, conflicting, unacknowledged, duplicated,
  and contradictory cases stop without a second reviewer request.
- [ ] Automatic selection reports its deterministic reason and configured cost
  tier; explicit overrides win and remain visible.
- [ ] Fixtures cover clean, fully dispositioned, unavailable, failed,
  cancelled, explicitly skipped, bookkeeping-successor skipped, stale-head,
  dirty-worktree, malformed, oversized, and forbidden-field local summaries.
  The Action accepts only the documented bounded shape and gives skipped
  evidence zero positive confidence.
- [ ] Policy tests prove that eligible local-clean evidence can reduce an
  automatic remote tier, while missing/failed evidence cannot boost confidence
  and sensitive/large-change floors cannot be bypassed.
- [ ] Requests and durable receipts contain no raw local findings, source,
  paths, prompts, transcripts, secrets, or configuration values, and the router
  never invokes Prism, Gito, or another checkout-local provider.
- [ ] Existing standalone event workflows remain compatible, and an on-demand
  example demonstrates command-pack invocation after deterministic preflight.
- [ ] Canonical setup-descriptor and workflow fixtures let the command pack
  classify `ready`, truly `absent`, declared-invalid/disabled/incompatible, and
  metadata-unavailable integration states using read-only GitHub operations.
- [ ] Dispatch-phase and error fixtures distinguish no attempted side effect
  from attempted, acknowledged, and ambiguous execution; durable receipt lookup
  safely reconciles ambiguity without a second backend request.
- [ ] Every new head receives a distinct route decision and durable receipt;
  no older-head receipt or caller-local bookkeeping exemption satisfies the
  current-head contract.
- [ ] A validated bookkeeping-only successor can produce a new exact-head
  `none` receipt only in `auto` and only when policy permits; mixed, ambiguous,
  rewritten, explicit-remote, and required-floor cases cannot use that path.
- [ ] Successor receipts expose the prior receipt identity and normalized delta
  evidence without persisting source, raw paths, or caller-supplied trust
  classifications.
- [ ] A caller's `skipped:bookkeeping-successor` local receipt cannot establish
  the remote successor classification; the router independently validates the
  prior durable receipt and trusted GitHub comparison.
- [ ] Router workflows remain noninteractive and fixtures prove that no
  `AskUserQuestion` or other host-input capability is needed for any state.
- [ ] Security tests prove that no routing/probe/finalization path checks out or
  executes PR-controlled code.
- [ ] A private pilot proves Copilot and at least one external adapter through
  selection, dispatch, durable receipt, observable findings, and new-head
  invalidation.
- [ ] `npm test`, `npm run check`, `npm run validate:metadata`, the installed
  command-pack audit, and repository CI pass.

## Out of Scope

- Implementing the command-pack receipt consumer or its fix loop.
- Executing local checkout review providers or storing their raw artifacts.
- Hosting model-provider SDKs or storing provider credentials.
- Guaranteeing identical reviewer prose, inline-thread support, latency, or
  quality.
- Self-optimizing routing from unbounded historical telemetry in v1.
- Merging this repository with `sd-ai-command-pack`.
- Implementing the command pack's optional local-only fallback policy. This
  repository publishes the setup/dispatch evidence that policy consumes.
- Issuing a caller-local bookkeeping exemption or reusing old-head review
  evidence after any commit.
- Asking interactive questions; user interaction belongs to the command-pack
  caller before it constructs an explicit request.
