# Design: cheap review cost controls (parent, integration-level)

> **Scope caveat.** `prd.md:93-96` records a 2026-07-25 reconciliation decision
> that this is a coordination-only parent and "PRD-only is appropriate." This
> document was created on explicit owner instruction for the 2026-08-20 planning
> run. It deliberately contains **no implementation design** — children own
> every line of that. It designs only the cross-child seams, the invariants no
> single child can hold, and the sequencing. If the coordination-only decision
> still stands, this document is the integration contract, not a reversal of it.

Evidence base: `research/2026-08-20-research.md` (same directory). Every
technical claim below is cited to a file:line established there.

---

## 1. What this parent is actually coordinating

The design problem is **not** "how do we build cost controls." The contracts are
largely built. `src/review-budget-ledger.js` (1,247 lines),
`src/review-usage-reconciliation.js` (1,026), `src/review-candidate-catalog.js`
(1,089) and `src/routed-review-compiler.js` (450) already implement reserve /
authorize / reconcile / quarantine, the `within_reserve | budget_overrun |
policy_violation` split (`src/review-usage-reconciliation.js:79-83`),
`usable | overdrawn` pools (`src/review-budget-ledger.js:62`), verified-tokenizer
and verified-pricing refusals (`src/review-candidate-catalog.js:867-876`), and
the `sameModelOnly` failover rule (`:538-549`). All 647 tests pass.

The design problem is that **none of it is reachable.** `src/index.js:3-17`
imports six modules; the eight modules above are 9,390 of 13,136 lines (71%) with
no path from the entrypoint. The cheap lane's entire real cost surface is four
environment variables and a bare `review` command in consumer YAML
(`examples/pr-agent-router.yml:114-116, 138-139`).

So this parent coordinates a **wiring problem with three contributors**, and its
job is to keep those three contributors from each inventing their own path from
catalog to Docker invocation.

---

## 2. Boundaries with child tasks

### The seam every child crosses

```
  pinned private catalog (out of repo)
        │  decodeCandidateCatalog          src/review-candidate-catalog.js:792
        ▼
  compiled safe projection
        │  compileRoutedReviewConfiguration src/routed-review-compiler.js:442
        │  decodeCandidateSafeProjection    src/review-candidate-catalog.js:862
        ▼
  adapter request  ──►  PR-Agent Docker run  ──►  acknowledgment
     src/protocol.js:661   examples/*.yml:96+     src/operations.js:242
        │                                              │
        └──────── reserve ────────►  ledger  ◄──── reconcile ────┘
              review-budget-ledger.js:755    review-usage-reconciliation.js:893
```

Each child owns one *lane* through that seam and nothing else:

| Child | Owns | Must not touch |
| --- | --- | --- |
| `bound-cheap-review-token-usage` | Input preflight, output cap, the reserve/reconcile call sites, finish-reason evidence | Provider selection, prompt content |
| `enforce-cheap-provider-cost-policy` | Resolution of the catalog `price` and `data` handles (`src/review-candidate-catalog.js:556-557`) into provider routing on the OpenRouter path | Token counting, prompt content |
| `reduce-cheap-review-prompt` | The adapter-side registry keyed by profile identity; resolution of the `promptRule` handle (`:558`) | Reservation arithmetic, provider selection |

The three `decodeRules` handles the children resolve — `price`, `data`,
`promptRule` — are declared adjacent at `src/review-candidate-catalog.js:551-560`
and are **opaque by construction**: `referenceValue` (`:348-352`) documents that
"the catalog never carries the resolved value, only the handle the private
control plane resolves." That is the parent-owned boundary. A child that inlines
a resolved value into repository source has violated it, and the existing
forbidden-content walker is the enforcement point.

### Two lanes with no owner

The fourth handle, `reasoning` (`:559`), and the failover contract
(`decodeFailover`, `:538-549`) have **no child task**.
`prd.md:70-71` names `govern-cheap-review-fallbacks` and
`control-cheap-review-reasoning-effort`; neither has a directory, and
`task.json:21-25` lists only three children. The contracts exist in code, so
these were real work items that fell out of the tracker.

**Design consequence:** the ordering constraint at `prd.md:82-84` — four
children before `govern-cheap-review-fallbacks` — is currently
unsatisfiable-and-unfalsifiable. This parent cannot declare integrated
acceptance while two of its five acceptance surfaces have no owner. Resolving
this is gate G0 in `implement.md`.

---

## 3. Contracts the parent owns

These are invariants that are individually true in each child and only
*jointly* verifiable at the parent.

### C1 — One reservation per dispatch, composed from all three children

`hardRequestCostLimit` and `safetyMargin` are a single pair on the candidate
policy, with the invariant that the margin sits strictly below the limit
(`src/review-candidate-catalog.js:505-516`, re-asserted on the projection at
`:877-885`). All three children feed the same computation:

