---
title: Ingest and authorize local review attestations
status: planning
created: 2026-07-25
---
# Ingest and authorize local review attestations

## Goal

Accept authorized local-review evidence idempotently, validate trust and exact-head identity, and prohibit reviewer dispatch.

## Requirements

- Add an explicit ingestion operation used only by the trusted consumer
  workflow for a compiled local-attested route.
- Derive repository, workflow/run, and authenticated actor context from GitHub;
  reject equivalent caller-provided authority fields.
- Resolve actor association and PR-author identity, apply the exact compiled
  trust policy, and record a bounded authorization decision.
- Re-read the live PR head before receipt creation and before returning an
  accepted result. Wrong or changed heads fail closed.
- Persist one immutable attempt receipt before any Check projection. Matching
  retries are idempotent; conflicting fingerprints require reconciliation and
  cannot overwrite evidence.
- Guarantee zero reviewer side effects: no Copilot request, adapter request,
  PR-Agent/container execution, provider call, review, or comment.
- Reject expired, future-dated, malformed, oversized, unsupported, or privacy-
  violating evidence without echoing rejected content.

## Acceptance Criteria

- [ ] Authorized clean, findings, and error fixtures (the shipped three-valued
      `LOCAL_REVIEW_RESULTS`, in which a cancelled run reports `error`) each
      create one immutable bounded receipt with the expected outcome class.
- [ ] Unauthorized association/actor, disallowed PR author, expired evidence,
      wrong head, changed head, and malformed input fail before acceptance.
- [ ] Matching retries reuse the receipt; conflicting evidence cannot mutate it
      or authorize any other path.
- [ ] Mutation spies prove no reviewer, provider, review, or comment side
      effect occurs for any local-attested case.
- [ ] Outputs and errors preserve privacy bounds and derived-authority rules.

## Dependencies

- `07-25-define-local-review-attestation-contracts`.

## Out of Scope

- Stable Check rendering and command-pack-local review execution.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-ingest-local-review-attestations`:

- research/2026-08-20-research.md
