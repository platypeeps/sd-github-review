# Support local-attested reviews

## Goal

Allow repositories to satisfy review assurance from trusted exact-head local-review attestations without dispatching GitHub-side reviewers.

## Background

The existing `review:none` route proves only that remote review was skipped.
Standalone and managed v2 routes otherwise expect a direct handler or managed
reviewer plan. Neither contract can truthfully distinguish “no review occurred”
from “the exact PR head was reviewed locally and its result was published.”

Local-attested review is an explicit execution policy, not a third
control-plane mode and not an alias for `none`. A repository may use it for
every enabled lane to avoid Copilot, PR-Agent, or other GitHub-side reviewer
dispatch while retaining exact-head receipts and merge-gate enforcement.

## Requirements

- Keep `mode: standalone|managed` as the control-plane boundary. Add
  `local-attested` as an explicit route execution kind; never infer it from an
  absent handler, absent control plane, disabled workflow, or local receipt.
- Support an MVP standalone configuration in which cheap and/or deep routes
  use a named local-attestation policy instead of a direct handler profile.
  Existing direct-handler routes remain explicit and may coexist with
  local-attested routes.
- Dispatch no Copilot request, PR-Agent container, external adapter, review,
  comment, or provider call for a local-attested route. GitHub workflow and
  Check Run mutations used to ingest and project the attestation are allowed
  and must not be described as reviewer execution.
- Consume one bounded local-review attestation produced after a local review.
  Bind it to repository, PR, exact head, lane, attempt, local receipt/content
  digest, configuration digest, publisher actor, review tool/profile identity,
  terminal outcome, timestamps, and evidence digest.
- Treat the authenticated GitHub actor and explicit repository trust policy as
  the authorization boundary. Require an explicit policy decision for allowed
  actors/associations and whether the PR author may attest; define no implicit
  trust default.
- State the trust limitation precisely: authorization and exact-head binding
  prove who published which bounded result, not that GitHub independently ran
  or verified the local model. Never label self-published evidence independent
  unless a future independent-issuer contract proves that property.
- Accept only terminal `clean`, `findings`, `failed`, or `cancelled` local
  outcomes. `clean` may satisfy assurance. Findings, failure, cancellation,
  missing evidence, stale evidence, malformed evidence, or unauthorized
  publication do not satisfy assurance and block the gate.
- Keep `review:none` as an intentional skip with no assurance claim.
- Publish immutable attempt evidence and the stable exact-head
  `sd-review / assurance` and `sd-review / gate` projections without publishing
  raw findings, source, prompts, transcripts, credentials, configuration
  values, or local artifact paths.
- Make submission replay idempotent. A matching retry reuses the attempt;
  conflicting evidence for the same identity fails closed. A changed PR head
  invalidates the old projection and requires a new local review and
  attestation.
- Allow bounded self-reported provider/model, token, latency, and cost metadata
  when available, but label it `self_reported_local`; it cannot authorize
  managed budgets or be presented as authoritative provider billing.
- Preserve branch-protection truth: only `sd-review / gate` is required. A
  missing local attestation remains action-required assurance plus a blocking
  gate; there is no budget-deferred pass for this execution kind.
- Keep local artifact retention consumer-owned. GitHub receives only bounded
  normalized evidence and digests; managed adjudication and private retention
  capabilities are unavailable unless a later explicit upload design adds
  them.

## Acceptance Criteria

- [ ] Explicit standalone fixtures cover all-local, mixed direct/local, and
      direct-only route configurations; missing or inferred execution kinds
      fail validation.
- [ ] A valid clean exact-head attestation performs zero reviewer dispatches,
      records `reviewOutcome=completed_local`, satisfies assurance, and passes
      the gate.
- [ ] Findings, failed, cancelled, missing, wrong-head, expired, unauthorized,
      malformed, oversized, and conflicting attestations never satisfy
      assurance or pass the gate.
- [ ] `review:none` remains a skipped receipt and cannot consume or inherit
      local-review evidence.
- [ ] A new PR head cannot reuse the prior head’s local attestation; matching
      replay is idempotent and conflicting replay fails closed.
- [ ] Receipts, outputs, summaries, and Checks contain no raw source, paths,
      prompts, findings, transcripts, credentials, configuration values, or
      local artifact references.
- [ ] Documentation explains that local-attested assurance is repository-
      trusted self-attestation, not independent GitHub reviewer execution.
- [ ] The command-pack-owned publisher is tracked in
      `platypeeps/sd-ai-command-pack` and consumes the published contract rather
      than redefining trust, outcome, or Check semantics.

## Delivery Split

- `07-25-define-local-review-attestation-contracts` owns source, envelope,
  receipt, outcome, privacy, and setup-discovery contracts.
- `07-25-ingest-local-review-attestations` owns authenticated ingestion,
  authorization, exact-head validation, and idempotency.
- `07-25-project-local-review-assurance` owns stable Check projections,
  invalidation, branch-protection readiness, and operator-visible limitations.
- `platypeeps/sd-ai-command-pack:07-25-publish-local-review-attestations` owns
  producing and publishing bounded evidence from the unified `sd-review`
  lifecycle.

## Out of Scope

- Claiming that an authorized local attestation is cryptographic proof that a
  particular model executed or that its findings were correct.
- Uploading raw local review findings or artifacts to GitHub or the private
  control plane.
- Treating local-attested evidence as independent review without an additional
  independent-issuer design.
- Managed parallel plans containing local-attested child slots in the MVP.
- Automatic conversion of existing direct-handler routes to local-attested
  execution.
