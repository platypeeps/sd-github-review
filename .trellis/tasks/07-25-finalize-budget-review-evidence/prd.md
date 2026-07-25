# Finalize budget review evidence

## Goal

Validate acknowledgments and publish bounded receipts, separate assurance and
merge-gate Checks, status, recovery, and discovery evidence.

## Requirements

- Validate adapter acknowledgments against durable authorization, including
  configured/actual model, prompt-profile mode and applied alias/version/digest,
  provider when available, exact head, and outcome.
- Reconcile usage through the private boundary while preserving unknown cost as
  unknown and retaining ambiguous/policy-violation evidence.
- Keep content outcome and budget outcome distinct. A soft `budget_overrun` may
  retain a valid completed review; `incomplete_token_limit` and hard
  `policy_violation` do not satisfy assurance. No post-dispatch outcome
  authorizes fallback.
- Publish bounded exact-head receipts with lane,
  chain, candidate, handler, prompt-profile identity/mode, configured token
  limits, counted/reported usage, finish reason, reservation, actual cost,
  variance, hard request limit, pool state, policy outcome, deferral, and
  recovery links.
- Publish two stable exact-head Checks: `sd-review / assurance` truthfully
  reports satisfied, deferred, or failed assurance, while `sd-review / gate`
  reports only whether explicit policy permits merge and is the sole Check
  intended for branch protection.
- For proven pre-dispatch budget exhaustion, record
  `reviewOutcome=deferred_budget`, `assuranceOutcome=deferred`, and
  `gateOutcome=pass|block` from the lane's explicit
  `budgetExhaustion.merge=allow|block`. Never apply merge allowance to policy
  violations, ambiguity, incomplete output, authentication errors, framework
  failures, or other non-budget outcomes.
- Keep per-attempt receipts immutable. Update the exact-head Check projection
  only through a linked newer authorized attempt and deterministic
  revision/CAS rules that reject late writes from older attempts.
- Publish setup and branch-protection diagnostics that identify a missing
  required gate or an incorrectly required assurance Check without mutating
  repository rules automatically.
- Publish status, pending, explain, recovery, and setup-discovery responses for
  future operator UX without exposing prompts, diffs, findings, or credentials.
- Publish explicit `standalone`/`managed` mode and capability availability.
  Standalone evidence uses `budgetOutcome=not_managed`; managed-only operations
  return a stable unsupported reason rather than zero or empty authoritative
  state.
- For standalone local-attested routes, consume only verified immutable
  repository-attested evidence. Map clean evidence to `completed_local` plus
  satisfied assurance/pass gate; map findings/failure/cancellation to block;
  and map missing/new-head evidence to deferred assurance plus block. Never
  apply budget merge allowance or claim independent review.
- Attach bounded `standard-v1` retention policy/class/lifecycle/retained-until,
  legal-hold, deletion, and coverage metadata. Publish low-level
  `retention_status` and `purge_repository_data` contracts while clearly
  excluding GitHub-native artifacts from private purge.

## Acceptance Criteria

- [ ] Success, failure, timeout, ambiguity, model mismatch, unknown usage,
      input ineligibility, output-limit incompleteness, soft overrun, hard-limit
      violation, overdrawn pool, deferral, recovery, and changed-head fixtures
      finalize deterministically.
- [ ] Partial model output, request context, prompts, filenames, and raw billing
      payloads never enter receipts, checks, status, or discovery.
- [ ] Profile receipts contain only mode and alias/version/digest when
      referenced; missing or substituted acknowledgments fail visibly.
- [ ] Replay never duplicates receipts, checks, recovery records, reviews, or
      comments.
- [ ] Proven budget exhaustion always reports deferred assurance; the gate
      blocks or passes only from the explicit lane merge policy, and a passing
      gate says `Merge allowed; review assurance deferred`.
- [ ] Non-budget failures always block even when budget exhaustion is allowed.
- [ ] Check tests cover stable names, assurance `action_required`, gate
      pass/block, branch-protection diagnostics, same-head recovery projection,
      changed-head supersession, and rejection of stale projection revisions.
- [ ] Bounded output, privacy, truncation, and setup-discovery fixtures pass.
- [ ] Standalone evidence names its fixed handler/profile and limitations;
      managed outage evidence proves no standalone downgrade or dispatch.
- [ ] Local-attested evidence names authenticated publisher, exact head,
      tool/profile, time, result, and evidence digest within privacy bounds;
      zero-reviewer-dispatch, wrong-head, missing, and trust-limitation fixtures
      pass.
- [ ] Status/purge fixtures expose class counts, next deletion, holds, coverage
      gaps, live/backup deletion progress, and unmanaged GitHub artifacts
      without exposing deleted or prohibited content.

## Dependencies

- `07-25-authorize-budget-aware-review-plans`.
- `07-25-define-review-usage-reconciliation` and
  `07-25-define-deferred-review-recovery`.
- `07-25-define-review-data-retention-policy`.

## Out of Scope

- Portable command rendering or multi-reviewer aggregation.
