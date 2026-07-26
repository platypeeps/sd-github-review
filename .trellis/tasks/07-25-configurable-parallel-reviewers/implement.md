# Configurable Parallel Reviewers Implementation Plan

## Child Delivery Tasks

1. `07-25-compile-parallel-reviewer-plans`
2. `07-25-reserve-parallel-review-budgets`
3. `07-25-orchestrate-parallel-review-dispatch`
4. `07-25-aggregate-parallel-review-assurance`
5. `07-25-report-parallel-review-evidence`
6. `07-25-establish-trusted-finding-adjudication`

The execution order below is the parent integration gate after each bounded
child passes its own acceptance criteria.

## Preconditions

- Complete and approve the budget-aware named-chain design and prove
  single-review reservation, reconciliation, and recovery.
- Review and approve this task's `prd.md` and `design.md`.
- Curate real spec/research entries in `implement.jsonl` and `check.jsonl`
  before starting in sub-agent dispatch mode.
- Confirm the private control plane supports atomic bounded batch reservation.

## Execution Order

1. Add canonical version-2 human-source, pinned-catalog, compiled-manifest,
   migration, parent-plan, child-receipt, batch-reservation, and aggregate-result
   fixtures.
2. Extend the deterministic compiler and implement pure reviewer-list
   validation, candidate/named-chain slot resolution, pairwise target-set
   disjointness, slot-targeted explicit-candidate replacement, slot-aware
   options discovery, reserved candidate/slot-label rejection, and completion-
   policy validation.
3. Implement stable parent/child identities, version-2-only dispatch decoding,
   and read-only historical version-1 receipt decoding.
4. Extend the private-control-plane exchange to reserve, reconcile, release,
   and defer a complete plan atomically across independent/shared pools.
5. Persist parent and child authorization before dispatch, then add bounded
   concurrent scheduling for native Copilot and external adapter children.
6. Implement child acknowledgment/observation, actual-model validation,
   timeouts, ambiguous states, changed-head supersession, and replay/rerequest.
7. Implement the aggregate state machine and stable assurance/gate Check
   projections using the formal required-slot/minimum-success rule and the
   budget-only merge-policy exception.
8. Add plan/candidate/cost/pending evidence to the bounded status/report
   contract consumed by `sd-review budget` and later effectiveness tooling.
9. Extend installer source scaffolding, exact catalog resolution, semantic
   dry-run diff, compiled-manifest promotion, examples, setup discovery,
   one-time legacy migration, update/uninstall, and drift handling for one,
   two, and three-or-more reviewer sets.
10. Update documentation and run focused, full, metadata, installer, security,
    and review gates.
11. After parent/child finding provenance stabilizes, implement the trusted
    adjudication child and publish bounded disposition evidence before enabling
    reviewer/model effectiveness recommendations.

## Validation Matrix

- Config: source syntax/locations, exact catalog version/digest, deterministic
  compile/digest, stale manifest, missing/one/many slots, duplicate IDs,
  missing/unknown/wrong-lane chains, fixed/cross-chain target overlap, invalid
  override flags, rejected candidate/slot labels and `overrides.labels`, invalid
  required/minimum combinations, and bounds.
- Resolution: fixed plus named-chain slots, independent chain resolution,
  slot-targeted and unambiguous shorthand overrides, candidate outside target
  chain, deterministic read-only options, duplicate actual target, independent
  cheap/deep sets, and alternate models.
- Budget: independent pools, shared pools, atomic batch success/rejection,
  optional ineligibility, concurrent plans, release, expiry, and reconciliation.
- Dispatch: bounded parallel start, native plus external children, handler
  isolation, immutable candidate, internal fallback disabled, and model mismatch.
- Completion: all required success, required failure, optional failure,
  minimum met/not met, early policy satisfaction with observation continuing,
  timeout, late observation, ambiguity, budget-only deferral with blocked or
  passing gate, and mixed non-budget failure.
- Identity: same-plan replay, same-head authorized rerequest, changed head,
  workflow crash, partial finalization, and duplicate comment prevention.
- Reporting: parent/child correlation, exact head, selection source, cost,
  missing usage, deferred/pending state, truncation, and deterministic order.
- Installer: explicit one/two/many reviewers, alternate consumer chains and
  catalogs, exact pin resolution, source/catalog semantic diff, pending/active
  compiled promotion, one-time legacy migration, post-cutover rejection,
  dry-run, update, drift, idempotence, and safe uninstall.

## Expected Validation Commands

- Focused Node tests for protocol, plan resolution, receipt storage,
  orchestration, observers, checks, and installer behavior.
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- consumer installer `check --json` and conflict-aware `--dry-run` fixtures.
- repository review preflight and public-metadata/secret scans.

Exact focused filenames should follow the implementation split and existing
test conventions.

## Compatibility And Rollback Gates

- Prove the explicit single primary-chain slot before enabling fan-out; do not
  synthesize contextual defaults.
- Do not enable two reviewers until atomic reservation and child idempotence are
  proven under replay and partial failure.
- Keep stable assurance and gate Check names; require only the gate and never
  dynamic child Checks in branch protection.
- Gate each lane's reviewer list independently so cheap can roll back without
  changing deep, and vice versa.
- Normal rollback uses one required explicit primary-chain slot. Emergency
  protocol rollback pins the prior version-1 Action/workflow rather than
  retaining legacy parsing in version 2.

## Review Gates

- Confirm the complete plan is durable before any child side effect.
- Confirm required slots and `minimumSuccesses` use the documented formula.
- Confirm no post-dispatch child can silently change candidate/model.
- Confirm an ambiguous child is never replaced and does not duplicate review
  publication.
- Confirm aggregate assurance/gate output names missing assurance explicitly,
  and that passing a gate never changes deferred assurance into review success.
- Confirm parent receipts contain no raw findings, prompts, diffs, or secrets.

## Follow-Ups

- Implement the upstream reviewer-neutral learnings and effectiveness task tree
  only after parent/child evidence is stable.
- Complete trusted finding-adjudication capture before using effectiveness
  results to recommend reviewer/model changes.
- Consider adaptive reviewer counts only as a separate future task with its own
  cost and assurance policy.
