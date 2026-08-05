# Remediate repository audit 2eeca60

## Goal

Close every finding from the 2026-07-25 standard-depth repository audit at
head `2eeca60` through one explicit Trellis owner, severity-ordered delivery,
and follow-up verification.

## Background

The canonical audit recorded 22 open findings: 7 verified P1, 12 plausible P2,
and 3 plausible P3. Five findings already fit active routed-review tasks; the
remaining 17 findings receive dedicated children under this parent. This task
is a coordination record, not a second implementation owner.

## Requirements

- Maintain a one-to-one finding-to-owner map in
  `research/finding-map.md`; no finding may be unowned or assigned to
  overlapping implementation tasks.
- Amend the five existing owner PRDs for A-001, A-004, A-011, A-013, and A-018
  with the audit evidence and explicit acceptance needed to close the finding.
- Deliver verified P1 findings before P2/P3 work unless a dependency requires a
  small structural prerequisite.
- Keep each child independently implementable, reviewable, and reversible.
- Update `.trellis/audit/ledger.md` only after current-head verification proves
  the owning finding fixed; never mark a finding fixed because a task was merely
  created or implemented.
- Finish with `sd-audit-repo follow-up` against the final integration head and
  reconcile fixed, still-open, or regressed ledger state.

## Dedicated Remediation Children

- `07-25-harden-pull-request-identity-overrides` owns A-002.
- `07-25-make-durable-receipt-creation-concurrency-safe` owns A-003.
- `07-25-reject-symlinked-installer-targets` owns A-005.
- `07-25-test-shipped-review-process-boundaries` owns A-006.
- `07-25-publish-traceable-installer-release` owns A-007.
- `07-25-consolidate-routing-policy-boundaries` owns A-008.
- `07-25-decompose-consumer-installer-lifecycle` owns A-009.
- `07-25-define-operation-specific-action-contract` owns A-010.
- `07-25-bound-review-remote-operations` owns A-012.
- `07-25-skip-irrelevant-pr-file-enumeration` owns A-014.
- `07-25-reuse-receipt-snapshots-during-rerequests` owns A-015.
- `07-25-resolve-opencode-plugin-dependency` owns A-016.
- `07-25-align-local-full-check-with-ci` owns A-017.
- `07-25-adopt-manual-review-installations` owns A-019.
- `07-25-encapsulate-review-label-registry` owns A-020.
- `07-25-remove-unused-installer-export` owns A-021.
- `07-25-parallelize-installer-github-operations` owns A-022.

Dedicated `08-04` children reassigned from the generic 07-25 adapter owners:

- `08-04-harden-copilot-rerequest-dispatch` owns A-001.
- `08-04-isolate-pr-agent-receipt-authority` owns A-004.
- `08-04-apply-control-precedence-before-labels` owns A-011.
- `08-04-resume-interrupted-installer-update` owns A-013.
- `08-04-skip-empty-sensitive-path-enumeration` owns A-014.
- `08-04-reuse-rerequest-receipt-snapshot` owns A-015.
- `08-04-remove-opencode-plugin-dependency` owns A-016.
- `08-04-remove-unused-installer-export` owns A-021.

## Acceptance Criteria

- [ ] Every ledger ID A-001 through A-022 names exactly one Trellis owner.
- [ ] All 17 new child tasks have converged PRDs, designs, implementation plans,
      and real context manifests with no seed-only rows.
- [ ] The five existing owner tasks include the audit ID, evidence boundary, and
      focused acceptance criteria.
- [ ] P1 remediation proves no duplicate/wrong-PR dispatch, no forged receipt
      authority, no path escape, tested shipped entrypoints, and a traceable
      release.
- [ ] P2/P3 remediation either closes its finding or records current-head
      evidence explaining why the ledger remains open.
- [ ] A follow-up audit updates all 22 ledger entries and reports no untracked
      audit finding.

## Out of Scope

- Starting implementation during this planning pass.
- Combining audit findings with unrelated backlog work solely for convenience.
- Marking the parent complete before every child/existing owner and the
  follow-up audit reach terminal evidence.
