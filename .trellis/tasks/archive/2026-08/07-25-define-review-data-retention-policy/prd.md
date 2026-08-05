# Define review data retention policy

## Goal

Define the versioned standard-v1 retention, deletion, backup, legal-hold, transfer, and purge contracts for review control-plane data.

## Background

The prior design delegated retention to a future private service without defining
durations or deletion behavior. That leaves conformance, storage sizing,
deferred recovery, learning coverage, repository removal, and user-facing
reporting implementation-dependent.

This repository owns the provider-neutral retention schema, the mandatory
`standard-v1` baseline, conformance fixtures, and bounded public operations.
The consumer private control plane enforces them. Portable operator rendering
belongs to `platypeeps/sd-ai-command-pack:07-25-add-routed-review-operator-ux`.

## Requirements

- Define immutable, digest-bound named retention profiles. `standard-v1` is the
  default and must work without arbitrary per-repository duration settings.
  Future variation uses another explicitly selected named profile rather than
  loose duration fields in the repository's routed-review source.
- Apply the following `standard-v1` classes:
  - Rendered prompts, diffs, source, raw findings, model output, provider
    payloads, and raw billing payloads are prohibited from persistence.
    Ephemeral crash cleanup has a hard 24-hour maximum. Static versioned
    prompt-profile templates/configuration are a separate private configuration
    class and must contain no PR-specific content.
  - Detailed terminal reservation, dispatch, idempotency, authorization, and
    reconciliation operational state is retained for 90 days. Unresolved state
    reaches a terminal `expired_unknown` state after at most 180 days before
    normal compaction.
  - A deferred-review record remains actionable until recovered, superseded,
    its PR closes, or 180 days elapse. Expiry becomes visible
    `expired_unreviewed`. Terminal deferred detail remains for 30 days, then
    compacts into the normal bounded receipt.
  - Raw bounded budget observations and opaque provider references are retained
    for 90 days.
  - Bounded receipts, usage/cost events, quarantine/clearance history, deletion
    receipts, access audit, and trusted adjudication events are retained for 13
    months. An adjudication correction/conflict chain expires as one unit 13
    months after its newest event.
  - Catalog and safe policy versions remain while referenced, then for 13
    months after their last retained reference.
  - Static adapter prompt-profile versions remain while referenced by an active
    or retained catalog version, then for 13 months after their last retained
    reference. Final form is digest/coverage only; rendered prompts remain
    prohibited.
  - Anonymous aggregate cost, outcome, effectiveness, and coverage metrics may
    be retained for 25 months only after repository, PR, attempt, finding,
    candidate-actor, and provider-account identifiers are removed.
  - Backups have a hard maximum lifetime of 35 days.
- After 90-day operational detail expires, retain only the bounded receipt and
  coverage metadata required by its longer class. Compaction must not preserve
  prohibited payloads or break identity/audit invariants.
- Define `retentionPolicyId`, version, digest, data class, lifecycle state,
  `retainedUntil`, legal-hold status, deletion status, coverage start/end, and
  last-deletion evidence in bounded status/receipt contracts.
- Complete authorized live-data purge within seven days. Backup copies age out
  within 35 days; restore must replay the deletion journal before restored data
  becomes queryable. Keep a bounded 13-month deletion receipt without deleted
  content.
- Make legal holds explicit, tenant/repository/data-class scoped, actor- and
  reason-bound, audited, and expiration-bound. Renewal is explicit. A hold
  pauses only covered deletion timers, never rehydrates deleted data, and is
  visible in status.
- On uninstall, stop collection but follow normal retention unless an
  authorized purge is requested. On repository removal, mark private state
  inactive immediately. Repository transfer never moves data across tenants
  without explicit destination authorization and policy revalidation.
- Keep GitHub-native checks, comments, and reviews outside the private purge
  contract. Status and purge output must state that GitHub controls those
  artifacts and that they are not deleted automatically.
- Publish bounded `retention_status` and idempotent `purge_repository_data`
  contracts. Purge requires tenant/repository authorization, actor, reason,
  explicit confirmation, request identity, and a deterministic deletion
  receipt. It never grants ledger, dispatch, or recovery authority.
- Require reports and learning/effectiveness analyses to expose retention
  coverage gaps. Expired or purged evidence must never be presented as a
  complete denominator.

## Acceptance Criteria

- [x] A canonical `standard-v1` fixture validates every data class, duration,
      transition, compaction boundary, and digest.
- [x] Fake-clock tests cover exact expiry boundaries, leap/calendar behavior,
      terminal plus active records, delayed reconciliation, deferred
      `expired_unreviewed`, and correction-chain retention.
- [x] Prohibited content fails before persistence and crash-cleanup fixtures
      prove no ephemeral copy survives 24 hours.
- [x] Live purge finishes within the seven-day contract; backup/restore
      fixtures prevent deleted data from becoming queryable and prove final
      backup expiry within 35 days.
- [x] Legal-hold tests cover scope, authorization, expiry, renewal, partial
      class coverage, deletion-timer resumption, and no rehydration.
- [x] Uninstall, removal, same-tenant transfer, cross-tenant transfer, and
      explicit purge preserve the documented ownership and authorization
      boundaries.
- [x] Status shows counts and next deletion by class, holds, coverage gaps,
      live-purge state, backup purge deadline, and separately identifies
      unmanaged GitHub-native artifacts.
- [x] Retention/deletion cannot silently improve cost or effectiveness metrics;
      anonymous aggregates remain non-identifying and coverage-aware.
- [x] Public responses contain no prompt, diff, source, finding/output body,
      credential, management endpoint, or raw provider/billing payload.
- [x] Classification fixtures distinguish static versioned prompt-profile
      configuration from prohibited rendered prompts and prove reference-aware
      profile deletion without breaking active dispatch or rollback.
- [x] The exported conformance suite this repository owns — the canonical
      `standard-v1` fixture, the paired valid/invalid contract fixtures, and the
      `test/retention-policy.test.js` suite — is complete and passing. Activating
      the private control-plane implementation against this exported suite is
      downstream of this contract task and is tracked separately (see the
      consumer control-plane / retention data-class owner tasks noted under
      Dependencies); it is not an in-repo acceptance criterion here.

## Dependencies

- `07-25-define-budget-review-v2-contracts` for status, receipt, hold, and purge
  schemas.
- The budget ledger, reconciliation, deferred recovery, candidate catalog, and
  finding-adjudication store tasks for their owned data classes.
- `platypeeps/sd-ai-command-pack:07-25-add-routed-review-operator-ux` for
  `sd-review data status` and `sd-review data purge` rendering.

## Out of Scope

- Selecting a private storage/database technology.
- Provider-side retention controlled by model vendors; candidate policy still
  enforces those independent data-handling constraints.
- Automatically deleting GitHub-native checks, comments, reviews, or Actions
  records.
- Arbitrary per-repository duration fields in the initial profile.

## Intended start order (2026-07-25 reconciliation)

- The command-pack reference above is a rendering consumer (requirements input),
  not a start prerequisite; this policy task can land before the pack UX unparks.
- Cross-repo mismatch to reconcile when that pack task unparks: the `sd-review data
  status` / `sd-review data purge` operations named here are NOT yet among that task's
  scoped operation families (config/budget/findings) — either it gains a `data`
  family child or this reference should point at a successor task.
