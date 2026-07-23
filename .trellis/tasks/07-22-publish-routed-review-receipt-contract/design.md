# Design: Versioned routed-review receipt

## Architecture

Keep the current four boundaries and add an explicit protocol layer:

1. `src/router.js` remains pure deterministic selection policy.
2. A protocol module validates request/receipt schemas and canonicalizes
   backend observation metadata.
3. `src/index.js` validates the live PR/head, selects a route, coordinates
   native or delegated dispatch, and mirrors the final receipt to Action
   outputs.
4. `src/github.js` owns GitHub API calls, exact-head identity, Copilot
   idempotency, and durable receipt publication/query.
5. Consumer-owned adapter steps retain external provider credentials and emit a
   bounded dispatch acknowledgment for receipt finalization.

The command pack remains a separate pre-routing stage for local checkout
review. The router consumes only a bounded local summary; it neither imports
the command-pack local engine nor invokes Prism, Gito, or custom local tools.

## Setup Capability Contract

Publish a canonical, versioned setup descriptor with the on-demand workflow
example. It declares the workflow identity, router contract major, supported
route intents, durable-receipt support, required permissions, and the pinned
Action identity. A command-pack client combines that declaration with read-only
GitHub workflow metadata before any review-provider call or GitHub mutation.
The probe itself never dispatches a reviewer and requires no provider secret.

The client owns the final capability classification, but the router fixtures
make the evidence unambiguous:

- absence of an integration declaration is truly `absent`;
- a declaration whose workflow is missing, disabled, or incompatible is
  invalid rather than absent;
- unreadable GitHub workflow metadata is unavailable rather than absent; and
- only a compatible enabled workflow is ready.

This descriptor communicates availability, not cost/risk selection policy. The
router remains the only owner of backend selection and dispatch.

## Request Contract

Schema v1 contains:

- correlation ID, stable logical dispatch identity, normalized request
  fingerprint, attempt, and schema version;
- owner/repository, PR number, and full head SHA;
- route intent: `auto`, `cheap`, `deep`, `copilot`, or `none`;
- optional trusted confidence and policy/config reference;
- optional `supersedes` identity containing a prior durable receipt,
  correlation ID, and full prior head for a successor-head decision;
- optional explicit `rerequest_of` identity and monotonically increasing
  attempt for a policy-authorized same-head rerequest;
- optional allow-listed local-review summary containing receipt/schema ID,
  exact clean PR-head scope identity and digest, provider IDs and declared
  capability/cost/quality tiers, normalized outcome/disposition counts,
  bounded confidence, and timing;
- caller identity metadata sufficient for diagnostics, never credentials.

The Action re-reads the PR and rejects a stale or mismatched head before any
dispatch side effect. A local summary is usable only when it describes the same
repository and full live head, represents reproducible clean-head scope, stays
within size limits, and contains no forbidden fields. Worktree-only evidence
may remain useful to the local client but is never routing evidence here.

A normalized `skipped` local outcome is accepted only with a stable reason and
zero positive confidence. In particular, a caller's
`skipped:bookkeeping-successor` receipt is reporting input, not trusted remote
classification; successor routing depends on the validated prior router receipt
and the router's own GitHub comparison.

When `supersedes` is present, the router validates the prior durable receipt and
uses trusted GitHub compare metadata for the prior-head-to-current-head delta.
It does not trust caller-provided path lists or bookkeeping classifications.
Non-ancestral, rewritten, incomplete, oversized, or changing comparisons fail
closed before dispatch.

## Receipt Contract

The final receipt contains:

- the exact request identity and live head;
- selected route, backend ID/label, model or cost tier, policy version, and
  human-readable reason;
- dispatch status (`requested`, `already-present`, `skipped`, or `failed`) and
  last proven dispatch phase (`not-started`, `started`, `acknowledged`, or
  `observed`), trigger/completion timestamps, idempotency key, and workflow URL;
- primary and alias correlation IDs observed for the logical dispatch;
- review-author matchers, check identities, and finding channels;
- rerequest support and material limitations;
- optional bounded cost/latency observations supplied by the adapter;
- optional validated prior-receipt identity plus normalized successor-delta
  class/digest and policy contribution;
- the digest and normalized decision contribution of any accepted local-review
  summary, without copying local artifacts or raw findings.

`delegated` is an intermediate external-adapter state, not a successful final
receipt. The adapter must acknowledge success/failure before receipt
finalization. Raw findings stay on their native GitHub surfaces.

## Durable Transport

