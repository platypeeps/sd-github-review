---
title: Compile and execute budget-aware review plans
status: planning
created: 2026-07-25
---
# Compile and execute budget-aware review plans

## Goal

Own the schemas, deterministic compiler, runtime plan authorization, receipts, checks, and setup-discovery contracts.

## Background

This is the `sd-github-review` component task from the accepted ownership
design. It turns the consumer source plus a safe exact-catalog projection into
one canonical runtime contract and executes provider-neutral review planning
against bounded private-control-plane decisions. It is an integration roadmap
for separate contract, compiler, authorization, and final-evidence children.

Delivery is split across
`07-25-define-budget-review-v2-contracts`,
`07-25-compile-routed-review-configuration`,
`07-25-authorize-budget-aware-review-plans`,
`07-25-finalize-budget-review-evidence`,
`07-25-support-standalone-review-mode`, and
`07-25-support-local-attested-reviews`.

## Requirements

- Define versioned human-source, catalog-projection, compiled-manifest,
  control-plane exchange, authorization, receipt, status, recovery, and setup-
  discovery schemas.
- Define explicit `standalone` and `managed` v2 modes. Standalone uses one
  explicit `direct-handler|local-attested` execution kind per lane without a
  catalog or control plane; managed uses the private catalog and authorization
  exchange. Never infer or change mode or execution from endpoint, credential,
  or runtime health.
- Compile deterministically with field-specific diagnostics, strict unknown-
  field rejection, canonical ordering/unit normalization, and source/catalog/
  output digests.
- Compile managed prompt-profile metadata and each candidate's exact binding;
  reject missing/unknown/incompatible profiles and any default, inheritance,
  fallback, or independent override mechanism.
- Reject imports, inheritance, runtime presets, inferred slots, unknown aliases,
  policy incompatibility, chain/slot overlap, and stale or uncompiled runtime
  configuration.
- Require explicit managed `budgetExhaustion.<lane>.merge=block|allow`; reject
  missing or legacy exhaustion values after one-time v2 migration and never
  synthesize a runtime default.
- Keep the compiler pure over supplied source/catalog inputs. Catalog retrieval
  and credential use remain outside it.
- Resolve a logical cheap/deep request into an immutable candidate plan bound to
  repository, PR, exact head, attempt, compiled digest, and prompt-profile mode
  and identity.
- Parse exact trusted candidate commands, give them one-attempt precedence over
  broad route labels, and reject candidate/slot control labels as unsupported.
- Serve bounded `/review options` discovery for lanes, overridable slots, and
  safe candidate aliases without creating an attempt, reservation, or dispatch.
- Accept dispatch authorization only from a response matching the complete
  request fingerprint. Persist authorization before reviewer side effects.
- Make named chains the only cross-model fallback authority and stop after any
  ambiguous possible dispatch.
- Persist bounded immutable attempt receipts that distinguish lane, chain, candidate,
  handler, prompt-profile mode/identity, actual provider/model, budget state,
  usage/cost, and deferral without storing source, prompt bodies/configuration,
  diffs, findings, transcripts, or credentials.
- Publish stable `sd-review / assurance` and `sd-review / gate` exact-head
  projections with independent review/assurance/gate outcomes. Require only the
  gate in branch protection and update a same-head projection only through a
  distinct linked authorized attempt plus monotonic revision/CAS.
- Apply merge allowance only to proven pre-dispatch budget exhaustion. All
  policy violations, ambiguity, incomplete output, authentication/framework
  errors, and other non-budget failures block.
- Publish bounded status, pending, explain, recovery, and setup-discovery
  contracts for consumers and the future command-pack UX.
- Keep managed authorization failure fail-closed and expose managed-only
  operations as explicitly unsupported in standalone rather than fabricating
  empty or zero-valued authoritative state.

## Acceptance Criteria

- [ ] Equivalent mode-specific inputs compile byte-for-byte identically and
      any semantic change alters the canonical digest.
- [ ] Invalid composition, references, capabilities, digests, or stale manifest
      fail before reservation or reviewer side effects.
- [ ] Runtime tests select the first authorized named-chain candidate, preserve
      the logical lane across Copilot/external handlers, and enforce exact-head
      and idempotent attempt identity.
- [ ] Runtime tests preserve the exact candidate-bound profile through compile,
      authorization, preparation, acknowledgment, and receipt; explicit
      candidate commands cannot select another profile.
- [ ] Candidate-command and options fixtures enforce trusted authors, strict
      aliases, deterministic safe suggestions, broad-label precedence, and a
      side-effect-free discovery boundary.
- [ ] Authorization mismatch, actual-model mismatch, and ambiguous dispatch
      fail visibly without authorizing another candidate.
- [ ] Receipt/check/status fixtures expose bounded provenance, cost unknowns,
      deferrals, and recovery links without prohibited fields.
- [ ] Check fixtures cover stable names, deferred assurance with blocked/passing
      gate, non-budget hard blocks, branch-protection readiness, same-head
      recovery projection, changed-head supersession, and stale-write rejection.
- [ ] Historical v1 receipts remain read-only while active dispatch accepts
      only the v2 compiled contract.
- [ ] Setup discovery advertises exact supported schema/capability versions.
- [ ] Standalone fixtures prove fixed cheap/deep/Copilot routing works with no
      control-plane endpoint or credential; all-local and mixed fixtures prove
      exact-head local assurance with zero reviewer dispatch; managed outage
      fixtures prove zero reviewer side effects and no runtime downgrade.

## Dependencies

- ~~`07-25-define-consumer-review-control-plane` for catalog projections and
  authoritative authorization responses in managed mode.~~ **Dropped as rejected
  2026-08-08** — `.trellis/tasks/archive/2026-08/08-08-backlog-consolidation/prd.md:78`
  (cluster "control-plane stores"), removed with `git rm -r` and the parent edge
  unlinked (`:148`). Managed mode therefore has no chartered counterparty. Resolving
  what `managed` means now is an open owner decision recorded as gap 8 in
  `research/2026-08-20-research.md`; the requirements below still assume the
  counterparty exists and have **not** been rewritten.
- `07-25-support-standalone-review-mode` for the control-plane-optional public
  routing contract.
- `07-25-integrate-authorized-review-adapters` for reviewer execution and
  acknowledgment.

## Out of Scope

- Catalog retrieval credentials, provider billing integrations, or ledger
  storage.
- Portable operator command implementation.

## Intended start order (2026-07-25 reconciliation)

- The mutual references among this task, `07-25-define-consumer-review-control-plane`
  (since dropped — see Dependencies),
  and `07-25-integrate-authorized-review-adapters` are co-evolving contracts, not a
  startable cycle. The ring breaks at `07-25-define-budget-review-v2-contracts`
  (no dependencies): contracts first → control-plane definition children → this
  task's compiler/authorization children → adapters → evidence finalization.
- The command-pack operator UX (`sd-ai-command-pack:07-25-add-routed-review-operator-ux`,
  currently PARKED there) consumes the published contracts afterward; it is a consumer,
  not a prerequisite (per the top parent's dependency qualifier).

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-compile-and-execute-budget-aware-review-plans`:

- research/2026-08-20-research.md
