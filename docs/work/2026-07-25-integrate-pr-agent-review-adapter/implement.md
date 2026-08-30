# PR-Agent Review Adapter Implementation Plan

> Verified against HEAD `40df292` on 2026-08-20 and reordered. Original steps
> are preserved with their delivery status. Full findings:
> `research/2026-08-20-research.md`.

## Step 0 — Decide before writing adapter code (blocking)

0a. **Reachability.** 9,390 of 13,136 `src/` lines are unreachable from
`src/index.js:1-17`. Either wire a v2 entry path from the entrypoint, or record
explicitly that this task produces library code only. Building more unreachable
code is the failure mode the original park existed to prevent.

0b. **Where the private profile-value store lives.** Repo file consumed at
build time, a step inside the reviewer job, or a separate private package. The
PRD says "private" (argues against a repo file) but the Action must verify the
digest (argues against a runtime-only secret). Undecided; blocks steps 2 and 4.

0c. **Same-model endpoint failover — already decided, not open.** *Corrected
2026-08-20 (adversarial review, C-7).* This was written as an open question. The
owner settled it on 2026-08-08: `07-25-enforce-same-model-provider-failover` was
**dropped as rejected** — `.trellis/tasks/archive/2026-08/08-08-backlog-consolidation/prd.md:82`,
cluster "provider failover governance" — with the rationale that "provider
failover governance across a single OpenRouter key" is a coordination problem
"this deployment does not have" (`:96-99`). The same drop took
`07-25-qualify-cheap-review-candidates`, `07-25-govern-cheap-review-fallbacks`,
`07-25-control-cheap-review-reasoning-effort`, and
`07-25-evaluate-cheap-provider-failover-pilot` — which together *are* the
"qualified cheap/deep candidate policy tasks" this task's `prd.md:61-62` names as
a dependency. So the failover clause has no implementation, no fixture, no
consumer, **and no chartered owner**, while `CONFIG__FALLBACK_MODELS: '[]'`
(`examples/sd-review.yml:135`) already provides the safety property.

Consequence: AC-1's "supported same-model endpoint failover" clause and the
Dependencies line naming the candidate-policy tasks should be struck from
`prd.md` before implementation. Both edits are owner scope, so they are recorded
here rather than applied. Until they are made, AC-1 cannot be satisfied by
anything this task could reasonably build.

0d. **Re-probe fleet consumers** for `config/routed-review-setup-v1.json`. The
2026-08-15 check found all four probed repos 404. The unpark was an owner
directive, not a premise falsification.

## Step 1 — Close the independent coverage gap first

`test/metadata.test.js:170-174` loads `pr-agent-on-demand-review-router.yml` as
the durable template, never `examples/sd-review.yml` — which is what the
installer actually deploys
(`scripts/consumer-installer/codecs.mjs:16-17`). Add `sd-review.yml` to that
list so the A-004 permission assertions
(`test/metadata.test.js:245-267`) cover the shipped template. Few lines, no
dependency on any Step 0 decision. Do this regardless of what else happens.

## Step 2 — Fixtures

*Partly DELIVERED.* Already present and exercised:
`fixtures/protocol/v2/prompt-profile-registry.{valid,invalid}.json`,
`candidate-safe-projection.*`, `candidate-options.*`,
`review-candidate-catalog.*`, `routed-review-handler-profiles.valid.json`,
`source-contracts.*` — driven by
`test/review-candidate-catalog.test.js:30-31,125-133` and
`test/routed-review-compiler.test.js:19-28`.

*Remaining:* producer-side preflight, token-boundary, and secret-boundary
fixtures. Note the *decoder*-side preflight fixtures already exist and are
exercised —
`fixtures/protocol/v2/candidate-preflight.{valid,invalid}.json`, loaded at
`test/protocol-v2.test.js:48-49` (corrected 2026-08-20, adversarial review C-8;
this line previously listed "request-preflight fixtures" flatly as missing).
What has no fixture is a *produced* preflight: a rendered request with counted
tokens and price evidence, which is Step 4's output. Single-target and
policy-forwarding fixtures already exist as workflow assertions
(`test/metadata.test.js:268-296`).

