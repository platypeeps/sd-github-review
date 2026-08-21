# Ordered Budget-Aware Review Chains Implementation Plan

## Child Delivery Tasks

This parent is the integration roadmap. Component work is owned by:

1. `07-25-compile-and-execute-budget-aware-review-plans` for schemas, compiler,
   provider-neutral runtime, receipts, checks, and published contracts;
2. `07-25-deliver-routed-review-configuration` for consumer source, migration,
   managed promotion, drift, and uninstall;
3. `07-25-integrate-authorized-review-adapters` for Copilot and external
   reviewer execution.

The private catalog/ledger contract, conformance fake, and external
implementation handoff were assigned to `07-25-define-consumer-review-control-plane`,
which does not exist: `task.json` lists the three children above and there is no
such directory under `.trellis/tasks/`. That scope is currently unowned. Recreate
the task or fold it into
`07-25-compile-and-execute-budget-aware-review-plans` before the adapter child
starts, since the adapter's bounded acknowledgment is defined against it.

Portable operator UX is owned externally by
`platypeeps/sd-ai-command-pack:07-25-add-routed-review-operator-ux`; it
consumes the contracts produced by these local children.

The execution order below is the parent integration sequence, not unowned work.

## Preconditions

- Review and approve `prd.md` and `design.md`.
- Re-own the private control-plane contract and handoff (see the missing-task
  note above); identify its private implementation repository and accountable
  owner before activating external implementation.
- Settle five decisions before starting any child, because all of them
  determine the compiled output every child reads. Two are contract-shape
  (implementation-state note in `design.md`): (a) whether the compiled
  manifest or the pinned catalog carries the ordered chain, and (b) whether the
  compiled lane keys are `cheap`/`deep` or the code's current
  `review`/`assurance`/`gate`. Three are artifact decisions (UNRESOLVED note
  above `design.md`'s Human Source Configuration, and in
  `07-25-deliver-routed-review-configuration/design.md`): (c) the consumer source
  path, which as proposed collides with the installer-overwritten
  `.github/workflows/sd-review.yml`; (d) the source format, since no YAML parser
  exists on the shipped path; and (e) whether the compiled contract joins the
  installer ownership manifest `.github/sd-github-review.json` or gets its own
  pending/active pair.
- Keep configuration, setup-discovery, status, pending, explanation, and
  recovery contracts aligned with command-pack task
  `07-25-add-routed-review-operator-ux`. The command pack consumes these
  contracts but does not become their authority.
- Curate real spec/research entries in `implement.jsonl` and `check.jsonl`
  before starting in sub-agent dispatch mode.

## Execution Order

Step 0 is new and blocking. Much of steps 1-7 is already implemented but
unreachable from `src/index.js` (71.5% of `src/`), and the compiler cannot
express an ordered chain at all — it emits one candidate per lane and forbids
`chain`/`chains` keys, while `prepareManagedPlan` requires a chain array with no
producer. Treat the existing modules as material to reuse, not as completed
steps, and verify each step against the code before assuming it is outstanding.

0. Close the compiler-to-planner chain seam. Give the compiled contract (or the
   pinned catalog, per the decision above) an ordered chain per lane, derive
   `prepareManagedPlan`'s `chain` argument from it, and prove one end-to-end walk
   of Copilot -> Kimi -> a third candidate with no test-only glue. Until this
   exists, every later step's budget, receipt, and check behavior is untestable
   in situ.
1. Add version-2 human-source, pinned-catalog, prompt-profile registry,
   compiled-manifest, budget request/response, authorization, receipt,
   deferral, and recovery fixtures with forbidden-field and size boundaries.
2. Implement pure human-source and catalog decoding, named-chain, explicit
   single-slot, and prompt-profile-reference validation, deterministic
   expansion, canonicalization, digests, and migration validation without
   runtime network access.
3. Implement a control-plane client boundary plus deterministic in-memory fake
   covering observe, reserve, reconcile, release, defer, and recover.
4. Add side-effect-free preparation followed by authorization-bound version-2
   routing, plus a read-only decoder for historical version-1 receipts.
5. Implement ordered named-chain and slot-targeted explicit-candidate selection,
   shared-pool reservations, freshness checks, leases, and no-fallback-after-
   ambiguity.
6. Extend native Copilot and external adapter dispatch so logical lane and
   actual backend remain separate. Resolve and verify the candidate-bound
   prompt profile before preparing an external request, validate acknowledged
   profile/model provenance, and keep PR-Agent internal cross-model fallback
   disabled.
7. Persist version-2 receipts and bounded Check summaries, including skipped
   predecessors, budget state, deferred outcome, and reconciliation links.
8. Implement the repository-side status, pending, explain, and recovery
   contracts consumed by the upstream command; do not add ledger authority to
   this repository.
