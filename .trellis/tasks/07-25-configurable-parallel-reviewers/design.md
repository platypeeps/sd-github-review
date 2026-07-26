# Configurable Parallel Reviewers Design

## Overview

Extend one logical cheap/deep request into an immutable parent plan containing a
bounded variable-length set of reviewer children. The planner resolves every
slot against the same exact PR head and configuration digest, obtains one
atomic batch reservation from the consumer's private control plane, persists
authorization, and then dispatches child reviewers concurrently.

Each child has independent dispatch, acknowledgment, observation, cost, and
finding provenance. Stable assurance and merge-gate Checks separately report
review truth and branch-protection policy. Findings remain attributed to their
original reviewer and are not synthesized by this task.

This entire fan-out path requires explicit managed mode. The standalone
compiler rejects reviewer-list fields and setup discovery reports that parallel
plans are unavailable; there is no implicit unbudgeted fan-out.

## Design Goals And Invariants

- Cheap and deep have independent reviewer sets and explicit named candidate
  chains.
- One plan is bound to one repository, PR, exact head, lane, attempt, and
  immutable configuration digest.
- No child side effect occurs before the complete authorized plan and child
  identities are durable.
- Every required child must complete successfully and total successes must meet
  `minimum_successes` for assurance to be satisfied.
- An adapter executes exactly the planned candidate; the selected named chain is the
  only cross-model fallback authority.
- Replay, retry, timeout, and ambiguous dispatch never duplicate a review or
  comment.
- Concurrency, reviewer count, receipt size, cost, and observation time are
  bounded.

## Component Ownership

| Component | Baseline task | Owns |
| --- | --- | --- |
| Consumer repository | `07-25-deliver-routed-review-configuration` | One human source file with an exact catalog pin, named lane-scoped chains, cheap/deep reviewer sets, required flags, timeouts, completion/concurrency policy, and explicit budget-exhaustion merge policy |
| `sd-github-review` | `07-25-compile-and-execute-budget-aware-review-plans` | Human/compiled schemas, deterministic compiler/normalizer, plan validation/resolution, parent/child identities, control-plane exchange validation, dispatch authorization, observer protocol, aggregate assurance/gate Checks |
| Consumer private control plane | `07-25-define-consumer-review-control-plane` | Pinned versioned candidate catalog, provider/model/credential/policy bindings, atomic batch reservation, shared-pool accounting, reconciliation, deferred-plan state, management credentials |
| Consumer workflow | `07-25-integrate-authorized-review-adapters` | Secret-isolated native/external child jobs and bounded completion observations |
| `sd-ai-command-pack` | `platypeeps/sd-ai-command-pack:07-25-add-routed-review-operator-ux` | Configuration, plan/budget reporting, and explicitly authorized recovery UX over published contracts |

The parallel task reuses the budget-aware control-plane contract; it does not
introduce a second ledger or independently query provider balances. This task
extends those baseline components with fan-out behavior; it does not reopen
their ownership boundaries.

## Delivery Decomposition

| Child task | Delivery boundary |
| --- | --- |
| `07-25-compile-parallel-reviewer-plans` | Reviewer-set source/compiler extensions, validation, overrides, and immutable identities |
| `07-25-reserve-parallel-review-budgets` | Atomic bounded batch authorization and shared-pool handling |
| `07-25-orchestrate-parallel-review-dispatch` | Durable children, bounded concurrency, replay, and supersession |
| `07-25-aggregate-parallel-review-assurance` | Required/minimum completion formula, deadlines, budget-only deferral classification, and stable assurance/gate Checks |
| `07-25-report-parallel-review-evidence` | Parent/child provenance, costs, pending state, and effectiveness-ready bounded output |
| `07-25-establish-trusted-finding-adjudication` | Stable finding identity, maintainer attestation, private event-store exchange, and bounded learning/effectiveness evidence |

## Reviewer Configuration

