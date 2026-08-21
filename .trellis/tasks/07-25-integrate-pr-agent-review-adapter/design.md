# PR-Agent Review Adapter Design

> Verified against HEAD `40df292` on 2026-08-20. Delivered scope is marked
> `DELIVERED` with evidence rather than removed. Full findings:
> `research/2026-08-20-research.md`.

## Boundary

This child owns preflight and one external reviewer invocation for one immutable
candidate plan. It receives a safe compiled policy and exact profile identity;
dispatch additionally requires matching durable authorization and the one
scoped reviewer credential. It does not receive chain successors or management
credentials.

**Reachability precondition (new, blocking).** 9,390 of 13,136 lines under
`src/` are unreachable from the Action entrypoint `src/index.js:1-17` — the
whole v2 governance set (`protocol-v2.js`, `review-plan-authorization.js`,
`review-candidate-catalog.js`, `routed-review-compiler.js`,
`review-budget-ledger.js`, `review-usage-reconciliation.js`,
`review-deferred-recovery.js`, `retention-policy.js`). An adapter built against
those modules is unreachable too. Before implementation, either wire a v2 entry
path from `src/index.js`, or state explicitly that this task produces library
code only. This decision is not yet made.

**Deployment surface (new).** The cheap lane is entered through the
installer-managed manifest, now schema 4, with `REVIEW_ROUTE_MODE` under
installer management (`scripts/consumer-installer/codecs.mjs:159-171`,
`ROUTE_MODES` at `:122`). The durable template the installer deploys is
`examples/sd-review.yml` → `.github/workflows/sd-review.yml`
(`scripts/consumer-installer/codecs.mjs:16-17`). Any change to how the lane is
entered goes through the installer, not hand-edited YAML.

## Credential and receipt isolation — DELIVERED

Audit finding A-004 is satisfied. The durable template splits three jobs:
workflow-level permissions are `contents: read` only
(`examples/sd-review.yml:37-39`); `review` and `finalize` hold `checks: write`
(`:43-47`, `:161-169`); the `pr-agent` reviewer job holds only
`contents: read` + `pull-requests: write`, with no `checks` and no `issues`
(`:69-77`). Route and finalization exchange only the bounded acknowledgment
(`:171-186`). Asserted at `test/metadata.test.js:245-267`, including explicit
`checks === undefined` / `issues === undefined` on the reviewer job.

The single provider secret is fanned to exactly one provider env var by a
per-provider conditional (`examples/sd-review.yml:121-133`) and passed as a
bare `--env NAME` so it never reaches the command line (`:140-156`). No volume
mounts; asserted at `test/metadata.test.js:272-283`.

*Residual gap:* `test/metadata.test.js:170-174` asserts these properties against
`pr-agent-on-demand-review-router.yml`, never against `sd-review.yml` — the
template the installer actually deploys. The two are currently near-identical,
so this is coverage, not a live defect, but it should be closed.

## Prompt-Profile Resolution

The adapter registry owns actual prompt templates and PR-Agent configuration
values keyed by alias/version/digest. Before request preparation, the adapter
resolves that identity, canonicalizes the private values, verifies their digest
against the plan, and applies the profile. That applied digest becomes part of
the prepared-request fingerprint and acknowledgment.

**Split of delivered vs remaining.** The *identity* half is delivered; the
*value* half is not, and only the value half is this task's work.

- DELIVERED — profile binding as a discriminated union (`referenced` vs
  `handler-managed`), with `default`, `inheritance`, `fallback`,
  `commandOverride`, `runtimeOverride` rejected rather than stripped:
  `src/protocol-v2.js:494-519`.
- DELIVERED — immutable identity registry carrying alias/version/digest plus
  `compatibleHandlers` and `capabilities`:
  `decodePromptProfileRegistry`, `src/review-candidate-catalog.js:633-676`.
  Exact-digest and handler-compatibility resolution: `resolveProfileBinding`,
  `src/review-candidate-catalog.js:695` (called at `:742`).
- DELIVERED — substitution rejection on the bound candidate, and
  preflight-digest ↔ bound-profile-digest agreement:
  `src/review-plan-authorization.js:449-462`. Standalone direct-handler
  fixed-profile enforcement — the bound profile must equal the
  setup-discovered one — `src/routed-review-compiler.js:333-335`, inside
  `compileStandalone` (`:306-340`). *Corrected 2026-08-20 (adversarial review,
  C-9): this bullet previously cited `:692+` for `resolveProfileBinding` and
  labelled the compiler range "compiled-lane", which reads as the managed lane;
  the enforcement cited is the standalone one.*
