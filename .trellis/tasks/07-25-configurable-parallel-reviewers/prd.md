# Support configurable parallel reviewers

## Goal

Fan out cheap and deep review plans to independent variable-length reviewer sets with bounded concurrency, aggregate status, and durable per-reviewer receipts.

## Background

The current router selects one backend and creates one dispatch for a resolved
route. The desired policy may request several independent opinions for the same
exact PR head—for example, native Copilot plus a deep PR-Agent review using the
explicit `deep-independent` chain or an explicitly selected candidate.

Parallel review is an execution plan within a logical `cheap` or `deep` lane.
It does not create model-named routes, merge the two lanes, or infer slot
meaning from what another slot already selected.

The initial parallel contract is managed-mode only because it requires one
atomic batch authorization over the complete reviewer set. Standalone mode
continues to run one explicit direct handler or consume one local attestation
and reports parallel planning as `unsupported_in_standalone`; it never fans out
without the control plane.

This task is the integration roadmap. Configuration/planning, batch budget
reservation, concurrent dispatch, aggregate assurance, and reporting are
independently reviewable child deliveries.

## Accepted Ownership And Fallback Decisions

- `sd-github-review` owns the human-source and compiled schemas, deterministic
  compiler/normalizer, plan resolution, parent/child protocol contracts,
  dispatch authorization, exact-head correlation, aggregate status, and setup
  discovery.
- The consumer's private control plane owns authoritative availability and
  budget observations, atomic batch reservations, reconciliation, deferred
  plan storage, and management credentials.
- Consumer workflow child jobs own reviewer/provider credentials and execute
  only the immutable candidate authorized for that child.
- `sd-ai-command-pack` will own user-facing configuration, budget/plan
  reporting, and explicit recovery commands over the bounded contracts exposed
  by this repository and the private control plane through task
  `07-25-add-routed-review-operator-ux`.
- Repository maintainers own trusted correctness decisions. Child
  `07-25-establish-trusted-finding-adjudication` owns the identity,
  authorization, workflow, and bounded evidence contracts needed before
  effectiveness tooling may interpret reviewer quality.
- Named candidate-chain resolution is the only cross-model fallback mechanism.
  Neither a fixed nor chain-backed slot may change model inside PR-Agent/LiteLLM;
  same-model provider endpoint failover remains allowed only within policy.

## Requirements

- Accept parallel reviewer configuration and dispatch only in explicit
  `mode=managed`; reject parallel fields in standalone source and expose the
  limitation through setup discovery and explain output.
- Extend the single `.github/sd-review.yml` human source introduced by the
  budget-aware task. Keep the exact private catalog reference pinned there and
  express reviewer slots, completion policy, and concurrency explicitly; do
  not introduce imports, inheritance, runtime presets, or a second config file.
- Resolve candidate aliases only through the pinned control-plane catalog and
  compile the source/catalog pair into the managed canonical JSON manifest.
  Runtime planning consumes only the compiled digest-bound contract and never
  queries an unpinned catalog or interprets YAML during dispatch.
- Extend the explicit single-slot `cheap_reviewers` and `deep_reviewers`
  configuration introduced by budget-aware v2 routing into independently
  configurable ordered variable-length lists, not a fixed pair.
- Represent each list entry as a stable slot with:
  - a unique slot ID;
  - a selector containing either one explicit candidate ID or one explicit
    named chain ID from the selected lane;
  - whether a chain-backed slot accepts an invocation-level override;
  - whether the slot is required;
  - a bounded completion timeout; and
  - optional slot-specific provider/data-policy constraints that may only
    narrow the selected lane's policy.
- Require every configured v2 lane to contain at least one explicit slot.
  Installer-generated single-review configuration uses one required,
  overridable `primary-review` slot referencing that lane's named primary
  chain. The runtime never synthesizes a contextual default slot.
- Require the possible candidate sets of concurrently configured slots to be
  pairwise disjoint. A fixed candidate may not appear in another active slot's
  named chain, and two active chain selectors may not share a candidate. Reject
  overlap during configuration validation rather than skipping a duplicate at
  runtime.
- Support this repository's intended deep example with one explicit Copilot
  slot and one overridable slot referencing `deep-independent`. The latter
  chain begins with Kimi and excludes Copilot by configuration, so the plan is
  predictable without contextual exclusion.
- Support any bounded list length greater than two. Add configurable per-lane
  maximum reviewer counts and a global maximum concurrency; validate both
  before reserving budget or dispatching work.
- Keep cheap and deep lists fully independent. Routing to cheap never reads or
  borrows the deep reviewer set, and vice versa. A candidate can participate in
  both only when explicitly configured in both lane chains and reviewer sets.
- Integrate the explicit candidate override from
  `07-25-budget-aware-review-degradation`. For
  `/review <lane> --slot <slot-id> --candidate <id>`,
  replace only that explicitly overridable chain-backed slot; preserve all
  other slots. Permit `/review <lane> --candidate <id>` only when exactly one
  slot is overridable. Reject a candidate outside
  the target slot's named chain, a fixed slot, or an ambiguous shorthand.