```yaml
version: 2
mode: managed

catalog:
  name: organization-reviewers
  version: 3
  digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

chains:
  cheap-primary: [qwen-cheap, cheap-secondary]
  deep-primary: [copilot-deep, kimi-deep, deep-secondary]
  deep-independent: [kimi-deep, deep-secondary]

reviewers:
  cheap:
    minimum-successes: 1
    max-reviewers: 3
    slots:
      - id: primary-review
        chain: cheap-primary
        overridable: true
        required: true
        timeout: 15m
  deep:
    minimum-successes: 2
    max-reviewers: 4
    slots:
      - id: native-copilot
        candidate: copilot-deep
        required: true
        timeout: 30m
      - id: independent-review
        chain: deep-independent
        overridable: true
        required: true
        timeout: 20m

budgetExhaustion:
  cheap:
    merge: block
  deep:
    merge: allow

global-max-concurrency: 3
```

This is the reviewer-policy portion of the same `.github/sd-review.yml` source
used by the budget-aware task. The deterministic compiler resolves candidate
aliases through the exact catalog pin and writes the canonical expanded JSON
to the managed manifest. The planner reads only that compiled representation
and verifies its source, catalog, and manifest digests.

Validation requires one source file and exact catalog pin; unique slot IDs; a
candidate or named-chain selector on
every slot; same-lane chain references; pairwise-disjoint possible candidate
sets across concurrently active slots; valid override flags; bounded reviewer
and concurrency counts; known candidates; timeout bounds; and
`requiredCount <= minimumSuccesses <= slotCount`. Slot-specific constraints may
narrow but never widen lane/candidate policy. Candidate/slot labels and the
legacy `overrides.labels` field are invalid in version 2.

Version 2 requires explicit reviewer configuration. The installer writes one
required, overridable `primary-review` slot referencing the lane's named primary
chain for a single-review setup. The runtime never synthesizes a slot or assigns
contextual meaning to omitted configuration.

## Plan Resolution

1. Validate authorization, current PR head, selected lane, candidate config,
   reviewer config, and limits.
2. Freeze the exact head and canonical configuration digest.
3. Validate that active slots have disjoint possible candidate sets. Reject
   overlap as configuration error rather than resolving around another slot.
4. Apply an invocation-level explicit candidate only to the named overridable
   slot. Require that candidate to belong to the slot's named chain. Permit a
   slot-less shorthand only when exactly one slot is overridable.
5. Resolve every fixed candidate or named chain independently. A chain-backed
   slot selects its first eligible candidate without reading another slot's
   resolution.
6. Submit the complete proposed plan to one control-plane batch-reservation
   operation. Fixed slots cannot change candidate. An ineligible chain-backed
   slot may continue only down its own named chain before authorization.
7. Reject the entire plan before dispatch when a required slot cannot be
   authorized or fewer than `minimumSuccesses` slots can run.
8. Persist the parent plan and every child authorization before returning any
   dispatch permission.
9. Dispatch authorized children concurrently up to the global cap.

The slot-aware `/review options` forms reuse the same pure validation and
possible-target expansion through step 4, then return bounded safe choices.
They stop before identity creation, batch reservation, persistence, or
dispatch. A broad route label may select the persistent lane policy but cannot
select or replace a slot candidate.

Batch reservation is atomic only inside the private ledger. The response lists
each slot's reservation or ineligibility, shared-pool effects, observation
freshness, and safety margin. It never claims transactional control over
provider billing systems.

## Fallback Authority

- A fixed slot always refers to its configured candidate.
- A chain-backed slot may walk only its explicitly named chain during pre-
  dispatch plan resolution.
- An explicit invocation candidate targets one overridable chain-backed slot,
  must belong to that chain, and never falls through.
- After authorization, the child model is immutable.
- PR-Agent/LiteLLM internal cross-model fallback remains disabled.
- Same-model endpoint failover is permitted only inside the candidate policy.
- A different actual model is a terminal child `policy_violation`; because a
  side effect may have occurred, no replacement child is dispatched.

## Identity And Receipt Model

```text
planId = hash(repository, PR, head, lane, attempt, configurationDigest)
childId = hash(planId, slotId, candidateId)
```