- the prompt child changes the **input size** the estimate is taken from,
- the price child changes the **unit prices** it is multiplied by,
- the token child owns the **arithmetic and the reserve call**.

No child can verify the composition. The parent must hold a fixture where all
three are active simultaneously and the reserved amount is still a single number
bounded by `hardRequestCostLimit`.

### C2 — No post-dispatch fallback, from any cause

`prd.md:26-29` forbids escalation after dispatch. Each child restates it for its
own trigger — token ineligibility, price-cap exhaustion, profile mismatch. The
composition is what needs testing: three distinct causes must all land on the
same terminal behaviour. The existing vocabulary already separates
pre-dispatch refusal from post-dispatch outcome:
`RESERVATION_OUTCOMES = reserved | ineligible` with bounded fail-closed reasons
(`src/review-budget-ledger.js:83-96`) is the pre-dispatch axis;
`OUTCOME_REASON_CODES` (`src/protocol-v2.js:131-149`) is the post-dispatch axis.
The parent's contract is that **no code path moves an item from the second axis
back onto a dispatch decision.**

The pre-existing route machinery helps here: `ROUTE_STRENGTH`
(`src/router.js:15-20`) with `strongerRoute`/`weakerRoute` (`:78-84`) makes any
cheap→deep move an explicit strength comparison rather than an implicit
reroute. Cost outcomes must never reach those functions.

### C3 — Partial output is never assurance

`REVIEW_ASSURANCES = completed | incomplete | ambiguous`
(`src/review-usage-reconciliation.js:66`) paired with
`RECONCILIATION_SIDE_EFFECTS = none | review_published | ambiguous` (`:71`)
already models "spend and a side effect occurred, but the review does not
count." `incomplete_token_limit` exists as a reason code
(`src/protocol-v2.js:136`).

The gap is at the **reachable** end. `buildAdapterAcknowledgment`
(`src/operations.js:242-259`) accepts only `success | failure | cancelled |
skipped` and emits `acknowledged | failed`. A length-terminated review reports
`success`. Until the acknowledgment carries a finish reason, C3 is unenforceable
regardless of what the ledger believes.

### C4 — Configured model equals actual model

`prd.md:49-50`. Today the acknowledgment has no model field at all
(`src/operations.js:242-259`), and the configured model is a mutable consumer
repository variable `vars.CHEAP_REVIEW_MODEL` (`examples/pr-agent-router.yml:49`)
guarded only by a provider-prefix string check (`:63-94`).
`CONFIG__FALLBACK_MODELS: '[]'` (`:115`) removes the *runtime* substitution
vector, which is why the parent PRD requires keeping it empty
(`prd.md:17-20`) — but it does not produce evidence that no substitution
occurred. C4 needs a field, not just a config.

### C5 — Vocabulary is chosen once, at the parent

`src/protocol-v2.js:135` implements `input_ineligible`.
`bound-cheap-review-token-usage/prd.md:28-29` specifies a candidate marked
`ineligible_pre_dispatch` with reason `input_token_limit`.

This is **not** two competing factorings. The code already carries the same
two-part split the PRD describes: an outcome on `OUTCOME_REASON_CODES`
(`src/protocol-v2.js:131-149`) and a separate preflight reason on
`PREFLIGHT_INELIGIBILITY_REASONS` (`src/review-plan-authorization.js:80-88`).
The only mismatch is that the outcome *name* `ineligible_pre_dispatch` does not
exist in the code, and `bound-cheap-review-token-usage/design.md:66-69` has
already adopted `input_ineligible` in its place. The parent's job here is to
record that resolution and have the child PRD line amended to match — not to
adjudicate a design choice.

Two live questions do remain for the parent, because they touch an enum three
children read:

- `PREFLIGHT_INELIGIBILITY_REASONS` already contains `oversized`, used at
  `src/review-plan-authorization.js:503-504` for a conservative maximum charge
  above the hard per-request limit. Adding `input_token_limit` for counted input
  above `hardInputLimit` is adjacent to it; the parent should confirm the two
  are meant to be distinct rather than one reason serving both.
- The siblings disagree on enum policy. `bound-cheap-review-token-usage`
  mints a new member of `PREFLIGHT_INELIGIBILITY_REASONS` without escalation,
  while `enforce-cheap-provider-cost-policy/design.md:84-86` states that minting
  a new code in that shared enum "is a parent-level decision" and prefers reusing
  `unenforceable`. One policy, applied to both.

---

## 4. Data flow, end to end

The intended cheap-review path once children land:

1. **Route.** `routeReview` (`src/router.js:22-69`) returns `cheap` for a
   routine PR. Unchanged by this work.
