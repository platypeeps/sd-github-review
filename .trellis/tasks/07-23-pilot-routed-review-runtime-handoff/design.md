# Routed-Review Runtime Pilot And Handoff Design

## Overview

Treat the private pilot and upstream handoff as evidence collection over an
immutable source candidate. No runtime feature implementation belongs here.

## Proposal

- Reuse the isolated pilot repository and no-checkout workflow boundary from
  `docs/RELEASE_CHECKLIST.md`.
- Pin the router Action to a full green commit SHA and use test-only provider
  credentials owned by the pilot adapter step.
- Create a scenario matrix whose evidence records PR/head, logical identity,
  correlation, receipt Check Run URL, dispatch phase/status, finding channel,
  and sanitized outcome.
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
- External adapter validation remains owned by its existing task.

## Affected Files

- pilot evidence under this task's `research/`
- `docs/RELEASE_CHECKLIST.md` and examples only when evidence changes their
  current operating contract
- optional version/release metadata after explicit approval

## Data And Command Contracts

The public evidence record uses stable scenario IDs and sanitized fields only:
candidate SHA, PR/head, route, backend ID/tier, receipt/logical IDs, phase,
finding-channel type, run URL, pass/fail, limitation, and rollback state.

## Risks And Edge Cases

- Private evidence can leak through copied payloads; manually bound every
  public field and never paste raw event or reviewer content.
- External service latency may be transient; bounded reruns must use the same
  receipt identity and prove reconciliation, not issue a fallback request.
- Upstream consumer state can block handoff without invalidating completed
  router pilot evidence.

## Validation

- source exact-head CI and repository full checks;
- every scenario has one sanitized evidence row and durable receipt URL;
- direct review-thread polling proves no unresolved pilot source feedback;
- rollback/disable procedure is exercised or concretely documented.
