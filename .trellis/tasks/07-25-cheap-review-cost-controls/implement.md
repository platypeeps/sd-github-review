# Implement: cheap review cost controls (parent, integration plan)

> **Scope caveat.** `prd.md:93-96` says "no direct implementation — start
> children, not this parent," and that PRD-only is appropriate here. This plan
> therefore contains **no child implementation steps**. It is the cross-child
> integration checklist: what the parent verifies between and after children,
> and the gates that stop a child from shipping into an unverifiable state.
> Created on explicit owner instruction, 2026-08-20. Confirm before treating it
> as a mandate to run `task.py start` on this parent — the current decision of
> record is that this parent is never started.

Baseline at planning time: `40df292`, clean tree, `npm test` →
`tests 647 / pass 647 / fail 0`.

---

## Gate G0 — Resolve the two ownerless lanes (blocks integrated acceptance)

Nothing downstream is wrong without this, but the parent **cannot declare
integrated acceptance** while two of its five acceptance surfaces have no owner.

- [ ] Decide the fate of `govern-cheap-review-fallbacks` and
      `control-cheap-review-reasoning-effort`. They appear at `prd.md:70-71` and
      in the ordering constraint at `prd.md:82-84`, are absent from
      `task.json:21-25`, and have no directory under `.trellis/tasks/` or
      `.trellis/tasks/archive/`.
- [ ] Weigh the evidence that they were real: `decodeFailover` already enforces
      `sameModelOnly === true` with bounded `maxAlternates`
      (`src/review-candidate-catalog.js:538-549`), and `decodeRules` already
      carries a `reasoning` handle (`:559`). Contracts exist for both.
- [ ] Either recreate the two tasks, or amend `prd.md:70-71` and `prd.md:82-84`
      to the real three-child shape and record why in the PRD Notes block.
- [ ] Reconcile `prd.md` against `task.json:21-25` either way, so the two files
      agree on the child list.

**Validation:** the child list in `prd.md` and in `task.json` match, and every
task named in either has a directory. Check:

```bash
cd /Users/sven/repos/platypeeps/sd-github-review
grep -oE '07-25-[a-z-]+' .trellis/tasks/07-25-cheap-review-cost-controls/prd.md \
  | sort -u | while read t; do
      [ -d ".trellis/tasks/$t" ] || echo "MISSING: $t"; done
```

Expect **no output**. Any line printed means a named child has no task
directory. (Today this prints the two missing children plus the dependency
tasks referenced at `prd.md:75-79` — the check must be read as "every child
named in the Child Tasks section," so scope the grep to that section when
running it for real.)

---

## Gate G1 — Vocabulary decision, once, before any child implements

The outcome-name question is already settled and only needs recording: the code
carries the same two-axis split the PRD describes — an outcome on
`OUTCOME_REASON_CODES` (`src/protocol-v2.js:131-149`) plus a preflight reason on
`PREFLIGHT_INELIGIBILITY_REASONS` (`src/review-plan-authorization.js:80-88`) —
and `bound-cheap-review-token-usage/design.md:66-69` has already adopted
`input_ineligible` for the outcome. See `design.md` §C5.

- [ ] Amend `bound-cheap-review-token-usage/prd.md:28-29`, which still spells
      the outcome `ineligible_pre_dispatch`, a name that exists nowhere in
      `src/`. Amend `bound-cheap-review-token-usage/design.md:56`, whose table
      cell still reads `ineligible_pre_dispatch: input_token_limit` and
      contradicts that same document at `:66-69`.
- [ ] Decide whether `input_token_limit` is distinct from the existing
      `oversized` reason, which `src/review-plan-authorization.js:503-504`
      already uses for a conservative maximum charge above the hard per-request
      limit.
- [ ] Set one enum policy for both siblings.
      `bound-cheap-review-token-usage/implement.md:32` mints a new member of
      `PREFLIGHT_INELIGIBILITY_REASONS` without escalation;
      `enforce-cheap-provider-cost-policy/design.md:84-86` says minting a code
      in that enum "is a parent-level decision" and prefers reusing
      `unenforceable`. Both cannot be right.
