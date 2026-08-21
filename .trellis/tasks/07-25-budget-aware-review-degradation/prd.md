# Implement ordered budget-aware review chains

## Goal

Run cheap and deep reviews through explicit named ordered candidate chains,
move down the selected chain as individual budgets are exhausted, and retain
recoverable evidence when no funded candidate remains.

## Background

`cheap` and `deep` are logical review lanes, not fixed models. This repository's
intended deep order starts with GitHub Copilot, continues to Kimi through
PR-Agent, and may then use additional configured providers/models while they
have usable budget. Its cheap order starts with the configured Qwen model and
continues through independently configured lower-cost candidates.

Copilot is a native GitHub reviewer rather than a PR-Agent model, so each list
must describe execution candidates, not only model IDs. Kimi and Qwen are this
repository's choices, not protocol constants: another consumer must be able to
replace either one, change providers, or reorder its candidates without code
changes.

The router currently requires cheap/deep receipts to use an external backend
and represents Copilot as its own route. Supporting the deep chain therefore
requires a versioned protocol change that preserves `selected_lane=deep` while
separately recording the backend that actually executed the review.

This task depends on authoritative usage/cost capture and reporting. Budget
state must be derived from each candidate's configured provider or budget
service rather than inferred from local counters alone.

## Accepted Ownership And Fallback Decisions

- Each ownership boundary below has an explicit child task; the mapping in
  `design.md` is authoritative and this parent remains the integration roadmap.
- `sd-github-review` owns the human-source configuration schema, deterministic
  compiler/normalizer, canonical compiled-manifest schema, provider-neutral
  planning, control-plane exchange, receipt, GitHub-check, and setup-discovery
  contracts. It validates decisions and correlation but does not store
  management credentials or operate the authoritative ledger.
- Each consumer's private control plane owns provider/billing integrations,
  the pinned versioned candidate catalog, provider/model/credential/policy
  bindings, management credentials, authoritative observations, atomic
  reservations, reconciliation, deferred-review storage, and retention/access
  policy.
- Version 1 uses normal reviewed repository changes for prompt, candidate, and
  same-model provider-policy changes. Comparative evidence is advisory; a
  separate pilot approval, fixed threshold/window, signed decision, or named
  pilot owner is not required for the fast-moving MVP. Hard qualification and
  security/policy enforcement remain required, and reports cannot mutate
  active policy automatically.
- `sd-ai-command-pack` owns the user-facing `sd-review config` and
  `sd-review budget` operations over the contracts published here. This
  repository remains the low-level contract owner and does not duplicate
  portable command UX. *(2026-08-20: the intended owning task
  `07-25-add-routed-review-operator-ux` does **not** exist in the command-pack
  tree — it is only named as a planned umbrella in that repository's
  `07-22-integrate-routed-review-backends` planning docs. `implement.md`
  Follow-Ups already gates its creation on explicit owner authorization; treat
  the ownership statement as intent, not as a live task reference.)*
- The selected named candidate chain is the sole cross-model fallback authority.
  PR-Agent/LiteLLM internal cross-model fallback remains disabled. A candidate
  may use same-model provider endpoint failover only inside its declared price,
  data, parameter, and attribution policy.
- Version 2 exposes two explicit operating modes: `standalone` keeps one
  explicit route execution kind per lane and requires no private service;
  `managed` enables catalog-backed candidates and control-plane authorization.
  Standalone execution is either a fixed direct handler or a repository-
  trusted exact-head local attestation. There is no inferred or runtime `auto`
  mode.
- A managed-service outage never falls back to standalone. Mode changes require
  a reviewed configuration update and semantic diff.

## Requirements

- Add one human-edited explicit-mode routed-review source file. Standalone source
  contains a strict `direct-handler|local-attested` execution union per lane;
  direct routes reference fixed setup-discovered profiles and local routes
  reference explicit actor/association, PR-author, and evidence-age policy.
  Managed source contains a pinned catalog reference, named chains, reviewer
  slots, completion policy, explicit budget-exhaustion merge policy, and
  reviewer policy. Neither contains provider credentials, budget API
  configuration, or secrets.
