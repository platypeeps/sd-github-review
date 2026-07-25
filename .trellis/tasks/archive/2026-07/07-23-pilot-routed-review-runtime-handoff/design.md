# Routed-Review Runtime Pilot And Handoff Design

## Overview

Treat the private pilot and upstream handoff as evidence collection over the
immutable released Action. The only source change in scope is closing the
published-workflow input gap that otherwise prevents consumers from exercising
the runtime's existing rerequest and independent-review-floor contracts.

## Proposal

- Reuse the isolated pilot repository and no-checkout workflow boundary from
  `docs/RELEASE_CHECKLIST.md`. Pin every pilot dispatch to Action commit
  `8636a3983d18de17c49907a4c48170a61b1bb713`.
- Add `rerequest-authorized` and `independent-review-floor` dispatch inputs to
  both `examples/on-demand-review-router.yml` and
  `examples/pr-agent-on-demand-review-router.yml`, then pass them unchanged to
  the Action. Keep the two examples symmetric and cover the mapping in
  metadata tests.
- Use the existing private OpenRouter/Kimi K2.6 credential only on the pinned
  PR-Agent container step. Do not check out or mount pull-request code.
- Create a scenario matrix whose evidence records PR/head, logical identity,
  correlation, receipt Check Run URL, dispatch phase/status, finding channel,
  and sanitized outcome.
- Split the matrix by cost and trust boundary: use provider-free synthetic
  acknowledgments for protocol/state transitions, one credentialed PR-Agent
  path for external dispatch/finding proof, and native Copilot evidence for the
  GitHub-owned reviewer path. Setup discovery is proven by descriptor fixtures
  and tests without a provider call.
- Run successor scenarios from a reviewed head to bookkeeping-only and mixed
  heads, verifying a fresh identity/receipt each time.
- Store sanitized conclusions in this task's research and update live release
  guidance only after evidence is complete.
- Prepare a paste-ready command-pack handoff; create an upstream PR only after
  explicit approval for that specific PR.

## Boundaries And Non-Goals

- No production repository, production credential, or PR-authored checkout.
- No raw reviewer findings, prompts, source paths, provider transcripts,
  secret values, or private workflow payloads in this public repository.
- External adapter conformance remains owned by its archived task; this task
  only proves integration with the durable runtime.
- No new routing, receipt, or adapter runtime behavior and no command-pack
  consumer implementation.

## Affected Files

- pilot evidence under this task's `research/`
- `examples/on-demand-review-router.yml`
- `examples/pr-agent-on-demand-review-router.yml`
- `test/metadata.test.js`
- `SETUP-PR-AGENT.md`
- `docs/RELEASE_CHECKLIST.md` and examples only when evidence changes their
  current operating contract
- no version or release mutation; the handoff names existing immutable
  identities

## Data And Command Contracts

The public evidence record uses stable scenario IDs and sanitized fields only:
Action/source SHA, private PR number and head SHA, route, backend ID/tier,
receipt/logical IDs, phase, finding-channel type, run or Check Run URL,
pass/fail, limitation, and rollback state. It never stores request JSON,
reviewer output, file names, prompts, source, logs, or secret/config values.

`rerequest-authorized` is a boolean workflow-dispatch input with default
`false`. `independent-review-floor` is a choice input with
`none|cheap|deep|copilot` and default `none`. Both are passed to the initial
route/query Action call; finalization continues to bind to the canonical
request and acknowledgment.

## Risks And Edge Cases

- Private evidence can leak through copied payloads; manually bound every
  public field and never paste raw event or reviewer content.
- External service latency may be transient; bounded reruns must use the same
  receipt identity and prove reconciliation, not issue a fallback request.
- A provider-backed rerequest can spend twice or post twice if identity is
  wrong; prove replay deduplication first, then run exactly one authorized
  attempt-2 dispatch and compare receipt identities.
- A workflow input/example mismatch can create false pilot coverage; metadata
  tests parse both examples and assert identical control defaults and Action
  mappings.
- Upstream consumer state can block handoff without invalidating completed
  router pilot evidence.

## Validation

- source exact-head CI and repository full checks;
- focused metadata tests prove both workflow controls and symmetry;
- every live scenario has one sanitized evidence row and durable receipt URL;
- replay/conflict scenarios prove the count of reviewer mutations is unchanged;
- direct review-thread polling proves no unresolved pilot source feedback;
- rollback/disable procedure is exercised or concretely documented.