- [ ] Record the outcome in the parent PRD Notes so all three children inherit
      it rather than re-litigating.

**Validation:** the retired outcome name survives only as history. Scope the
grep to `src/` and to the owning child's normative artifacts — the parent's C5
prose and the research notes discuss the retired name deliberately, so a
repo-wide grep is not the check.

```bash
grep -rn "ineligible_pre_dispatch" \
  src/ .trellis/tasks/07-25-bound-cheap-review-token-usage/{prd,design,implement}.md
```

Expect **no output**. Today this prints
`07-25-bound-cheap-review-token-usage/prd.md:29`, which is exactly the line this
gate exists to amend.

---

## Gate G2 — Measurement before enforcement (P0)

Parent AC #3 (`prd.md:51-52`) requires comparing cost and failure-rate evidence
before and after each child ships. That is impossible today:
`buildAdapterAcknowledgment` (`src/operations.js:242-259`) records only
`success | failure | cancelled | skipped` and carries no model, finish reason,
or usage. **No child may ship enforcement before this exists**, because a
control shipped without measurement cannot be evaluated and its rollback trigger
cannot be detected.

- [ ] Extend the acknowledgment with **additive optional** fields: finish
      reason, model actually used, bounded usage counts. Additive and optional
      is a hard constraint — see `design.md` §6; a required field or a fifth
      outcome breaks consumers mid-upgrade.
- [ ] Keep `ADAPTER_OUTCOMES` unchanged (defined at `src/operations.js:21`,
      enforced at `:245-249`).
- [ ] Assert the new fields carry no diff content, prompt text, partial model
      output, filenames, or credentials
      (`bound-cheap-review-token-usage/prd.md:59-63`).
- [ ] Confirm which module owns this change. It sits on the reachable v1 surface
      (`src/operations.js`), not in the unreachable v2 layer — that is the point
      of doing it first.

**Validation:**

```bash
npm test                    # expect: pass 647+ / fail 0
npm run check               # syntax gate
npm run validate:metadata   # action.yml contract
npm run validate:ci-parity  # workflow/example parity
```

A pre-P0 acknowledgment payload must still decode after the change. That is the
decisive backward-compatibility check — a new test asserting today's four-field
shape still round-trips.

---

## Per-child gates (P1 → P3)

Recommended order, deviating from `prd.md:82-84` as argued in `design.md` §5;
**needs owner sign-off** before the first child starts:

```
P1  bound-cheap-review-token-usage   (output cap first, then input preflight)
P2  reduce-cheap-review-prompt
P3  enforce-cheap-provider-cost-policy   (last: zero existing code, most unknowns)
```

Each child, before it is considered done, must clear all of:

- [ ] **Reachable slice.** The control demonstrably reaches the Docker
      invocation in both workflow shapes — `examples/pr-agent-router.yml:96-139`
      and `examples/pr-agent-on-demand-review-router.yml:111-154`. A control
      that only exists in the v2 layer is not done; 71% of `src/` is already in
      that state (`design.md` §1).
- [ ] **Both workflows agree.** The event-driven and durable paths must carry
      identical cost configuration. They are separate files and drift silently.
- [ ] **This repo's own installed copies updated.** `examples/pr-agent-router.yml`
      is byte-identical to `.github/workflows/ai-review-router.yml`, and
      `examples/sd-review.yml` to `.github/workflows/sd-review.yml` — this repo
      self-installs its own templates. **Nothing enforces that pairing**:
      `scripts/validate-ci-parity.mjs` only compares the npm gate list in
      `.github/workflows/ci.yml` against `check:full`, and the pinned-workflow
      assertion at `test/metadata.test.js:161-175` reads only files under
      `examples/`. A child that edits a template and not its installed copy
      leaves this repository running a workflow that no longer matches the
      template it ships. Consider closing this with a byte-equality test rather
      than a checklist item.
- [ ] **Lane discipline.** The child touched only its lane per the table in
      `design.md` §2. In particular `src/router.js` is untouched — a cost
      outcome must never reach `ROUTE_STRENGTH` / `strongerRoute`
      (`src/router.js:15-20, 78-84`).