- Extend `/review options <lane>` and `/review options <lane> --slot <slot-id>`
  to expose the bounded safe candidates and eligibility for variable reviewer
  sets. Discovery is trusted and read-only and never creates or reserves a
  parent or child plan.
- Reject `review-candidate:*` and `review-slot:*` as unsupported reserved
  controls. Stable broad route labels continue to select a lane but never a
  candidate or slot.
- Resolve the entire review plan against one exact repository/PR/head and one
  immutable configuration digest before any dispatch. Treat duplicate possible
  target sets as invalid configuration and reject any remaining duplicate
  actual-reviewer target rather than issuing redundant reviews; candidates
  using the same adapter remain distinct when their provider/model targets
  differ.
- Check availability and reserve sufficient budget for every resolved slot in
  one bounded planning operation. Make reservations atomic in the central
  ledger, apply configured safety margins to fresh provider balances, avoid
  double-counting shared pools, and reconcile actual usage afterward. Do not
  claim that independent provider billing systems are transactionally locked.
- If a chain-backed slot's first candidate is ineligible before dispatch,
  continue only through that slot's named chain. A fixed-candidate slot never
  silently changes candidate. Apply required/optional policy when a slot cannot
  be funded and apply the lane's explicit budget-exhaustion merge policy only
  if missing aggregate assurance is caused solely by proven pre-dispatch budget
  exhaustion.
- Require each child acknowledgment to match the model target authorized in the
  immutable plan. An actual-model mismatch is a visible policy violation and
  cannot trigger replacement because the original child may have started.
- Dispatch all successfully planned slots concurrently up to the configured
  concurrency limit, but authorize no partial plan that is already unable to
  satisfy its required slots and minimum-success policy. Native Copilot
  request/observation and external adapter execution must remain distinct child
  operations under the same parent plan.
- Preserve the no-fallback-after-ambiguous-dispatch rule independently for each
  child. An ambiguous child is reconciled rather than replaced, while other
  already-authorized children may continue to terminal state.
- Add a durable parent plan receipt with lane, exact head, configuration digest,
  completion policy, slots, resolved candidates, exclusions, and child receipt
  IDs. Give each child its own dispatch/acknowledgment lifecycle, actual
  provider/model, budget observation, cost, findings metadata, and terminal
  outcome.
- Make replay and rerequest behavior idempotent. Replaying the same plan must
  not create new reviewer requests or comments. An authorized same-head
  rerequest creates a distinct parent attempt and preserves links to prior
  child receipts.
- Supersede an unfinished plan when the PR head changes. Results from an older
  head must not satisfy the new head's aggregate review requirement.
- Support independently configured lane completion policies using required
  slots plus a bounded `minimum_successes`. A plan satisfies review assurance
  only when every required slot completed successfully and the total number of
  completed reviews meets `minimum_successes`. Validate that the minimum is at
  least the number of required slots and no greater than the slot count.
  Skipped, deferred, timed-out, failed, or ambiguous children do not count.
- Record aggregate `assuranceOutcome=deferred` when the completion threshold
  cannot be met solely because of proven pre-dispatch budget exhaustion. Map
  only `gateOutcome` through the lane's explicit
  `budgetExhaustion.merge=block|allow`; any non-budget failure contributing to
  missing assurance always blocks.
- Publish bounded `sd-review / assurance` and `sd-review / gate` Check
  summaries showing every planned
  reviewer, candidate/backend, status, exact-head evidence, total and
  per-reviewer cost, completion threshold, and pending/deferred recovery state.
  Require only the gate Check in branch protection. Preserve reviewer
  attribution for findings; do not merge or rewrite findings.
- Keep aggregate attempt receipts immutable. A distinct linked recovery may
  update the exact-head Check projection only through deterministic monotonic
  revision/CAS and latest-authorized-attempt rules.
- Include parallel plans and child attempts in overall, per-repository,
  cheap-vs-deep, candidate, provider/model, and deferred-review reports.
- Keep provider, management, and reviewer credentials isolated to the child
  operation that needs them. Do not place prompts, diffs, raw findings, or
  secrets in the parent receipt or public summary.
- Extend installer update/uninstall, examples, setup documentation, and
  configuration validation for both reviewer lists without hard-coding Kimi,
  Qwen, Copilot, or a two-reviewer limit into the protocol.
- Make contract v2 a deliberate cutover. The installer performs a one-time
  migration from the legacy single-review setup to explicit named chains and
  slots. After cutover the runtime rejects legacy/default selectors; it does
  not dual-read or dual-write them indefinitely. Historical v1 receipts remain
  read-only evidence.

## Acceptance Criteria

