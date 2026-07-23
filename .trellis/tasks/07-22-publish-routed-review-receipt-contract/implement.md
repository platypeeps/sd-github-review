# Implementation plan: routed-review receipt contract

## 1. Specify And Test The Protocol

- Add versioned request/receipt schemas and canonical fixtures.
- Add a versioned setup descriptor and canonical ready, absent,
  missing/disabled/incompatible, and metadata-unavailable workflow fixtures for
  read-only client capability classification.
- Cover native Copilot, external comment/check adapters, `none`, automatic and
  explicit routes, and bounded optional cost/latency observations.
- Cover accepted exact-head local-clean/fully-dispositioned summaries plus
  unavailable, failed, cancelled, explicit-none skipped,
  bookkeeping-successor skipped, stale, dirty-worktree, malformed, oversized,
  and forbidden-field local evidence. Skipped evidence receives zero positive
  confidence.
- Add negative fixtures for malformed, unsupported, stale, conflicting,
  unacknowledged, duplicate, and contradictory evidence.
- Add successor-head fixtures for a valid prior receipt, bookkeeping-only
  delta, mixed code/bookkeeping delta, explicit override, required review floor,
  rewritten/non-comparable history, changed live head, and caller-supplied
  classification attempts.

## 2. Add Exact-Head Request Handling

- Accept explicitly invoked PR/head requests without weakening existing event
  handling.
- Re-read the live PR head before dispatch and before final receipt publication.
- Build the logical dispatch identity from repository, PR, head, and attempt;
  store a separate normalized intent/policy request fingerprint and reject
  conflicting retries. Keep correlation as trace metadata so a retry with a new
  correlation cannot dispatch again.
- Add explicit same-head rerequest validation using prior receipt identity,
  monotonically increasing attempt, backend capability, and repository policy.
- Record the last proven dispatch phase and make every error/receipt path clear
  about whether no side effect was proven or reconciliation is required.
- Validate optional prior receipt identity and compare the prior/current heads
  through trusted GitHub metadata without checking out PR code.

## 3. Normalize Backend Selection And Dispatch

- Preserve pure routing policy and explicit override precedence.
- Add configured backend identity, cost/quality tier, capabilities, authors,
  checks, channels, and limitations.
- Add deterministic local-summary policy input, explanation, and independent
  review floors. Prove that local evidence affects only `auto`, cannot bypass a
  sensitive/large-change floor, and cannot cause an implicit expensive
  fallback when invalid or unavailable.
- Add deterministic successor-delta policy. In `auto`, permit a new exact-head
  `none` receipt for verified configured bookkeeping-only changes only when the
  independent-review floor allows it; explicit intent and mixed/ambiguous
  changes take the normal route.
- Keep native Copilot deduplication.
- Add the external adapter acknowledgment/finalizer contract without moving
  provider credentials into the router.

## 4. Publish The Durable Receipt

- Create or update the head-bound `sd-github-review/receipt` Check Run.
- Mirror the canonical receipt to same-workflow Action outputs and summary.
- Document `checks: write`, correlation lookup, size bounds, failure behavior,
  and cleanup/idempotency semantics.
- Document ambiguity reconciliation and prohibit direct or alternate-backend
  fallback after invocation begins.
- Echo only the accepted local-summary digest and bounded decision contribution;
  never persist source, paths, prompts, raw findings, transcripts, local
  artifacts, credentials, or configuration values.
- For successor heads, persist only the prior receipt identity and normalized
  delta class/digest/policy contribution, never raw changed paths or a
  caller-provided bookkeeping assertion.

## 5. Update Workflows And Documentation

- Keep existing standalone examples compatible.
- Add an on-demand example for the command pack's unified `sd-review` caller
  after deterministic preflight.
- Publish the matching setup descriptor and document side-effect-free workflow
  discovery, required permissions, compatibility markers, and disabled or
  incomplete setup diagnostics.
- Document that the router is noninteractive and never depends on
  `AskUserQuestion`; caller UX must resolve choices before constructing a
  request.
- Document the no-checkout boundary for probes, on-demand routing, successor
  comparison, dispatch, and finalization.
- Update `action.yml`, README, design, release checklist, and security guidance
  with schema, permissions, adapter acknowledgment, and receipt lookup.

## 6. Validate And Pilot

- Run `npm test`, `npm run check`, `npm run validate:metadata`, installed-pack
  audit, and CI.
- Pilot automatic routing, every override, Copilot, one external adapter,
  eligible local-clean tier reduction, a sensitive-change floor, idempotent
  replay, and new-head invalidation in the isolated pilot repository.
- Pilot a clean reviewed head followed by a finish-work-only successor and
  prove a distinct exact-head route/receipt, then repeat with a mixed code
  change and a required remote floor.
- Validate read-only discovery for ready, absent, invalid/disabled/incompatible,
  and unavailable setup plus reconciliation after an interrupted dispatch.
- Hand the final v1 schemas, fixtures, release/commit, and pilot evidence to
  `sd-ai-command-pack` task `07-22-integrate-routed-review-backends`.

## Stop And Rollback Points

- Stop before dispatch if the exact PR head cannot be proven.
- Stop before protocol release if external adapters cannot acknowledge dispatch
  without exposing credentials.
- Stop before protocol release if local-summary validation cannot fail closed
  without receiving raw local artifacts.
- Stop before the command-pack handoff if durable receipts cannot be queried
  unambiguously by PR, head, logical dispatch identity, and correlation aliases.
- Stop if successor classification requires executing checkout code, trusting
  caller-supplied paths, or reusing the prior receipt as current-head evidence.
- Roll back by disabling on-demand/durable mode; never compensate with a second
  reviewer request after ambiguous state.