The version-2 parent receipt records:

- plan identity, lane, exact head, attempt, and configuration digest;
- selection source, target slot, named chain, and any explicit candidate
  override;
- completion policy, explicit budget-exhaustion merge policy, and plan deadline;
- ordered slots, resolved candidates, exclusions, reservations, and child IDs;
- aggregate assurance state, total bounded cost, limitations, and recovery
  references.

Each child receipt records its immutable slot/candidate target, backend,
provider/model provenance, dispatch lifecycle, observation, budget/cost,
finding-channel metadata, timeout, and terminal outcome. Child receipts never
contain prompts, diffs, raw findings, or credentials.

Version 2 is the only active runtime schema after repository cutover. Setup
discovery advertises parent/child and named-chain capability. The installer
performs a one-time conversion of a legacy single-review setup into an explicit
`primary-review` slot. Legacy/default selectors are rejected afterward.
Historical version-1 receipts remain read-only evidence and cannot authorize a
new plan.

## Child And Parent State Machines

```text
child: planned -> reserved -> authorized -> dispatched
                                           |
                                           +-> completed
                                           +-> failed
                                           +-> timed_out
                                           +-> ambiguous / reconciliation_required
                                           +-> policy_violation

parent: preparing -> authorized -> dispatching -> observing
            |                                     |
            +-> rejected/deferred                  +-> satisfied
                                                  +-> failed
                                                  +-> deferred
                                                  +-> superseded
```

A child is successful only in `completed`. Skipped, ineligible, failed,
deferred, timed-out, ambiguous, and policy-violation children do not count.

The plan may become policy-satisfied before all optional children finish, but
the aggregate check remains observing until every authorized child reaches a
terminal state or the bounded plan deadline converts remaining children to
`timed_out`. A provider may still publish after that deadline. Such evidence is
recorded as `late_observed`, remains attributable to the timed-out child, and
cannot retroactively satisfy or replace the finalized exact-head plan.

## Completion Semantics

Let `R` be required slots, `S` successfully completed children, and `M` the
configured minimum:

```text
assurance_satisfied = every slot in R is successful AND count(S) >= M
```

- An optional failure does not block success when the formula is satisfied.
- A required failure always prevents success even when enough optional children
  complete.
- At plan time, no side effect is authorized if the proposed children cannot
  possibly satisfy the formula.
- At the deadline, unfinished children become timed out and the formula is
  evaluated once more.
- A later observation for a timed-out child is retained as late evidence but
  does not rewrite the finalized assurance decision or authorize a replacement.
- If assurance cannot be met solely because of proven pre-dispatch budget
  exhaustion, the machine-readable assurance outcome is `deferred` and the
  lane's explicit `budgetExhaustion.merge` determines only whether the gate
  passes or blocks. Any contributing non-budget failure blocks.
- Ambiguous children are not replaced. Their receipts remain reconciliation-
  required even if optional and the overall formula is satisfied.

## Dispatch And Observation

The parent workflow uses a bounded matrix or equivalent scheduler with a
configured `max-parallel`. Native Copilot and external adapters are different
child handlers under the same protocol:

- Native Copilot dispatch records the request side effect, then an observer
  correlates the resulting review/check evidence to the exact head and child.
- External adapters acknowledge request acceptance and later observation using
  the existing bounded finding-channel conventions.
- Every observation validates parent, child, exact head, backend, candidate,
  and actual model before updating state.
- A changed PR head supersedes an unfinished parent; old-head results remain
  historical and cannot satisfy the new head.

The observer is idempotent and safe to poll. It does not infer correctness or
merge findings; it reports completion and provenance only.

## GitHub Checks And Reporting

Two stable aggregate Checks show the same bounded plan summary:

- lane, exact head, attempt, and configuration digest;
- planned, running, successful, failed, timed-out, ambiguous, and deferred
  counts;
- every slot's candidate/backend and terminal state;
- required/minimum-success policy and whether assurance was satisfied;
- bounded per-child and total cost when available; and
- pending reconciliation or recovery actions.