- [ ] Source/compiler tests cover exact catalog version/digest pinning,
      explicit one/many slots, deterministic expansion and digest, source
      location diagnostics, rejection of imports/inheritance/runtime presets,
      and refusal to plan from YAML or a stale compiled manifest at runtime.
- [ ] A fresh or migrated single-review configuration explicitly references the
      lane's named primary chain through one `primary-review` slot and
      dispatches one reviewer without contextual defaults.
- [ ] This repository's deep fixture dispatches fixed Copilot and the first
      eligible candidate from `deep-independent` concurrently on the same exact
      head; with current example configuration that second candidate is Kimi.
- [ ] A fixture with three or more slots proves variable-length fan-out,
      bounded concurrency, unique child identities, and one aggregate result.
- [ ] Cheap and deep fixtures use different reviewer sets and candidate chains
      without cross-lane borrowing.
- [ ] Explicit candidate command tests target one named overridable slot while
      preserving every other reviewer; shorthand succeeds only with exactly
      one overridable slot.
- [ ] Slot-aware options tests return deterministic safe candidates for one and
      many overridable slots without creating a plan, reservation, or dispatch;
      reserved candidate/slot labels are rejected while broad route labels work.
- [ ] Validation rejects duplicate slot IDs, missing/unknown/wrong-lane chains,
      fixed or cross-chain candidate overlap, overrides outside a slot's chain,
      ambiguous shorthand, duplicate resolved reviewers, invalid completion
      thresholds, and reviewer/concurrency limits outside configured bounds.
- [ ] Budget tests cover independent and shared pools, atomic reservation,
      partial ineligibility, concurrent plans near exhaustion, reconciliation,
      and release of unused reservations.
- [ ] Execution tests prove child operations begin concurrently up to the cap
      and that one unambiguous failure, timeout, or ambiguous dispatch does not
      duplicate, cancel, or silently replace another child.
- [ ] Tests prove each child executes only its planned candidate, internal
      cross-model fallback is disabled, same-model provider failover stays
      inside policy, and actual-model mismatch cannot dispatch a replacement.
- [ ] Completion tests cover all required reviews succeeding, optional review
      failure, minimum success reached, minimum impossible, budget-only
      deferred assurance with blocked/passing gate, and mixed non-budget
      failure; only completed reviews count toward success thresholds.
- [ ] Check tests prove only `sd-review / gate` is branch-protection-required,
      assurance remains truthful, deferred passing text cannot claim review
      success, and dynamic child Checks remain diagnostic.
- [ ] Projection tests prove immutable aggregate attempts, same-head recovery,
      changed-head supersession, and stale-write rejection.
- [ ] Replay, authorized rerequest, changed-head, and partial-finalization tests
      prove exact-head isolation and no duplicate requests, receipts, findings,
      or comments.
- [ ] Aggregate summaries and reports expose parent/child correlation, manual
      versus automatic candidate selection, actual models/providers, per-child
      and total cost, and unambiguous deferred or incomplete status.
- [ ] Installer round-trip tests cover install, update, dry-run, idempotent
      reapply, one-time legacy migration, rejection after cutover, changed
      reviewer sets/chains, alternate consumer models/providers, and uninstall
      without deleting unrelated workflow configuration.
- [ ] Documentation explains configuration examples for one, two, and three or
      more reviewers, completion-policy tradeoffs, budget impact, branch
      protection implications, and recovery of deferred plans.
- [ ] Standalone fixtures reject parallel configuration before dispatch and
      report the capability as unsupported rather than empty or completed.

## Dependencies

- `07-25-budget-aware-review-degradation` for lane candidate chains, explicit
  candidate selection, budget state, explicit budget-exhaustion merge policy,
  and deferred recovery.
- Its local component children for compiled configuration,
  private-control-plane conformance, consumer lifecycle, and authorized
  adapters, plus external command-pack task
  `07-25-add-routed-review-operator-ux` for operator UX.
- `07-25-establish-trusted-finding-adjudication` for explicit human
  attestation and correctness-evidence coverage after stable parent/child
  finding provenance exists.
- Versioned parent/child receipt and acknowledgment support.
- A completion observer for asynchronous native Copilot reviews and external
  reviewer jobs.

## Out of Scope

- Combining findings into one synthesized AI review. Automatic runtime
  adjudication remains out of scope; trusted human adjudication is delegated to
  child `07-25-establish-trusted-finding-adjudication`.
- Automatically changing reviewer count based on PR risk or model quality.
- Unbounded fan-out or bypassing lane cost, data, authorization, or exact-head
  policy.
- Treating parallel AI reviews as a replacement for deterministic CI or
  required human review.

## Intended start order (2026-07-25 reconciliation)

- The external command-pack dependency (`07-25-add-routed-review-operator-ux`) is a
  consumer of this program's published contracts, not a start prerequisite — same
  qualifier as `07-25-budget-aware-review-degradation` records. That pack task is
  PARKED on contract stability; do not treat it as blocking local children.