- [ ] **Fail-closed proven.** The child's fail-closed path is covered by a test
      that would fail if the guard were removed, not merely by a guard being
      present.
- [ ] **Rollback trigger stated**, and detectable from bounded acknowledgment
      evidence alone. A trigger requiring inspection of review content is
      invalid under the retention constraints.
- [ ] **Deep and Copilot untouched.** `requestCopilotReviewer`
      (`src/reviewer-dispatch.js:9-44`) gains no cost path.
- [ ] **No manifest bump** without parent escalation. Cost policy belongs in the
      pinned catalog, not the installer manifest (`design.md` §6); a v5 bump
      affects every consumer's upgrade path and is a parent decision.

**Per-child validation:** full `npm run check:full`, plus the child's own
acceptance criteria.

---

## Cross-child integration verification (parent's own work)

These are the checks **no child can run**, because each requires two or three
children to be active at once. Run after the last child in the sequence.

### V1 — One reservation composed from all three children

- [ ] Fixture with the prompt profile, provider price policy, and token caps all
      active. Assert exactly one reservation is taken, and that the reserved
      amount stays bounded by `hardRequestCostLimit` with `safetyMargin` still
      strictly below it (`src/review-candidate-catalog.js:505-516`, re-asserted
      on the projection at `:877-885`).
- [ ] Assert the arithmetic uses counted input, the configured output cap,
      pinned prices, unit conversion, and the margin — i.e. that the prompt
      child's input reduction and the price child's unit prices both actually
      reach the token child's computation rather than being computed from
      defaults.

### V2 — No post-dispatch fallback, from any of three causes

- [ ] Three fixtures: token ineligibility, price-cap exhaustion, profile
      mismatch. All three must land on the same terminal behaviour — no retry,
      no next candidate, no deep escalation.
- [ ] Assert the pre-dispatch axis (`RESERVATION_OUTCOMES` and its bounded
      reasons, `src/review-budget-ledger.js:83-96`) and the post-dispatch axis
      (`OUTCOME_REASON_CODES`, `src/protocol-v2.js:131-149`) stay separate: no
      value from the second axis feeds a dispatch decision.

### V3 — Partial output never counts as assurance

- [ ] A length-terminated response yields `incomplete_token_limit`
      (`src/protocol-v2.js:136`), assurance `incomplete`
      (`src/review-usage-reconciliation.js:66`), and side effect
      `review_published` (`:71`) — spend and a side effect occurred, the review
      does not count.
- [ ] Assert it is **not** published as an authoritative partial review, and
      triggers no retry.

### V4 — Overrun vs violation, and their independent consequences

- [ ] `budget_overrun` retains a valid completed review; `policy_violation` does
      not satisfy assurance. Both reconcile full actual usage
      (`src/review-usage-reconciliation.js:79-83`).
- [ ] A debit driving a pool negative marks it `overdrawn`
      (`src/review-budget-ledger.js:62`) and blocks future reservations via
      `pool_overdrawn` (`:88-96`).
- [ ] A hard-limit violation quarantines the candidate
      (`quarantineCandidate`, `:1135`) **independently of** pool recovery —
      releasing the pool must not release the quarantine.

### V5 — Model substitution is visible

- [ ] `CONFIG__FALLBACK_MODELS: '[]'` still present in **both** workflows
      (`examples/pr-agent-router.yml:115`,
      `examples/pr-agent-on-demand-review-router.yml:130`) — this is a standing
      parent requirement (`prd.md:17-20`).
- [ ] Configured model and actual model both appear in the acknowledgment, and a
      mismatch fails visibly rather than being recorded as success.

```bash
grep -c "CONFIG__FALLBACK_MODELS: '\[\]'" \
  examples/pr-agent-router.yml examples/pr-agent-on-demand-review-router.yml
```

Expect `1` from each file.

### V6 — No leakage into logs or durable artifacts

- [ ] No prompt text, source content, filenames, or credentials in workflow
      logs, durable artifacts, receipts, or usage metadata.