`sd-review / assurance` is the truthful signal: it is `success` only when the
formula is satisfied and `action_required` for deferred assurance.
`sd-review / gate` is the sole branch-protection-required Check. It passes on
budget deferral only when the explicit merge policy allows it, titled
`Merge allowed; review assurance deferred`. All non-budget failures block.

The aggregate attempt result is immutable. A distinct linked recovery may
advance the exact-head Check projection using a monotonic revision,
latest-authorized-attempt identity, and compare-and-swap; late older results
remain evidence and cannot overwrite it.

Child receipts may use bounded evidence Check Runs, but their dynamic names are
never required branch-protection checks. Findings remain on their
native review/comment channels with parent/child correlation markers.

The budget/report contract aggregates by repository, lane, plan, candidate,
provider/model, and chain position. The upstream command pack renders this
evidence; this repository does not become the central reporting store.

## Security And Privacy

- Persist parent authorization before any child receives dispatch permission.
- Give each child only its own provider/reviewer credential and immutable target.
- Keep management credentials in the private batch-reservation/reconciliation
  steps, separate from reviewer child jobs.
- Reject workflow inputs derived from untrusted PR content for candidate IDs,
  policy references, concurrency, timeouts, or control-plane location.
- Bound slot count, text, correlation IDs, receipt size, observation windows,
  and report output.
- The private service enforces the shared versioned `standard-v1` policy for
  parent/child reservations, receipts, adjudication evidence, and deferred
  plans. Parent/child correlation never extends a class deadline silently, and
  reports expose coverage gaps after compaction, expiry, or purge.

## Compatibility, Rollout, And Rollback

1. Land version-2 named-chain, parent/child, and migration schemas.
2. Have the installer write one explicit primary-chain slot for new consumers
   and migrate legacy single-review consumers in one update.
3. Cut migrated consumers to version 2 and reject legacy/default selectors.
4. Run one explicit primary-chain slot through the new planner with fan-out off.
5. Add atomic batch reservation with one slot and compare it to the proven
   single-review budget path.
6. Pilot fixed Copilot plus `deep-independent` with bounded concurrency and
   aggregate reporting.
7. Add optional failure/timeout and three-reviewer fixtures.
8. Enable consumer-configurable cheap/deep reviewer sets through the installer.

Normal rollback sets each lane to one explicit required slot referencing its
named primary chain. Emergency protocol rollback pins the last version-1
Action/workflow rather than retaining legacy parsing in the version-2 runtime.
Already-dispatched child reviews remain attributable historical evidence;
rollback never deletes their comments or receipts and never enables internal
model fallback.

## Important Failure Cases

- Required slot ineligible before dispatch: defer the entire plan only for
  proven budget exhaustion; otherwise reject and block. Dispatch nothing.
- Optional slot ineligible but formula still achievable: omit it with reason
  and reserve the remaining plan atomically.
- Shared-pool race: the batch reservation either authorizes one coherent plan
  or returns bounded ineligibility; it never partially mutates silently.
- One child ambiguous after dispatch: reconcile only that child; do not replace
  it or cancel unrelated children.
- Child completes after the plan deadline: record late evidence, do not rewrite
  the aggregate result, and do not publish a replacement review.
- Parent workflow crash: replay recovers the durable plan and existing child
  identities; it does not issue new requests.
- Head change: mark unfinished plan superseded and release only reservations
  proven unused.
- Actual-model mismatch: mark child policy violation and preserve evidence; do
  not dispatch a replacement.

## Affected Surfaces

- version-2 plan, child, budget, receipt, and setup-discovery contracts;
- router/action preparation, authorization, dispatch, finalization, and query;
- native Copilot observation and external adapter acknowledgment;
- GitHub Check storage and aggregate summaries;
- consumer workflow and installer templates;
- protocol, concurrency, idempotence, timeout, recovery, and compatibility
  fixtures; and
- README, DESIGN, setup, branch-protection, budget, recovery, and rollback docs.