- REMAINING — the private, adapter-owned store of actual template and PR-Agent
  configuration values keyed by that same identity. The registry module's own
  comment defers it explicitly
  (`src/review-candidate-catalog.js:629-631`). It exists nowhere in the repo,
  and where it should live is undecided (repo file, reviewer-job step, or
  private package).

There is no lane default, inheritance, merging, fallback, or caller-supplied
profile override. A missing entry, digest mismatch, handler incompatibility, or
attempted substitution fails before reviewer invocation. Multiple candidates
may resolve the same immutable entry without duplicating profile values.

## Single-target invocation — DELIVERED (bluntly)

PR-Agent/LiteLLM runs with internal cross-model fallback disabled:
`CONFIG__FALLBACK_MODELS: '[]'` and `CONFIG__RESTRICTED_MODE: "true"`
(`examples/sd-review.yml:135-136`, `examples/pr-agent-router.yml:115-116`),
asserted at `test/metadata.test.js:293-295`. The container is pinned by digest
(`examples/sd-review.yml:157`).

**Not delivered, and not wanted.** A provider router restricted to
policy-compliant same-model endpoints has no concept, no implementation, and no
fixture in the repo. *Corrected 2026-08-20 (adversarial review, C-7):* this
paragraph previously said "reconsider whether this clause is still wanted". It
is not — `07-25-enforce-same-model-provider-failover` was dropped as rejected on
2026-08-08 (`.trellis/tasks/archive/2026-08/08-08-backlog-consolidation/prd.md:82`,
`:96-99`), along with the whole "provider failover governance" cluster that
`prd.md:61-62` depends on. Strike the clause from AC-1 rather than treating it as
a fixture-writing obligation; see `implement.md` Step 0c.

## Acknowledgment binding

The acknowledgment binds configured and actual target, provider evidence, usage
reference, and dispatch certainty to the child authorization.

**Current state is far below this.** The durable path uses the v1 adapter
contract only (`src/operations.js:2-8`; `decodeAdapterRequest` at
`src/protocol.js:661-726`, `decodeAdapterAcknowledgment` at
`src/protocol.js:728`). The acknowledgment carries a coarse job status —
`ADAPTER_OUTCOMES = success|failure|cancelled|skipped`
(`src/operations.js:21`), supplied as `${{ needs.pr-agent.result }}`
(`examples/sd-review.yml:178`). PR-Agent's stdout is never captured or parsed,
so no actual model, usage, cost, or finish reason reaches the receipt. Closing
this is the highest user-visible value in the task.

## Preflight

A side-effect-free preflight prepares the complete request and binds its
fingerprint, applied prompt-profile digest, token count/bound, output cap,
price/unit evidence, maximum expected charge, and hard request limit to
authorization. Dispatch reuses the same prepared-request fingerprint. Preflight
uses no reviewer credential or provider invocation.

DELIVERED — the preflight *contract* already encodes almost exactly this field
set, including the `maxExpectedCharge <= hardRequestLimit` invariant:
`decodeCandidatePreflight`, `src/protocol-v2.js:669-726`. Plan authorization
consumes it and classifies eligibility at
`src/review-plan-authorization.js:455-488`.

REMAINING — the *producer*. Nothing in the repo counts input tokens, knows unit
prices, or renders a prepared request; `decodeConsideredCandidate` takes
`entry.candidatePreflight` as caller-supplied input
(`src/review-plan-authorization.js:455`). The remaining work is producing this
object, not designing its shape.

## Output cap and incompleteness

A length/token-limit finish reason produces `incomplete_token_limit`; usage is
reconciled, partial output is not published, and no replacement candidate is
invoked.

REMAINING. The reason code exists (`src/protocol-v2.js:136`) but is
unreachable from the shipped path. No `CONFIG__` env in either template sets an
output or token cap — the reviewer step sets only model, fallback list,
restricted mode, and PR number (`examples/sd-review.yml:134-137`). So the
authorized output cap is not applied today and the incomplete outcome can never
be emitted.

## Rollback

Disable the candidate/handler or restore the prior workflow. Rollback never
populates the internal fallback list, selects a default profile, or weakens
model/profile-provenance validation.