- In managed mode, require the pinned private catalog to define stable candidate IDs,
  handler/backend kind, optional provider and model, credential binding, budget
  source and scope, reservation policy, availability policy, and
  applicable price/data/prompt/reasoning/token controls, tokenizer/counting
  evidence, explicit units, and hard per-request cost limit.
- Require every managed external candidate to bind one immutable named prompt
  profile by alias, version, and digest. Multiple compatible candidates may
  share a profile; candidate-specific profiles are allowed. Native candidates
  such as Copilot explicitly declare handler-managed prompting. Forbid lane
  prompt defaults, inheritance, merge rules, comment-command profile overrides,
  and runtime profile substitution.
- Keep prompt-profile identity/compatibility metadata and candidate bindings in
  the private catalog while the adapter owns actual prompt/configuration values
  in a registry keyed by the same alias/version/digest. Public projections,
  source, logs, options, and receipts never expose those values.
- Keep repository chains and reviewer policy consumer-owned while catalog
  candidate definitions remain control-plane-owned and portable. Routing,
  receipts, budget logic, and tests must not branch on a hard-coded chain,
  provider, or model name.
- Compile the human source plus mode-specific supplied inputs into canonical,
  fully expanded JSON stored in a managed, digest-bound compiled artifact
  promoted through the installer's pending/active lifecycle. *(2026-08-20: this
  requirement previously named "the existing managed installer manifest".
  Whether that artifact is `.github/sd-github-review.json` itself or a separate
  file with its own pending/active pair is UNRESOLVED — see `design.md`'s
  Human Source Configuration note and
  `07-25-deliver-routed-review-configuration/design.md`. The requirement is the
  lifecycle and the digest binding; the file is an open decision.)*
  Managed compilation requires the exact catalog version/digest; standalone
  requires fixed profile discovery and/or complete local-attestation policy
  only. The runtime consumes only the compiled contract and never infers mode
  or execution kind during dispatch.
- Keep configuration composition deliberately small: one source file, no
  imports, no inheritance graph, and no runtime presets or inferred defaults.
  Installer presets may scaffold a complete explicit source file but never
  remain as hidden runtime behavior.
- Materialize each v2 lane as one explicit required, overridable
  `primary-review` slot referencing that lane's named primary chain. The runtime
  must not synthesize a contextual slot; the later parallel-review task extends
  this explicit list to multiple slots.
- Require every adapter to execute the candidate's declared model target.
  Acknowledgment of a different model is a visible policy violation and cannot
  authorize the next candidate because a review may already have started.
  Keep PR-Agent `CONFIG__FALLBACK_MODELS=[]` in generated examples and managed
  workflows.
- Configure this repository's `deep-primary` chain as Copilot first, Kimi
  through PR-Agent second, then explicitly configured additional candidates.
  Configure `deep-independent` without Copilot so it can serve a separate
  parallel-review slot predictably. Configure `cheap-primary` as Qwen through
  PR-Agent first, followed by explicitly configured cheap candidates. Disabled
  or unconfigured entries are skipped without changing chain order.
- Prove portability with a fixture that replaces Kimi with a different
  provider/model and another that replaces Qwen; both must work without source
  or protocol changes.
- Add an authorized explicit-candidate override orthogonal to lane selection:
  - `/review cheap --candidate <candidate-id>` and
    `/review deep --candidate <candidate-id>` target the lane's explicit
    primary reviewer slot when no slot is named.
  - `/review <lane> --slot <slot-id> --candidate <candidate-id>` targets an
    explicitly overridable named-chain slot for parallel plans.
- Add trusted, read-only discovery commands that never create an attempt,
  reserve budget, or dispatch a reviewer:
  - `/review options` lists the configured lanes and their overridable slots.
  - `/review options <lane>` lists that lane's overridable slots and candidates.
  - `/review options <lane> --slot <slot-id>` lists candidates eligible for the
    named slot.
  Bound the reply to safe aliases, display names, lane/slot eligibility,
  handler, cost tier, availability state/reason, and the catalog/configuration
  digest. Never expose credentials, private policy details, or raw balances.
- Keep `/review copilot` and `review:copilot` as supported direct native-backend
  routes. A consumer may also place the Copilot candidate in a named lane chain
  and request it explicitly through that lane.