2. **Compile.** The pinned catalog is decoded (`:792`) and compiled to a safe
   projection (`src/routed-review-compiler.js:442`), which refuses to emit an
   unverified tokenizer (`src/review-candidate-catalog.js:867-871`) or
   unverified pricing (`:874-876`). *Fail-closed happens here, before any spend.*
3. **Preflight.** Input is counted with the projection's declared tokenizer.
   Over the hard input limit → `input_ineligible`, no reservation, no
   invocation, no truncation. Automatic routing may advance only within the
   cheap chain; an explicit candidate blocks (`prd.md:23-25`).
4. **Reserve.** `reserve` (`src/review-budget-ledger.js:755`) takes a lease.
   Refusals are bounded and fail-closed (`:88-96`) — an overdrawn pool
   (`pool_overdrawn`) or a quarantined candidate (`candidate_quarantined`) deny
   capacity rather than guessing.
5. **Dispatch.** The adapter request (`src/protocol.js:661`) drives the Docker
   run (`examples/pr-agent-router.yml:96-139`), now carrying the output cap, the
   resolved provider policy, and the bound prompt profile.
6. **Acknowledge.** `buildAdapterAcknowledgment` (`src/operations.js:242-259`)
   records outcome — extended to carry finish reason, model actually used, and
   bounded usage counts.
7. **Reconcile.** `reconcileUsage` (`src/review-usage-reconciliation.js:893`)
   debits full actual usage and classifies `within_reserve | budget_overrun |
   policy_violation` (`:79-83`). A debit that drives the pool negative marks it
   `overdrawn` (`src/review-budget-ledger.js:62`), blocking future
   reservations. A `policy_violation` quarantines the candidate
   (`quarantineCandidate`, `:1135`) independently.

Steps 2, 4, and 7 are written and tested but unreachable. Steps 3, 5, and 6 are
the children's real work. **Step 6 is the parent's leverage point** — it is the
only one of the three that is already reachable from `src/index.js`, and it
gates measurement for all three children (see §7).

---

## 5. Tradeoffs

**Wire one slice vs. finish the contracts.** The tempting path is to complete
the remaining catalog fields first. The evidence argues against it: 71% of
`src/` is already well-tested and consumer-less. Adding breadth to an unreachable
layer compounds the existing problem and cannot be validated end-to-end. The
parent should require that each child ship a reachable slice, however thin,
rather than a complete contract.

**Acknowledgment schema churn vs. measurement.** Extending
`buildAdapterAcknowledgment` touches a shipped v1 surface with existing
consumers, so it carries real compatibility cost (§6). The alternative is that
no child can produce before/after cost evidence, which is parent AC #3
(`prd.md:51-52`). Measurement wins; the compatibility cost is manageable with
additive optional fields.

**Catalog opacity vs. debuggability.** `referenceValue` (`:348-352`) means an
operator reading repository source cannot tell what price ceiling is in force.
That is deliberate and correct for credentials, and awkward for cost policy. The
resolution is that the *acknowledgment* — not the source — carries bounded
compliance evidence (`enforce-cheap-provider-cost-policy/prd.md:40-41`), so
debuggability is bought at the observability end rather than by weakening
opacity.

**Ordering: price policy last.** `prd.md:82-84` orders the price child second.
The evidence supports moving it last of the three: it has zero existing code
(`maxPrice`, `provider_preferences`, `data_collection` all return zero hits
across `src/`, `scripts/`, `examples/`), the most external unknowns about the
pinned LiteLLM path, and the weakest coupling to the other two. This is a
recommended deviation from the PRD's stated order and needs owner sign-off.

---

## 6. Compatibility

**Manifest schema v4.** `MANIFEST_SCHEMA_VERSION = 4`
(`scripts/consumer-installer/codecs.mjs:159`); v4 *is* the route-mode feature
(`ROUTE_MODE_MIN_SCHEMA_VERSION = 4`, `:171`). Installer-managed route mode
resolves through explicit option → manifest → observed `REVIEW_ROUTE_MODE`
variable (`scripts/consumer-installer.mjs:204-213`), and a pre-v4 manifest is
told to "run update to record REVIEW_ROUTE_MODE" (`:477`).

No cost control is installer-managed today. **Parent position: keep it that
way.** Cost policy belongs in the pinned private catalog, which is the boundary
`prd.md:30-33` already draws. Preferring the catalog avoids a v5 bump, avoids
duplicating policy in two places with independent drift, and keeps the
installer's job as route-mode and workflow provisioning. A child that believes
it needs a manifest field must escalate to the parent — a v5 bump is a
parent-level decision because it affects every consumer's upgrade path, not just
one lane.

**Adapter acknowledgment v1.** Extensions must be **additive and optional**.
`ADAPTER_OUTCOMES` stays `success | failure | cancelled | skipped`
(defined at `src/operations.js:21`, enforced at `:245-249`); finish reason, actual model, and usage counts
arrive as new optional fields so an older consumer workflow emitting today's
shape still decodes. Adding a *required* field, or a fifth outcome, breaks
consumers mid-upgrade and is out of bounds for v1.

