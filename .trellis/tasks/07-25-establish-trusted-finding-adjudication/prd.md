# Establish Trusted Finding Adjudication

## Goal

Create a trusted, privacy-bounded adjudication path for reviewer findings so
recurring-learning and reviewer-effectiveness tools can distinguish valid,
invalid, duplicate, superseded, resolved, and unresolved evidence without
letting a reviewer grade itself.

## Background

The current review lifecycle records operational states such as fixed,
rebutted, resolved, and outstanding. Those states are sufficient to continue a
review, but they are not actor-attested correctness evidence. Parallel-review
reporting intentionally preserves finding references without adjudicating
them, while future learning and effectiveness analysis requires trustworthy
dispositions.

## Ownership

- Repository maintainers own correctness decisions. Automation may propose a
  disposition but cannot confer trusted status.
- `sd-github-review` owns stable finding identity, adjudication schemas,
  authorization validation, workflow/receipt correlation, and bounded export.
- The consumer private control plane owns append-only storage, tenant access,
  retention, correction history, and query authorization through sibling task
  `07-25-define-finding-adjudication-evidence-store`.
- `sd-ai-command-pack` owns operator UX through external task
  `07-25-add-sd-review-finding-adjudication-operations`.
- `sd-review-learnings` and `sd-review-effectiveness` are read-only
  consumers; neither writes or upgrades adjudication trust.

## Requirements

- R1: Separate correctness, relationship, resolution, and trust into
  orthogonal fields; do not overload one disposition enum.
- R2: Bind every event to repository, PR, finding head, optional resolution
  head, parent plan/attempt, reviewer child, candidate/configuration identity,
  and stable finding fingerprint.
- R3: Support `operational`, `maintainer_attested`, and `independent`
  trust levels. Bots and finding publishers cannot confer human trust.
- R4: Default trusted actors to authenticated non-bot users with repository
  write/maintain authority. Permit repository policy to require a matching
  CODEOWNER or second maintainer for rejection of high-risk findings.
- R5: Store adjudication as append-only events with explicit supersession.
  Conflicting live attestations become disputed/unresolved, never silent
  last-write-wins.
- R6: Keep raw prompts, diffs, unrestricted finding text, credentials, and
  provider transcripts out of receipts and shared storage.
- R7: Make missing adjudication non-blocking for merge in v1. Existing
  actionable finding gates remain authoritative; missing trust reduces
  analysis coverage and produces `insufficient-evidence`.
- R8: Allow proposed and provisional automation, but require explicit human
  attestation before evidence can influence reviewer/model recommendations.
- R9: Publish bounded status and evidence contracts usable by generic,
  variable-length cheap/deep reviewer plans.

## Child Deliverables

- `07-25-define-finding-adjudication-contract` owns stable finding identity,
  schemas, and conformance fixtures.
- `07-25-implement-trusted-finding-adjudication-workflow` owns authenticated
  maintainer attestation and idempotent event submission.
- `07-25-publish-finding-adjudication-evidence` owns bounded read-only status
  and analysis projections.

## Acceptance Criteria

- [ ] All three local children and the private-store contract child have
      testable ownership and dependency boundaries.
- [ ] Same-head and resolution-head fixtures prove stable finding identity and
      actor-attested append-only events.
- [ ] Correctness, relationship, resolution, and trust can vary independently.
- [ ] Authorization tests reject bots, finding publishers, insufficient
      permission, stale identity, cross-repository replay, and missing
      high-risk approval.
- [ ] Conflicting and corrected attestations retain full history and expose one
      deterministic disputed or superseded view.
- [ ] Bounded exports support learning and effectiveness without raw findings,
      source, prompts, credentials, or private ledger data.
- [ ] Missing or insufficient adjudication never becomes an implicit positive
      or negative quality label.

## Dependencies

- Stable parent/child finding provenance from
  `07-25-report-parallel-review-evidence`.
- The control-plane store contract
  `07-25-define-finding-adjudication-evidence-store`.

## Out of Scope

- AI-only correctness decisions.
- Automatic reviewer/model or routing changes.
- Replacing existing operational finding remediation and merge gates.
