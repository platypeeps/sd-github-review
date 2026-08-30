---
title: Deliver routed review configuration lifecycle
status: planning
created: 2026-07-25
---
# Deliver routed review configuration lifecycle

## Goal

Create and migrate the consumer-owned explicit-mode review source file through
the managed compiled-manifest lifecycle.

## Background

The accepted version-2 design gives consumers one human-edited routed-review
source and gives the runtime one generated, digest-bound managed manifest.
This task owns the repository-facing lifecycle around those artifacts; the
sibling compiler/runtime task owns their schemas and semantic compilation.
This task is an integration roadmap; fresh
scaffolding, one-time migration, and compiled promotion are separate children.

## Requirements

- Scaffold one complete explicit source file. Standalone mode names an explicit
  direct-handler profile or local-attestation policy per lane and no catalog;
  managed mode includes an exact private-catalog name/version/digest, named
  chains, reviewer slots, completion policy, and explicit
  `budgetExhaustion.<lane>.merge=block|allow` policy.
- Do not scaffold imports, inheritance, hidden profiles, runtime presets,
  provider/model parameters, credential bindings, budget endpoints, or secrets.
- Resolve the exact catalog only for managed mode through the credential-scoped
  management step. Standalone compilation performs no catalog/control-plane
  access. Fail closed on unavailable or mismatched managed inputs without
  changing modes.
- Show a conflict-aware semantic dry run before changing either artifact.
- Include budget-exhaustion merge policy and assurance/gate Check readiness in
  semantic/setup diagnostics. Fresh managed scaffolds explicitly use `block`
  for each lane unless the consumer supplies a reviewed choice.
- Promote compiled configuration through the existing pending/active managed-
  manifest lifecycle so runtime never observes a partial source/catalog update.
- Provide a one-time v1-to-v2 migration that maps existing fixed routes to
  explicit standalone profiles. A separate reviewed migration may enable
  managed catalog/chains after the control plane validates. Reject legacy/
  default selectors after cutover.
- Reject the unsupported `overrides.labels` source field. Never provision,
  migrate, reconcile, or remove `review-candidate:*` or `review-slot:*` labels;
  preserve any pre-existing user-owned labels while reporting that they cannot
  control routing.
- Make install, update, check, and uninstall idempotent and preserve unrelated
  workflows, labels, secrets, repository settings, and user-owned files.
- For audit finding A-018, express every supported first-party installation
  profile declaratively: Copilot-only, event-driven PR-Agent, durable
  PR-Agent, direct standalone, and local-attested. Each profile receives the
  same ownership, dry-run, drift, update, rollback, and uninstall guarantees
  subject to its explicit permission and credential differences.
- Expose source/catalog/compiled digests and drift without exposing catalog
  secrets or provider credentials.
- Publish the stable assurance/gate Checks on the current head before retiring
  a legacy Check. Diagnose branch protection unless only `sd-review / gate` is
  required; never mutate repository rules without explicit authorization.

## Child Deliverables

> **STALE (2026-08-20): none of the three tasks below exist.** `task.json`
> records `"children": []` and `"subtasks": []`, and none appear in
> `.trellis/tasks/` or either archive month. The work-loop inventory reads
> `children`, so this decomposition is invisible to it. Create the three tasks
> or fold their boundaries into this parent, and record which. Same note in
> `design.md` and `implement.md`.

- `07-25-scaffold-routed-review-source` owns fresh explicit-mode source
  generation and collision-safe dry runs.
- `07-25-migrate-routed-review-configuration-v2` owns the one-time legacy
  conversion and reviewed mode migration.
- `07-25-manage-compiled-review-configuration-promotion` owns semantic preview,
  pending/active promotion, recovery, and rollback.

## Acceptance Criteria

- [ ] Fresh install produces one valid source and one matching active compiled
      manifest without provider credentials or hidden runtime defaults.
- [ ] Dry-run output identifies semantic changes to chains, slots, policies,
      catalog pin, and override exposure before writes.
- [ ] Fresh managed source contains explicit per-lane merge policy with no
      hidden runtime default; missing values fail compilation.
- [ ] Catalog absence, version/digest mismatch, compile error, or interrupted
      promotion leaves the prior active manifest usable and fails visibly.
- [ ] Standalone install/update/promotion performs no catalog or control-plane
      call, and managed failure never rewrites or downgrades mode.
- [ ] Local-attested scaffolding occurs only after an explicit operator choice,
      writes complete actor/association, PR-author, and age policy, and never
      converts an existing direct route implicitly.
- [ ] Migration converts supported v1 settings once and the v2 lifecycle then
      rejects legacy/default selectors.
- [ ] Install, update, check, reapply, drift, and uninstall fixtures preserve
      unrelated consumer content.
- [ ] Each first-party profile completes install, dry-run, check, update,
      rollback, and uninstall round trips; profile changes produce a semantic
      diff and never inherit permissions or secrets from another profile.
- [ ] Candidate/slot label lifecycle tests prove install, migration, update,
      check, drift detection, and uninstall never create, adopt, mutate, or
      remove those labels; `overrides.labels` is rejected.
- [ ] Setup diagnostics cover new Checks on the current head, missing required
      gate, incorrectly required assurance, explicit branch-protection
      authorization, and retirement of the legacy Check only after readiness.
- [ ] Setup documentation explains source ownership, generated output,
      catalog access, safe rollback, and the non-secret nature of published
      digests/aliases.

## Dependencies

- `07-25-compile-and-execute-budget-aware-review-plans` for schemas, compiler,
  manifest semantics, and setup-discovery capabilities.
- `07-25-define-consumer-review-control-plane` for managed-mode exact catalog
  resolution. **STALE (2026-08-20): this task does not exist** in the active or
  archived tree. Until it is created or its scope is folded into
  `07-25-compile-and-execute-budget-aware-review-plans`, managed mode is
  unbuildable and this wave should be scoped to standalone, which needs neither
  a catalog nor a control plane. See `design.md` and `implement.md`.
- `07-25-support-standalone-review-mode` for no-control-plane lifecycle rules.

## Out of Scope

- Provider billing integration or authoritative ledger mutations.
- Runtime review dispatch and reviewer execution.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-deliver-routed-review-configuration`:

- research/2026-08-20-research.md