- Treat candidate IDs as stable catalog aliases rather than provider or model
  names. Normalize and validate them strictly against the pinned catalog;
  reject unknown, duplicate, malformed, disabled, or wrong-lane candidates
  visibly.
- Keep only the stable route labels `review:cheap`, `review:deep`,
  `review:copilot`, and `review:none`. Candidate and slot selection is comment-
  command only. Reject `review-candidate:*` and `review-slot:*` as unsupported
  reserved controls; never provision, migrate, reconcile, or remove them.
- An explicit candidate must belong to the target slot's named chain and
  bypasses that chain's normal ordering but not authorization,
  credential, price, data-policy, availability, or budget checks. If it cannot
  run because pre-dispatch budget exhaustion is proven, record deferred
  assurance and apply that lane's explicit `budgetExhaustion.merge` policy; do
  not silently continue to another candidate. Any other failure blocks.
- Reject candidate overrides for `auto`, `copilot`, or `none`, and reject
  commands that specify multiple routes, slots, or candidates. Invalid input
  must return the bounded valid commands, slot IDs, or candidate IDs instead of
  fuzzy matching or silently correcting the request.
- Give an exact trusted comment command precedence over persistent broad route
  labels for that attempt. A candidate-only command is valid only when exactly
  one slot is overridable. An unavailable explicit candidate applies the
  lane's explicit budget-exhaustion merge policy without falling through only
  when budget exhaustion is proven; any other unavailability blocks.
- Include the requested candidate, selection source (`manual-command`),
  resolved candidate/configuration digest, and authorization
  evidence in the durable decision and receipt without exposing secrets.
- Define per-candidate budget states with at least `available`, `low`,
  `exhausted`, `unknown`, `disabled`, and `quarantined`, plus explicit pool
  `overdrawn` state. Include scope, currency or credit
  unit, limit, amount spent and remaining, reset/refill information when
  available, source, observation time, and freshness.
- Treat "non-zero budget" as enough verified remaining capacity for one
  bounded review, not merely a positive account balance. Before reservation,
  obtain a side-effect-free request preflight bound to the exact head,
  candidate, policy, and configuration digest. Reserve its conservative maximum
  expected charge within the hard request limit, then reconcile full
  authoritative usage afterward.
- Treat input-limit failure as pre-dispatch ineligibility: automatic selection
  may continue only within the same named lane chain; an explicit candidate
  records unsatisfied assurance and blocks without fallback. Never silently
  truncate context or escalate to another lane.
- Treat provider output-limit termination as
  `incomplete_token_limit`. It does not satisfy review assurance or publish an
  authoritative partial review, and it cannot authorize fallback because
  dispatch and spend occurred.
- Separate content and budget outcomes. Actual usage above reserve but within
  hard limits is `budget_overrun` and may retain a completed review; a hard
  input/output/cost breach is `policy_violation`, fails assurance, and
  quarantines the candidate. Reconcile full actual usage in both cases and
  block future reservations when the pool becomes `overdrawn`.
- Allow multiple candidates to reference one shared budget pool without
  double-counting its remaining capacity. Make reservation and reconciliation
  safe under concurrent repository dispatches.
- Refresh candidate budget and availability state before dispatch and on a
  scheduled reporting cadence. Missing, stale, or attribution-ambiguous state
  is `unknown`, never silently `available`.
- For each new cheap or deep review, select the first candidate in the
  applicable named chain that is enabled, available, policy-compatible, and
  funded above its dispatch reserve. Continue down the chain only after a
  candidate is proven ineligible or an
  unambiguous pre-dispatch failure proves that no review started.
- Never borrow from another named chain or lane implicitly. A candidate may
  appear in multiple chains only when the consumer configures it there, and it
  must retain the selected lane's price, quality, and data-policy constraints.
- Preserve the existing no-fallback-after-ambiguous-dispatch rule. Once a
  candidate may have started or acknowledged a review, stop the chain and
  reconcile it rather than risking a duplicate review through the next entry.
- Preserve `selected_lane=cheap|deep` for every candidate. Record lane, named
  chain ID, candidate ID and position, handler/backend, actual provider/model
  when known, budget source/state, selection reason, and every skipped
  predecessor in the acknowledgment and durable receipt.
