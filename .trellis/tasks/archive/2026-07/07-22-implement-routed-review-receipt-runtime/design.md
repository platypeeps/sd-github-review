# Routed-Review Runtime Delivery Decomposition Design

## Overview

The approved contract spans four different failure and review boundaries.
Keeping them in one PR would combine pure schema policy, GitHub persistence,
Action orchestration, and external pilot evidence. The task is therefore a
delivery-decomposition record, not a runtime implementation target.

## Proposal

| Order | Child | Ownership | Archived requirements |
| --- | --- | --- | --- |
| 1 | `implement-routed-review-protocol-core` | schemas, canonicalization, privacy, pure policy | R1-R5, R7-R8, R12-R15, R18-R21, pure R23 fixtures |
| 2 | `implement-durable-routed-review-receipts` | Check Run storage/query, exact-head idempotency, compare transport | R4-R7, R10-R11, R17-R20, transport R23 fixtures |
| 3 | `implement-on-demand-routed-review-dispatch` | Action operations, native/delegated dispatch, acknowledgment/finalizer, setup descriptor | R2, R5-R11, R16-R18, R21-R22 |
| 4 | `pilot-routed-review-runtime-handoff` | private end-to-end evidence and immutable consumer handoff | integration portions of R9-R11, R16-R23 and all pilot acceptance |

Overlaps are deliberate interface checks: the protocol child defines the
envelope, the receipt child persists it, the dispatch child produces it, and
the pilot proves the assembled lifecycle.

## Boundaries And Non-Goals

- This parent changes no Action runtime behavior.
- Children must not move provider credentials or local-checkout reviewers into
  the router.
- The pilot child does not duplicate PR-Agent/Gito/internal-adapter validation;
  it consumes evidence from `validate-external-reviewer-adapters`.
- Upstream command-pack changes and private-repository mutations remain outside
  ordinary repo-local implementation authority.

## Affected Files

- this parent task's planning artifacts and metadata;
- four child task directories and their planning/context artifacts.

## Data And Command Contracts

Dependencies are stored in each child's `task.json.meta.depends_on` and repeated
in its PRD/implementation plan. Parent/child metadata records scope grouping,
not execution order.

## Risks And Edge Cases

- A requirement could be lost between children; the mapping table and each
  child's acceptance criteria provide two-way traceability.
- Transport and dispatch interfaces could drift; both depend on the protocol
  core and name its canonical envelope as their only data contract.
- The final pilot can be blocked by external state without blocking the three
  repo-local implementation PRs.

## Validation

- validate every parent and child with `task.py validate`;
- run review preflight to check reciprocal topology and context paths;
- confirm each child has a converged PRD, design, implementation plan, and
  explicit dependency order.