## Step 3 — Private profile resolution and digest verification

*Identity half DELIVERED* — `decodePromptProfileRegistry`
(`src/review-candidate-catalog.js:633-676`), `resolveProfileBinding`
(`src/review-candidate-catalog.js:695`), binding union
(`src/protocol-v2.js:494-519`), substitution rejection
(`src/review-plan-authorization.js:449-462`).

*Remaining:* the adapter-owned store of actual template and PR-Agent
configuration values keyed by the same alias/version/digest, plus
canonicalization and digest verification of those values against the plan.
Depends on Step 0b. The registry module defers this explicitly at
`src/review-candidate-catalog.js:629-631`.

## Step 4 — Preflight producer

*Contract DELIVERED* — `decodeCandidatePreflight`
(`src/protocol-v2.js:669-726`) already encodes counted input, `inputCounted`,
`outputCap`, `maxExpectedCharge`, `hardRequestLimit`, `safetyMargin`,
`capabilityEvidence`, and the `maxExpectedCharge <= hardRequestLimit`
invariant.

*Remaining:* the producer. Render the complete request without invoking the
reviewer, count input tokens, attach price/unit evidence, compute the
conservative maximum charge, and emit the prepared-request fingerprint. Today
`decodeConsideredCandidate` receives this object from its caller
(`src/review-plan-authorization.js:455`) and nothing constructs it.

## Step 5 — Gate invocation on authorization and fingerprint

Plan-side verification is DELIVERED
(`src/review-plan-authorization.js:440-488`, control-plane response check at
`:901-957`). Remaining work is the adapter side reusing the same
prepared-request fingerprint at dispatch. Depends on Step 4.

## Step 6 — Apply policy, output cap, and empty fallback

*Fallback DELIVERED* — `CONFIG__FALLBACK_MODELS: '[]'` +
`CONFIG__RESTRICTED_MODE: "true"` (`examples/sd-review.yml:135-136`), asserted
`test/metadata.test.js:293-295`; container pinned by digest at
`examples/sd-review.yml:157`.

*Remaining:* the authorized output cap. No `CONFIG__` env sets an output or
token cap today — the reviewer step passes only model, fallback list,
restricted mode, and PR number (`examples/sd-review.yml:134-137`). Needs a
PR-Agent/LiteLLM setting that actually enforces it.

## Step 7 — Capture reviewer output and emit a structured acknowledgment

Highest user-visible value; least dependent on the v2 machinery. Today the
acknowledgment is a coarse job status —
`ADAPTER_OUTCOMES = success|failure|cancelled|skipped`
(`src/operations.js:21-25`) fed by `${{ needs.pr-agent.result }}`
(`examples/sd-review.yml:178`) through the v1 contract
(`src/protocol.js:661-726`). PR-Agent's stdout is never captured.

Investigate the capture mechanism (stdout parsing, a PR-Agent output flag, or a
LiteLLM callback), then carry actual model, provider, finish reason, and
usage/cost reference into the acknowledgment. Emit `incomplete_token_limit`
(`src/protocol-v2.js:136`) on a length/token-limit finish, publish no partial
output, and invoke no replacement candidate.

## Step 8 — Replay, duplicate-publication, logging, rollback docs

Unchanged from the original plan.

## Suggested split

The PRD bundles four separable deliverables. Steps 1, 6 (output cap), and 7 are
useful today and independent of the reachability decision. Steps 3, 4, and 5
are only useful once Step 0a resolves. Consider shipping the former first.

## Validation

Validate exact target/profile execution, shared and candidate-specific profile
resolution, missing/mismatched/substituted profile rejection, compliant
endpoint failover (if retained per Step 0c), cross-model rejection, token/cost
preflight, output-limit incompleteness, timeout/ambiguity, usage unknowns, and
credential isolation.

Named check for the cheapest slice (Step 1): after adding `sd-review.yml` to
`test/metadata.test.js:170-174`, `node --test test/metadata.test.js` passes
with the A-004 permission assertions now executing against two durable
templates instead of one; any failure means `sd-review.yml` has drifted from
its twin.
