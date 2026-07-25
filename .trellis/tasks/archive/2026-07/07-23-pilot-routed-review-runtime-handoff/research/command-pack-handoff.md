# Command-Pack Routed-Review Handoff

No upstream pull request is authorized. The following is a paste-ready handoff
for a separately approved command-pack task or PR.

## Immutable Inputs

- Action release: `v0.1.0`
- Action commit: `8636a3983d18de17c49907a4c48170a61b1bb713`
- Setup descriptor: `config/routed-review-setup-v1.json`
- Setup schema: `sd-github-review/setup@1`
- Review, adapter, acknowledgment, and receipt contract major: `1`
- Generic workflow: `examples/on-demand-review-router.yml`
- PR-Agent workflow: `examples/pr-agent-on-demand-review-router.yml`

## Consumer Contract

1. Discover setup read-only and classify only the descriptor's documented
   `ready`, `absent`, `invalid`, `incompatible`, or `unavailable` states.
2. Construct one canonical exact-head v1 request. Do not invent logical or
   fingerprint identities outside the router.
3. Invoke `route` with the consumer-owned backend descriptors. Honor
   `dispatch-allowed`; never dispatch a fallback after an ambiguous result.
4. For an external adapter, return one canonical acknowledgment and invoke
   `finalize`. For Copilot or `none`, consume the same durable receipt shape.
5. Treat exact replay and correlation aliases as reconciliation. A same-head
   attempt greater than one requires the prior receipt/logical identity,
   unchanged policy/route/backend, `supportsRerequest: true`, and explicit
   `rerequest-authorized` policy authority.
6. Pass `independent-review-floor` from trusted repository policy. Never let
   local or bookkeeping evidence lower the automatic route below that floor.
7. Do not check out or execute pull-request-controlled code in any job that can
   access provider credentials.

## Validation Evidence

The source test suite, setup taxonomy, provider-free pilot, live Copilot
deduplication, and credentialed PR-Agent attempt/replay/rerequest/new-head
matrix are recorded in
[`pilot-evidence-2026-07-24.md`](pilot-evidence-2026-07-24.md). The upstream
consumer should pin the full Action commit above, validate the descriptor and
workflow agreement, and record its own exact-head consumer smoke evidence.