Use one head-bound GitHub Check Run named `sd-github-review/receipt` as the
canonical durable transport. Store a machine-readable v1 marker and JSON
receipt in the check output, bind it to the PR head SHA, and use correlation ID
as trace metadata while the logical dispatch identity is the Check Run external
identity. Action step outputs mirror the same canonical object for
same-workflow adapters.

Durable-receipt mode documents and validates the required `checks: write`
permission. Standalone mode may retain current step-output-only behavior when
no remote client requests a durable receipt; it must not claim integrated
completion in that mode.

## Dispatch And Idempotency

- `none` records `skipped` without reviewer mutation.
- Copilot checks pending requests and completed current-head reviews before
  requesting, preserving the existing deduplication contract.
- `cheap`/`deep` emits a selected backend contract to exactly one adapter step.
  The adapter returns a bounded acknowledgment; a finalizer publishes the
  receipt only after acknowledgment.
- Repeating one logical dispatch identity with a matching request fingerprint
  returns or updates the existing receipt and never dispatches twice. A new
  head creates a distinct idempotency boundary.
- Repeating it with a different correlation ID adds a trace alias and resolves
  the existing logical dispatch. A conflicting fingerprint fails closed.
  Correlation is observability, not a new side-effect key.
- A same-head rerequest is a separate explicit operation containing
  `rerequest_of` and the next attempt. It dispatches only when the previous
  receipt declares support and repository policy authorizes it.

## Successor-Head Decisions

Every new head receives a new routing decision. For `auto`, a prior clean
durable receipt may be referenced only to evaluate the new delta; it never
becomes current-head evidence by itself.

If trusted compare evidence proves that the delta contains only configured
pack-owned bookkeeping classes and repository policy permits no additional
independent review, the router may select `none`. It still publishes a new
exact-current-head receipt with the prior receipt identity, delta digest/class,
policy version, and explanation. Mixed code/bookkeeping changes, explicit
remote intent, required review floors, ambiguous comparison, or a changed live
head cannot use this path.

The shared command-pack eligibility gate consumes the new receipt. It does not
mint or interpret a parallel local exemption.

Once an invocation has begun, a missing or failed receipt is never evidence that
no provider side effect occurred. The caller must reconcile by durable
repository/PR/head/logical-dispatch identity and any correlation aliases, then
stop if state remains ambiguous; the router never recommends direct or
alternate-backend fallback dispatch.

## Cost And Quality Policy

Automatic policy remains deterministic and repository-configurable. It can use
sensitive paths, changed lines, trusted upstream confidence, backend capability,
declared cost/quality tiers, and an accepted exact-head local outcome. A clean,
fully dispositioned, sufficiently capable local review may lower the automatic
remote tier or select `none` only when the repository's independent-review
floor allows it. Missing, unavailable, failed, cancelled, stale,
low-confidence, or skipped local evidence contributes no positive confidence.
Explicit remote intent wins, subject to existing configuration and safety
validation.

Sensitive-path, large-change, and other configured policy classes retain their
minimum remote tier regardless of local outcome. The receipt explains whether
local evidence changed the route and which floor applied. It distinguishes
configured estimates from observed adapter data. Future optimization may use
bounded, reviewed telemetry, but v1 does not learn policy automatically.

## Compatibility And Security

- Unknown major schema versions fail; additive v1 fields are tolerated.
- Existing pull-request, label, and issue-comment behavior remains supported.
- An on-demand workflow accepts exact PR/head inputs from unified `sd-review`
  after deterministic preflight.
- The on-demand workflow and setup descriptor expose compatible identity and
  capability markers that can be verified through read-only GitHub metadata.
- Provider secrets remain only on external adapter steps and never enter the
  receipt finalizer.
- Receipt fields are escaped and size-bounded before GitHub output.
- Local-summary fields are allow-listed; source, paths, prompts, raw findings,
  transcripts, configuration values, local artifacts, and credentials are
  rejected rather than ignored.
- Setup probes, on-demand routing, successor comparison, dispatch, and receipt
  finalization never check out or execute PR-controlled code. They consume the
  validated request plus trusted GitHub event/API metadata only.
- The router is noninteractive. `AskUserQuestion` and other host input tools
  belong to caller UX; router ambiguity is represented as a structured
  failure, not a prompt.

## Rollback

Disable durable receipt/on-demand mode and return to existing standalone Action
outputs. Do not delete receipts, reuse old-head evidence, or silently dispatch a
fallback backend after an ambiguous external acknowledgment.