- Extend the protocol so a deep decision may execute through the native Copilot
  backend without relabeling the lane as `copilot`. Keep explicit `copilot`
  routing as a supported direct route.
- Validate the budget scope actually charged for each handler. In particular,
  do not assume an organization-wide Copilot balance is dispatch-authoritative
  when GitHub attributes the request to a user, cost center, or other scope.
- Use explicit recovery hysteresis or an equivalent stable rule. When a
  higher-priority candidate's budget is verifiably replenished, return future
  reviews in that lane to it without rewriting or duplicating prior receipts.
- Require each lane to declare `budgetExhaustion.merge` explicitly as `block`
  or `allow`. There is no runtime default or contextual inference. Fresh
  installer scaffolds emit `block`; a consumer may deliberately choose
  `allow` through reviewed source configuration.
- For every proven pre-dispatch budget exhaustion, record
  `reviewOutcome=deferred_budget`, `assuranceOutcome=deferred`, and
  `gateOutcome=pass|block`. Map `merge: allow` to `gateOutcome=pass` and
  `merge: block` to `gateOutcome=block`, with reason
  `configured_budget_exhaustion`.
- Apply `merge: allow` only to proven pre-dispatch budget exhaustion. Policy
  violations, ambiguous dispatch, incomplete output, authentication failures,
  framework failures, and other non-budget errors always block regardless of
  the budget-exhaustion merge policy.
- Publish two stable exact-head Checks. `sd-review / assurance` is the truthful
  assurance signal and is `action_required` when assurance is deferred;
  `sd-review / gate` is the only branch-protection-required Check and succeeds
  only when the explicit merge policy permits merging. A passing deferred gate
  must say `Merge allowed; review assurance deferred`, never that review passed.
- Treat immutable receipts as per-attempt evidence while projecting the latest
  authorized result for the exact head into the two Checks. Recovery creates a
  distinct linked attempt; deterministic projection revision/CAS rules prevent
  late results from overwriting a newer authorized projection.
- Publish setup diagnostics that require only `sd-review / gate`, warn or fail
  readiness when `sd-review / assurance` is required or the gate is not, and
  never mutate branch protection without explicit repository authorization.
- For every deferred review, persist a privacy-bounded record containing the
  repository, PR, requested lane, exact head SHA, logical receipt/attempt
  identity, budget observation, deferral time, and current disposition. Do not
  retain prompts, diffs, findings, credentials, or raw provider output.
- Publish the bounded, versioned configuration, status, and recovery contracts
  consumed by command-pack `sd-review config` and `sd-review budget`
  commands. The budget report must show each named chain and
  candidate in configured order with current availability, usable remaining
  budget, reservation, freshness, expected reset/refill, and the reason it
  would be selected or skipped. It must also show whether each lane/chain can
  currently serve a review, configured hard request limits, soft overruns,
  overdrawn pools, candidate quarantines and their distinct recovery actions,
  and pending deferred reviews grouped by repository and lane.
- Publish a bounded, explicitly authorized candidate-quarantine clearance
  operation for the command-pack-owned `sd-review budget` UX. Clearance
  requires actor, reason, remediation evidence, and current policy/configuration
  digests; budget replenishment never clears quarantine implicitly.
- Provide an explicit re-review workflow for pending items after recovery. It
  must revalidate that the PR is open and identify whether its head still
  matches; dispatch a distinct authorized attempt linked to the deferral;
  supersede stale heads safely; and prevent duplicate reviews/comments.
- Report aggregate spend and outcomes by repository, logical lane, candidate,
  handler, provider, and model, including reviews served at each lane's chain
  position, failed for budget, deferred, recovered, superseded, and pending.
- Keep management credentials and central budget-ledger state out of consumer
  repository contents and public workflow output; they belong to the private
  consumer control plane.

## Child Deliverables

- `07-25-deliver-routed-review-configuration` owns source scaffolding,
  migration, and compiled-manifest promotion.
- `07-25-compile-and-execute-budget-aware-review-plans` owns public schemas,
  compilation, authorization exchange, receipts, and Checks.