9. Extend setup discovery and consumer installer install/update/check/uninstall
   behavior for the single YAML source, exact catalog pin, compiled managed
   manifest, named chains, explicit primary slots, one-time legacy migration,
   and private control-plane declaration.
10. Update examples and documentation, then run focused, full, metadata,
    installer, security, and review gates.

## Validation Matrix

- Config compile: source syntax and locations, exact catalog version/digest,
  valid replacement models/providers, duplicate/unknown IDs,
  missing/unknown/wrong-lane chains, invalid primary-chain references, missing
  or non-chain primary slots, disabled candidates, missing policies, missing/
  unknown/incompatible prompt profiles, forbidden defaults/inheritance/
  overrides, unsupported handlers, deterministic output, and manifest digest
  mismatch.
- Selection: first eligible in a named chain, slot-targeted explicit override,
  candidate outside the slot chain, pre-dispatch failure, shared pool,
  stale/unknown state, recovery hysteresis, and empty chain.
- Reservation: exact-head request preflight, conservative maximum cost, hard
  request limit, explicit units, idempotent replay, concurrent boundary, lease
  expiry, release, delayed reconciliation, soft overrun, hard violation,
  overdrawn blocking, quarantine, and missing usage.
- Token boundaries: input exact/under/over limit, no silent truncation,
  same-chain-only pre-dispatch continuation, explicit deferred assurance and
  merge-gate mapping for proven budget exhaustion, provider
  output-limit termination, no partial authoritative publication, and no post-
  dispatch retry or fallback.
- Fallback authority: internal fallback disabled, compliant same-model endpoint
  failover, different-model rejection, ambiguous dispatch stop, and no duplicate
  review/comment.
- Receipts: exact-head identity, named-chain and prompt-profile provenance,
  historical v1 read-only decoding, deep-through-Copilot, external adapter
  acknowledgment, deferred/recovered links, and privacy bounds.
- Recovery: unchanged head, changed head, closed PR, duplicate request,
  unavailable budget, ambiguous prior dispatch, overdrawn-pool replenishment,
  and authorized candidate-quarantine clearance with audit evidence.
- Installer: fresh install, one-time v1-to-v2 migration, post-cutover legacy
  rejection, explicit standalone/managed modes, standalone no-control-plane
  behavior, managed exact catalog resolution, mode-specific semantic diff,
  compiled pending/active manifest promotion, update, dry-run, idempotent
  reapply, drift, alternate consumer candidates/chains, uninstall, and secret/
  ownership preservation.

## Expected Validation Commands

- Focused Node tests for protocol, router, receipts, operations, adapters, and
  installer behavior.
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- consumer installer `check --json` and conflict-aware `--dry-run` fixtures.
- repository review preflight and secret/public-metadata scans.
- An import-graph walk from `src/index.js` showing the budget modules reachable.
  This is the parent's clearest done-signal: the baseline on 2026-08-20 was
  9,390 of 13,136 lines (71.5%) unreachable across 8 modules, with 11 modules
  and 3,746 lines reachable, and `npm test` green at 647 passing. That baseline
  is unchanged from the 2026-08-15 park re-verification — the same eight modules
  the repository independently names in `scripts/check-coverage.mjs:38-47` and
  sizes at "roughly 9,390 of the 13,136 lines" (`:31-32`).

Exact focused test filenames should be finalized after the implementation split
is approved; do not invent a second test harness.

## Compatibility And Rollback Gates

- Land schema, migration, and historical-receipt decoder support before any
  workflow emits version 2.
- Test the one-time installer migration, then reject legacy/default selector
  input after the repository declares version 2.
- Gate control-plane reservation, later candidates, and each lane's explicit
  budget-exhaustion merge policy independently so each can be disabled without
  changing model fallback.
- Before enabling a later candidate, verify price/data policy, model provenance,
  usage attribution, and no-fallback-after-ambiguity.
- Normal rollback restores a prior explicit version-2 primary-chain config.
  Emergency protocol rollback pins the prior version-1 Action/workflow;
  reconcile or expire outstanding private reservations first.

## Review Gates

- Confirm component boundaries do not move management credentials or ledger
  state into this public repository.
- Confirm candidate aliases, not provider/model names, drive protocol behavior.
- Confirm every external candidate has one explicit immutable prompt-profile
  binding, native prompting is handler-managed, and no lane/runtime default or
  command override can change the binding.
- Confirm every possible model change occurs before dispatch through the
  selected named chain.
- Confirm success with unknown usage does not fabricate zero cost.
- Confirm the assurance Check always reports deferred assurance truthfully and
  a passing merge gate never claims a completed or passing review.

## Follow-Ups

- Implement the private control plane in its consumer-owned repository.
- Unpark the local command-pack handoff only after the contracts stabilize, the
  command pack's current work completes, and the user explicitly authorizes
  upstream task creation.
- Start configurable parallel reviewers only after single-candidate reservation,
  reconciliation, and recovery are proven.
