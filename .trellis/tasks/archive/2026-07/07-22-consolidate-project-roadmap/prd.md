# Consolidate project roadmap into Trellis backlog

## Goal

Make Trellis the single source of truth for unfinished product and operational
work. Convert every genuinely open item in the former project-plan document
and the remaining routed-review follow-up into adoptable planning tasks, remove
duplicate forward-looking prose, and delete the obsolete project-plan file.

## Background

Repository evidence shows that several roadmap entries are already complete:

- project-specific Trellis specs replaced the generic bootstrap guidance;
- event short-circuiting, GitHub transport/orchestration tests, metadata
  validation, Node.js 24, immutable CI action pins, and Copilot current-head
  deduplication shipped through the archived first-release task;
- the private pilot exercised automatic, command, label, none, and live
  Copilot routes;
- the routed-review receipt contract is designed and archived, but its runtime
  implementation remains future work.

The unresolved work collapses into six independent outcomes:

| Source roadmap area | Owning Trellis child task |
| --- | --- |
| Phase 0 public-history hygiene | `07-22-define-public-trellis-metadata-policy` |
| Phase 2 pilot exit, first release, immutable install, consumer smoke | `07-22-complete-v010-release-consumer-smoke` |
| Phase 3 retry/backoff and rate-limit diagnostics | `07-22-add-github-api-retry-policy` |
| Phase 3 cross-run deduplication and routed-review receipt runtime | `07-22-implement-routed-review-receipt-runtime` |
| Phase 3 PR-Agent, Gito, internal adapters, examples, and model defaults | `07-22-validate-external-reviewer-adapters` |
| Phase 3 optional setup tooling | `07-22-evaluate-adoption-setup-automation` |

Child-task priorities are the current backlog ranking, not a copy of each
source issue's historical priority. The retry task is promoted from P3 to P2
because it owns the broader mutation-safety and bounded-failure policy, not
only rate-limit diagnostics. The routed-review receipt task is promoted from
P3 to P1 because it implements an already approved contract and is the shared
dependency for cross-run idempotency and external-adapter convergence.

Every potential-issue row has one disposition:

| Priority / issue | Disposition |
| --- | --- |
| P1 irrelevant/explicit events enumerate files | Completed by archived `07-21-harden-first-release` task |
| P1 missing GitHub client/action tests | Completed by archived `07-21-harden-first-release` task |
| P1 no tag or release | `07-22-complete-v010-release-consumer-smoke` |
| P2 non-runnable external-reviewer placeholder | `07-22-validate-external-reviewer-adapters` |
| P2 missing metadata/workflow CI and immutable pins | Completed by archived `07-21-harden-first-release` task |
| P2 ambiguous empty cheap/deep model behavior | `07-22-validate-external-reviewer-adapters` |
| P2 Node.js 20 runtime deprecation | Completed by archived `07-21-harden-first-release` task |
| P2 generic Trellis bootstrap guidance | Completed by archived `00-bootstrap-guidelines` task |
| P3 no bounded retry/rate-limit diagnostics | `07-22-add-github-api-retry-policy` |
| P3 no external-reviewer cross-run deduplication | `07-22-implement-routed-review-receipt-runtime` |
| P3 Copilot can be re-requested after review | Completed by archived `07-21-harden-first-release` task |

## Requirements

- R1: Preserve completed roadmap evidence in archived Trellis tasks and Git
  history, including historical references to paths that later move or are
  deleted; do not rewrite those records or recreate completed work as planned
  tasks.
- R2: Give each unresolved outcome exactly one owning child task with a clear
  priority, requirements, acceptance criteria, and parent relationship.
- R3: Map the unresolved potential issues into those child tasks without
  duplicating tasks for concerns already owned by a phase outcome.
- R4: Remove generated `_example` context rows and ground every new task's
  implementation/check context in Trellis specs.
- R5: Delete the obsolete standalone project-plan document after every open
  item is mapped.
- R6: Remove the obsolete project-plan link and duplicated planned-backend and
  operational-roadmap prose from `DESIGN.md` and `README.md`, while preserving
  current supported behavior and the operational release checklist.
- R7: Keep `docs/RELEASE_CHECKLIST.md`; it is an executable gate owned by the
  release task, not a duplicate roadmap.
- R8: Validate every created task plus repository metadata, tests, and command
  pack integrity.

## Acceptance Criteria

- [x] Six planned child tasks exist under this parent and cover every
  unresolved phase and potential issue exactly once.
- [x] Completed Phase 0/1/2 work and resolved issue rows are not recreated as
  backlog tasks.
- [x] Every new task passes `task.py validate` and contains no `_example`
  context row or code/test path in its context manifests.
- [x] The obsolete standalone project-plan document is deleted and no live
  document links to it; archived task metadata may retain the deleted path as
  historical evidence.
- [x] `DESIGN.md` describes current architecture and limitations without
  duplicating future task plans.
- [x] `README.md` describes supported adapter behavior without claiming that
  `DESIGN.md` owns a backend roadmap.
- [x] `docs/RELEASE_CHECKLIST.md` remains intact and is referenced by the
  release child task.
- [x] `npm test`, `npm run check`, `npm run validate:metadata`, the installed
  pack audit, task validation, and `git diff --check` pass.

## Out of Scope

- Implementing any child task.
- Publishing `v0.1.0` or changing GitHub release state.
- Rewriting public Git history or deleting already-published Trellis records.
- Changing current routing behavior, Action inputs, or provider credentials.