- [ ] Catalog opacity intact: `referenceValue` handles (`price`, `data`,
      `promptRule`, `reasoning` at `src/review-candidate-catalog.js:551-560`)
      are still opaque — no child inlined a resolved value into repository
      source (`:348-352`).

---

## Documentation gates

Two parent acceptance criteria are documentation-only and currently unmet
(`prd.md:58-63`). Neither is a child's job — each spans all lanes.

- [ ] Document the four-way distinction: ordered candidate selection, same-model
      provider failover (`src/review-candidate-catalog.js:538-549`), prohibited
      runtime cross-model substitution, and manual deep escalation. Target:
      `SETUP-PR-AGENT.md` and/or `README.md`.
- [ ] Document the prompt-profile model: reusable registry entries (`:633`),
      candidate-specific bindings, native handler-managed prompting
      (`:733-739`), and candidate/profile qualification. Include the forbidden
      levers — all eleven of `default`, `laneDefault`, `inheritance`, `inherit`,
      `merge`, `fallback`, `substitute`, `substitution`, `commandOverride`,
      `runtimeOverride`, `override` (`:566-580`).
- [ ] Document context-window capacity vs enforced token and spend budgets — the
      distinction `bound-cheap-review-token-usage/prd.md:11-13` warns must not be
      conflated.
- [ ] Document the cheap profile's intentional omissions and when a maintainer
      should ask for deep review
      (`reduce-cheap-review-prompt/prd.md:57-58`).

---

## Housekeeping

- [ ] Add the eight v2 modules to `npm run check`. The hardcoded `node --check`
      list in `package.json` covers the eleven reachable modules and omits
      `protocol-v2.js`, `retention-policy.js`, `review-budget-ledger.js`,
      `review-candidate-catalog.js`, `review-deferred-recovery.js`,
      `review-plan-authorization.js`, `review-usage-reconciliation.js`,
      `routed-review-compiler.js` — exactly the unreachable set. Prefer a glob
      over an enumeration so it cannot drift again.

**Validation:** every file matching `src/*.js` is syntax-checked.

```bash
ls src/*.js | wc -l    # 19 today
```

Compare against the number of `node --check src/` targets the script runs.

---

## Open items this plan cannot close

Carried from `research/2026-08-20-research.md`; each needs an owner decision or
an access this planning run did not have.

1. **Does this parent get design/implement at all?** `prd.md:93-96` says
   PRD-only. These documents exist by owner instruction. Confirm rather than
   leaving the contradiction unresolved.
2. **Is the park still valid?** It is no longer in force: `task.json:30` has
   `blockedOn: null`, and the notes at `task.json:28` record "2026-08-20:
   Unparked by owner directive (unpark-all)". The two premises were last checked
   on 2026-08-17 under the two-step probe recorded in
   `07-25-bound-cheap-review-token-usage/task.json` — reachability still exactly
   9,390/13,136 across 11 reachable of 19 `src/` files, and all four fleet
   consumers `repo:200 config:404`. This run independently re-derived the
   reachability half by walking import edges (unchanged) but did **not** re-probe
   the consumers; that half rests on the 2026-08-17 result, not on this pass.
3. **Which PR-Agent settings enforce limits?** Requires inspecting the pinned
   image `pragent/pr-agent@sha256:cae31b51b65b5c978a3b2a978d96e89e6a4c5bcd81cb2553fd8dad0251c3a23e`
   (`examples/pr-agent-router.yml:137`). Unanswered anywhere in the repo, and
   `bound-cheap-review-token-usage/prd.md:22-23` makes answering it that child's
   first requirement. If no output-cap setting exists, the P1-first ordering in
   `design.md` §7 is wrong and must be revisited.
4. **Routine PR payload sizes.** Needed to pick real budgets
   (`bound-cheap-review-token-usage/prd.md:24-25`). No measurement exists in the
   repo.
5. **Order deviation sign-off.** Moving `enforce-cheap-provider-cost-policy`
   last contradicts `prd.md:82-84`. Owner decision.