- `07-25-define-consumer-review-control-plane` owns the provider-neutral
  private-service contract and conformance boundary.
  **STALE (2026-08-20): this task does not exist.** `task.json` lists three
  children and there is no such directory under `.trellis/tasks/` or in either
  archive month. Recreate it or fold the scope into
  `07-25-compile-and-execute-budget-aware-review-plans` before the adapter child
  starts — the adapter's bounded acknowledgment is defined against this
  contract. Tracked in `design.md` and `implement.md`.
- `07-25-integrate-authorized-review-adapters` owns secret-isolated execution
  of immutable authorized candidates.

## Acceptance Criteria

- [ ] Configuration validation covers human-source integrity, exact catalog
      integrity, unique lane-scoped chain IDs, unknown/duplicate chain entries,
      primary-chain references, unsupported handlers, missing budget sources,
      shared pools, invalid reserves, and an empty or completely disabled
      chain.
- [ ] Source/compile tests cover one human-edited YAML file, exact catalog
      version/digest pinning, missing/stale/mismatched catalog data, deterministic
      expansion, canonical manifest digest, no secrets, no imports/inheritance,
      and rejection when only uncompiled source is available at runtime.
- [ ] Fresh install and one-time migration write one explicit required,
      overridable `primary-review` slot per lane and never emit a legacy/default
      selector.
- [ ] Deep tests use this repository's `deep-primary` configuration to select
      Copilot first, Kimi when the Copilot budget is exhausted or unavailable,
      and a third configured candidate when both earlier budgets are exhausted.
- [ ] Deep independent-review tests resolve only through `deep-independent`
      and never select Copilot implicitly.
- [ ] Cheap tests select this repository's Qwen candidate first from
      `cheap-primary` and the next configured cheap provider/model when its
      budget is exhausted, without selecting a deep-only candidate.
- [ ] Alternate-consumer tests replace Kimi and Qwen with different
      provider/model choices without changing routing or protocol source.
- [ ] Command tests cover valid lane-primary and slot-targeted
      candidate overrides, candidate membership in the named chain,
      unambiguous shorthand, unauthorized requests, malformed or unknown IDs,
      wrong-lane candidates, duplicate controls, and forbidden overrides on
      `auto`, `copilot`, and `none`.
- [ ] Discovery tests cover all three `/review options` forms, trusted-author
      enforcement, deterministic safe output, invalid-input suggestions, and
      prove that discovery creates no attempt, reservation, or dispatch.
- [ ] Candidate/slot labels and `overrides.labels` are rejected as unsupported;
      installer install, migration, update, drift detection, and uninstall
      never manage those labels. Stable broad route labels continue to work.
- [ ] Tests prove an explicit candidate bypasses earlier candidates, never
      silently falls through when unavailable or exhausted, and applies the
      selected lane's explicit merge policy only for proven budget exhaustion.
- [ ] Receipts and reports distinguish automatic ordering from manual-command
      selection and identify the requested and actual candidate.
- [ ] Same-head rerequest tests prove that changing the explicit candidate
      requires a distinct authorized attempt and cannot alias or duplicate a
      prior candidate's receipt.
- [ ] Every dispatch invokes exactly one reviewer even when candidates share a
      provider or budget pool.
- [ ] Tests prove the selected named chain is the only cross-model fallback
      authority, generated PR-Agent configuration keeps internal cross-model
      fallback disabled, same-model provider failover stays inside policy, and
      an actual-model mismatch fails visibly without dispatching another
      candidate.
- [ ] Tests cover every per-candidate budget transition, stale/unavailable
      observations, refill/reset recovery, shared-pool accounting, and
      concurrent dispatches at the budget boundary.
- [ ] Token/cost boundary tests cover input preflight rejection, same-chain-only
      automatic continuation, explicit-candidate budget deferral or hard block,
      output-limit
      incompleteness, soft overrun, hard policy violation, candidate quarantine,
      overdrawn pool blocking, and verified recovery.
- [ ] No boundary test silently truncates context, publishes partial output as
      authoritative, escalates lanes, retries, or falls back after dispatch.
- [ ] Tests prove every executed candidate retains its requested cheap/deep
      lane while exposing the actual backend/provider/model and skipped
      predecessors.
- [ ] Prompt-profile fixtures prove explicit external-candidate binding,
      profile reuse, candidate-specific profiles, handler-managed native
      prompting, digest validation, and failure on missing, unknown,
      incompatible, or substituted profiles.