**Route semantics.** `ROUTE_MODES = auto | cheap | deep | copilot | none`
(`scripts/consumer-installer/codecs.mjs:122`) and `ROUTE_STRENGTH`
(`src/router.js:15-20`) are unchanged by all three children. Any child that
finds itself editing `src/router.js` has left its lane.

**Deep and Copilot lanes.** Untouched. All three child PRDs say so
(`bound-cheap-review-token-usage/prd.md:64`,
`reduce-cheap-review-prompt/prd.md:40`), and the parent's out-of-scope list
excludes Copilot's GitHub-managed model and effort (`prd.md:89-90`).
`requestCopilotReviewer` (`src/reviewer-dispatch.js:9-44`) must not gain a cost
path.

**Retention.** Usage metadata must carry no diff content, prompts, partial model
output, filenames, or credentials (`bound-cheap-review-token-usage/prd.md:59-63`).
The retention subjects are already classified — `budget_observation` at 90 days,
`bounded_event` receipts at 13 months, `adjudication_chain` audit at 13 months
(`src/review-budget-ledger.js:100-113`,
`src/review-usage-reconciliation.js:106-113`). Children inherit these classes;
they do not define new ones.

---

## 7. Rollout and rollback shape

**Rollout is per-child and independently reversible.** The parent adds one
sequencing rule beyond the PRD's: *the acknowledgment extension (C4/C3 evidence)
ships before any child's enforcement*, because it is the only way to satisfy
parent AC #3 — comparing cost and failure-rate evidence before and after each
child (`prd.md:51-52`). Enforcement shipped before measurement cannot be
evaluated, and its rollback trigger cannot be detected.

Revised order, deviating from `prd.md:82-84` as argued in §5:

```
G0  resolve the two missing children  (blocks integrated acceptance only)
P0  acknowledgment evidence: finish reason + actual model   [parent-adjacent]
P1  bound-cheap-review-token-usage    (output cap first, then input preflight)
P2  reduce-cheap-review-prompt
P3  enforce-cheap-provider-cost-policy
```

**Rollback granularity.** Each control is a distinct configuration surface, so
each rolls back alone:

| Control | Rollback |
| --- | --- |
| Output cap | Remove the `CONFIG__*` env var from the Docker run; the lane returns to today's uncapped `review` (`examples/pr-agent-router.yml:138-139`) |
| Input preflight | Fail-open is **not** an option — the PRD requires fail-closed (`bound-cheap-review-token-usage/prd.md:41-43`). Rollback is reverting the preflight call site, not disabling the check |
| Prompt profile | Rebind the candidate to its prior profile in the catalog; the digest-mismatch path (`src/review-candidate-catalog.js:1016-1026`) makes the change visible |
| Provider policy | Revert to an explicitly pinned baseline OpenRouter provider policy, which that child's own AC already requires documenting (`enforce-cheap-provider-cost-policy/prd.md:42-43`) |

**Rollback triggers** must be stated per child before it ships, and must be
detectable from bounded acknowledgment evidence alone — never from inspecting
review content. A trigger that requires reading a diff is not a valid trigger
under the retention constraints.

**The catalog is the fast lever.** Because policy lives in the pinned private
catalog rather than in repository source or the manifest
(`src/review-candidate-catalog.js:348-352`), most rollbacks are a catalog
revision plus a digest change, not a code release and not a consumer re-install.
Only the acknowledgment extension (P0) and the preflight call site require an
Action release. This is the main practical payoff of the opacity tradeoff in §5.

---

## 8. What would falsify this design

- If probing fleet consumers shows `config/routed-review-setup-v1.json` is now
  deployed somewhere, the distribution-first argument in §5 weakens. The park
  itself is already lifted (`task.json:30` has `blockedOn: null`; the notes at
  `:28` record the 2026-08-20 owner unpark), so this falsifies the argument, not
  a gate. Last probed 2026-08-17 — all four consumers `repo:200 config:404`
  (`07-25-bound-cheap-review-token-usage/task.json`). **Not re-probed in this
  pass**; it needs network access to the consumer repos.
- If the pinned PR-Agent image `sha256:cae31b5…`
  (`examples/pr-agent-router.yml:137`) turns out to expose no setting that
  enforces an output cap, then P1's "cheapest slice" claim is wrong and the
  ordering in §7 should be revisited. This is
  `bound-cheap-review-token-usage/prd.md:22-23`'s open research item and is
  unanswered anywhere in the repo.
- If the owner confirms the two missing children were deliberately cancelled
  rather than lost, then `prd.md:70-71` and `prd.md:82-84` are stale and the
  parent's acceptance surface shrinks to three lanes — which would make G0 a
  documentation edit rather than task recreation.
