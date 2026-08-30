---
title: Implement routed-review protocol core
status: done
created: 2026-07-23
branch: codex/implement-routed-review-protocol-core
---
# Implement routed-review protocol core

## Goal

Implement the dependency-free v1 request/receipt protocol and pure policy layer
that every later durable-storage and dispatch path must consume.

## Requirements

- Define canonical request, local-summary, successor-evidence, backend, and
  receipt shapes with schema major `1`, bounded strings/collections, and full
  owner/repository/PR/head identity.
- Validate exact scalar/container types and reject unknown major versions,
  malformed identity, invalid route/attempt values, forbidden privacy fields,
  oversized summaries, and nonzero-confidence skipped outcomes.
- Derive logical dispatch identity from canonical repository/PR/head/attempt
  and derive a normalized request fingerprint from all dispatch-relevant
  validated fields except correlation aliases.
- Reject caller compatibility identity/fingerprint values that differ from the
  derived values; correlations remain trace aliases only.
- Extend pure automatic selection for bounded local evidence, independent
  review floors, and normalized trusted successor evidence without weakening
  explicit route precedence or existing standalone routing.
- Keep source, paths, prompts, findings, transcripts, credentials,
  configuration values, and local artifact contents out of accepted data.
- Publish canonical valid/invalid JSON fixtures for every protocol state owned
  here; do not add GitHub mutations or Action inputs in this task.

## Acceptance Criteria

- [x] Valid fixtures cover `auto`, every explicit route, Copilot, external
  comment/check backends, `none`, and bounded cost/latency observations.
- [x] Same request/head yields one identity and fingerprint; new head, attempt,
  or dispatch-relevant intent changes the correct derived value.
- [x] A new correlation alias does not change the fingerprint or identity;
  spoofed compatibility values fail before any future dispatch.
- [x] Local clean/fully-dispositioned evidence can reduce `auto` only within
  policy, while unavailable/failed/cancelled/skipped/stale/dirty/malformed or
  low-confidence evidence supplies no positive confidence.
- [x] Sensitive/large-change or configured independent-review floors cannot be
  bypassed by local evidence or bookkeeping-successor input.
- [x] Successor fixtures distinguish trusted bookkeeping-only, mixed,
  non-comparable, changed-head, explicit-remote, and required-floor cases.
- [x] Privacy fixtures reject every forbidden field and enforce size limits.
- [x] Existing router and full repository tests remain green.

## Dependencies

First child; no runtime-task dependency. The archived contract under
`.trellis/tasks/archive/2026-07/07-22-publish-routed-review-receipt-contract/`
is authoritative.

## Out Of Scope

- GitHub Check Run storage/query, live head/compare API calls, reviewer
  mutation, Action operation inputs, adapter acknowledgment, workflows, or
  private pilot execution.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-07/07-23-implement-routed-review-protocol-core`:

- research/contract-mapping.md
