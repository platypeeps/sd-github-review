# Cheap Provider Cost Policy Implementation Plan

> Revised 2026-08-20 against the tree at `40df292`. Step 1 of the original
> 2026-07-25 plan was correctly sequenced first and has now been run as desk
> research: the pinned runtime does **not** forward OpenRouter provider
> preferences (`research/2026-08-20-research.md` §3). Steps 2-5 are therefore
> gated on a scoping decision that did not exist when they were written.

## Step 0 — gate (blocking)

Resolve how, or whether, provider policy reaches OpenRouter. PR-Agent v0.39.0's
`LITELLM__EXTRA_BODY` allowlist is `{"processing_mode", "service_tier"}` and
rejects OpenRouter's `provider` object outright; the allowlist is unchanged on
upstream `main`. Options, with the recommendation in
`research/2026-08-20-research.md` Recommendations §2:

- OpenRouter **account-level** configuration — enforces `zdr`,
  `data_collection`, `only`, `ignore`; does **not** cover `max_price`.
- An `api_base` shim injecting the `provider` object — adds a hop that reads
  every request body, in tension with the retention policy this task enforces.
- A rebuilt PR-Agent image, or an upstream allowlist contribution.

If the account-level option is chosen, this task delivers the data policy and
not the price ceiling, and must be retitled and rescoped before proceeding.
Steps 1-5 below assume an in-band path was chosen.

## Steps

1. Exercise the chosen forwarding path end to end against one real
   representative endpoint before writing any schema, proving that a rejected
   constraint fails the run rather than silently dropping.
2. Add candidate-catalog schema and compiler validation for the constraints
   that have a runtime primitive: price ceiling (`max_price`), zero data
   retention (`zdr`), and parameter support (`require_parameters`). Treat
   `data_collection` as the soft preference it is — never as fail-closed.
   Region is deferred: OpenRouter has no region primitive and the only
   approximation is provider-slug pinning. `prd.md:56-57` excludes only
   "hard-coding one commercial provider endpoint without an approved data or
   reliability requirement", so a multi-slug `only` allowlist backed by an
   approved requirement is arguably still in scope — the PRD must say which.
3. Widen `decodeCandidateSafeProjection`
   (`src/review-candidate-catalog.js:862-963`) and the compiled per-lane
   candidate (`src/routed-review-compiler.js:410-420`) **together**. Policy
   currently stops at both boundaries; widening one strands it at the other.
4. Translate the compiled policy during adapter preflight and fail before
   dispatch when any mandatory constraint cannot be enforced. Prefer the
   existing `unenforceable` preflight reason
   (`src/review-plan-authorization.js:80-88`, `:499`) over minting a new
   outcome code — the shared enum is read by three sibling tasks.
5. Emit bounded policy-compliance and exhaustion evidence without credentials
   or raw provider-routing metadata. This depends on extending
   `buildAdapterAcknowledgment` (`src/operations.js:242-259`), which carries no
   policy, model, or usage field today — a prerequisite shared with the sibling
   token-usage child, not to be duplicated here.
6. Document catalog configuration, recovery, rollback to a pinned baseline
   policy, and same-model endpoint failover in `SETUP-PR-AGENT.md`, whose
   OpenRouter section (`:246-270`) currently covers only model IDs and the
   single-key credential mapping.

## Workflow plumbing

Any new setting must be added to **both** the `env:` block and the explicit
`--env` allowlist of the `docker run` invocation
(`examples/pr-agent-router.yml:114-137`) and mirrored in the durable lane
(`examples/pr-agent-on-demand-review-router.yml:111-154`). A variable added to
only one is silently dropped.

Consumer-side configuration, if any is needed, requires a manifest bump past
`MANIFEST_SCHEMA_VERSION = 4` with a version-scoped
`*_MIN_SCHEMA_VERSION` constant, never a gate on equality with the current
version (`scripts/consumer-installer/codecs.mjs:159-175` documents the rule).

## Validation

Validate compliant selection, price exhaustion, retention rejection,
unsupported parameters, ignored runtime controls, same-model failover, and
cross-model rejection.

Note the unresolved testability problem: `prd.md:34-35` asks for integration
tests proving constraints reach OpenRouter, which implies either live billed
calls or a recorded-fixture proxy. `test/` does neither today, and the
mechanism must be decided alongside Step 0.