- [ ] Explicit candidate requests always use the candidate's catalog-bound
      profile and cannot select or override prompt profiles independently.
- [ ] Protocol migration tests cover deep-through-Copilot, explicit `copilot`,
      one-time conversion to named v2 chains, rejection of legacy selectors
      after cutover, and read-only access to historical v1 receipts.
- [ ] Tests prove `budgetExhaustion.merge=block|allow` maps proven pre-dispatch
      exhaustion to deferred assurance plus a blocked/passing gate, while every
      non-budget failure blocks regardless of this setting.
- [ ] `sd-review / assurance` and `sd-review / gate` retain stable names; only
      the gate is required by branch protection, and a passing deferred gate
      never claims that an AI review completed or passed.
- [ ] Projection tests prove immutable attempt receipts, linked recovery,
      exact-head supersession, and rejection of late writes from older
      projection revisions.
- [ ] Operators can determine from one report which candidate would serve each
      named chain and reviewer slot, the verified budget state of every
      candidate, whether any higher-priority budget has returned, and when each
      state was observed.
- [ ] The report distinguishes pool replenishment from candidate-quarantine
      clearance and exposes token limits, reservation/actual variance, finish
      reason, soft overrun, hard violation, and overdrawn recovery status.
- [ ] Quarantine-clear tests cover authorization, actor/reason/evidence
      binding, stale policy/configuration rejection, idempotent replay, audit
      history, and separation from pool replenishment.
- [ ] Operators can list deferred PRs and trigger bounded re-review after
      recovery without reconstructing prompts or manually finding workflow
      runs.
- [ ] Re-review tests cover unchanged head, changed head, closed PR, duplicate
      command, partial failure, and ambiguous prior dispatch.
- [ ] Usage/cost reporting attributes spend to the requested cheap/deep lane
      while separately exposing candidate, backend, actual model/provider, and
      budget pool.
- [ ] Documentation includes configuration examples, security boundaries,
      operational recovery steps, and rollback to budget-unaware routing.
- [ ] Standalone-mode tests preserve basic cheap/deep/Copilot routing without a
      control plane and expose managed-only capabilities as unavailable, while
      managed outage tests prove zero unauthorized reviewer side effects.
- [ ] Standalone-mode tests cover direct-only, all-local-attested, and mixed
      route execution. Only an authorized, timely, exact-head clean local
      attestation satisfies assurance; local-attested paths dispatch no
      reviewer and never claim independent review.

## Dependencies

- Authoritative usage/cost capture for every paid review.
- Overall, per-repository, and cheap-vs-deep cost reporting.
- A bounded durable store for budget observations and deferred-review records.
- A private consumer control plane implementing the versioned observation,
  reservation, reconciliation, release, deferral, and recovery contracts.
- `platypeeps/sd-ai-command-pack` task
  `07-25-add-routed-review-operator-ux` for portable configuration and budget
  operations. It consumes these published contracts but is not a prerequisite
  for implementing the core protocol.
- `07-25-define-review-data-retention-policy` for the concrete private data
  lifecycle, purge, backup, legal-hold, transfer, and coverage contract.
- Versioned receipt and acknowledgment changes that can represent a logical
  deep lane executing through either native Copilot or an external adapter.
- Candidate qualification and same-model provider-failover evidence for every
  cheap-chain entry. **STALE (2026-08-20): the named owner
  `07-25-govern-cheap-review-fallbacks` does not exist** in any active or
  archived tree; the sibling parent `07-25-cheap-review-cost-controls` already
  records it as a never-created child
  (`07-25-cheap-review-cost-controls/research/2026-08-20-research.md:289`).
  Repoint this dependency at whichever cost-controls child actually owns
  qualification, or drop it.

## Out of Scope

- Automatically re-running deferred reviews without an explicit repository
  policy or operator action.
- Dynamically reordering candidates by price or benchmark score; order remains
  an explicit operator-owned policy.
- Claiming that a deferred review provides the same assurance as a completed
  cheap, deep, or Copilot review.
- Using provider billing data as a place to store repository source content.
- Formal pilot-approval governance, mandatory evaluation thresholds or sample
  sizes, signed promotion decisions, and decision expiry for version 1.
