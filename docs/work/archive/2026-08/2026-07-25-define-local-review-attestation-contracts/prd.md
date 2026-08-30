---
title: Define local review attestation contracts
status: done
created: 2026-07-25
branch: feat/define-local-review-attestation-contracts
---
# Define local review attestation contracts

## Goal

Define bounded exact-head local-review attestation, trust-policy, receipt, and outcome contracts.

## Requirements

- Extend standalone v2 source and compiled schemas with a strict per-route
  `direct-handler|local-attested` execution union.
- Define explicit local-attestation trust policy fields for allowed GitHub
  actors/associations, PR-author permission, and maximum evidence age. Define no
  implicit trust default.
- Define bounded attestation request, authorization result, immutable receipt,
  setup-discovery, status, and exact-head Check-projection schemas.
- Bind every contract to repository, PR, full head, lane, attempt,
  configuration digest, local receipt/content digest, evidence digest, and
  authenticated publication context.
- Add `completed_local`, `completed_local_findings`,
  `awaiting_local_attestation`, and bounded local failure outcomes without
  weakening existing review/assurance/gate separation.
- Represent trust as `repository_attested`; forbid `independent` unless a
  future independent issuer contract proves it.
- Allow optional bounded usage/cost fields only with
  `source=self_reported_local`; forbid their use in managed authorization.
- Recursively reject source, paths, patches, prompts, findings, transcripts,
  secrets, configuration values, and local artifact references.

## Acceptance Criteria

- [x] Canonical valid/invalid fixtures cover direct-only, all-local, and mixed
      standalone routes plus every forbidden mixed union.
- [x] Trust-policy fixtures reject missing actor policy, implicit PR-author
      permission, unsupported associations, and invalid/zero expiry.
- [x] Outcome fixtures prove only authorized exact-head `clean` evidence can
      satisfy assurance and pass the gate.
- [x] Privacy fixtures recursively reject forbidden fields and oversized
      values without echoing them.
- [x] Usage fixtures cannot be mistaken for authoritative budget or billing
      evidence.
- [x] Historical v1 local summaries remain read-only routing hints and cannot
      be decoded as v2 local attestations.

## Dependencies

- `07-25-define-budget-review-v2-contracts`.
- Parent local-attested design.

## Out of Scope

- GitHub transport, actor lookup, Check mutation, or command-pack publication.
