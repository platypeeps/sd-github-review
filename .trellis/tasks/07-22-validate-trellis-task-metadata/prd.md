# Validate Trellis task metadata consistency

## Goal

Prevent task-migration pull requests from reaching remote review with
undocumented priority changes or ambiguous references to paths intentionally
preserved in archived Trellis evidence.

## Confirmed Facts

- `scripts/sd-ai-command-pack-review-preflight.mjs` already owns deterministic
  Trellis task identity, lifecycle, branch, and parent/child validation.
- That script is an installed SD AI command-pack target sourced from
  `templates/scripts/sd-ai-command-pack-review-preflight.mjs`; the install
  audit intentionally rejects consumer-local edits to it.
- The documentation-path check already excludes archived Trellis tasks because
  their historical references may point at files that were later moved or
  deleted.
- Priority remapping cannot be inferred safely from prose alone. A reliable
  rule needs explicit structured provenance and a rationale when the current
  backlog priority differs from the source priority.

## Requirements

- Add the rule to the command-pack-owned review preflight rather than forking
  its installed copy in this consumer repository.
- Define bounded optional task metadata for source priority and an intentional
  priority-change rationale.
- Reject partial, invalid, or contradictory priority-provenance metadata while
  leaving ordinary tasks unchanged.
- Preserve archived task path references as historical evidence and cover that
  behavior with deterministic regression tests.
- Install the released or vouched upstream change back into this repository and
  verify the consumer audit and preflight.

## Acceptance Criteria

- [x] An intentional priority change has explicit machine-readable source
  priority and a non-empty rationale.
- [x] Matching priorities, malformed priorities, partial declarations, and
  ordinary tasks have deterministic good/base/failure coverage.
- [x] Archived references to later-deleted repository paths remain accepted;
  equivalent live-document references remain rejected.
- [x] Command-pack tests and consumer install audit/full-check pass.

## Out of Scope

- Parsing arbitrary roadmap prose to guess source priorities.
- Rewriting archived Trellis records.
- Adding a consumer-local fork of an installed command-pack script.

## Upstream Delivery

- Authorized upstream implementation merged through
  `platypeeps/sd-ai-command-pack#229`.
- The reviewed payload commit is `fbb6a82`; finish-work archived the upstream
  task and recorded its session at head `13d02f4` without changing payload
  bytes.
- Consumer PR #8 exposed that the 0.32.0 refresh regressed this repository's
  top-level `test/` review-learning classification. Corrective upstream PR
  #230 restored portable support for both `test/` and `tests/`, added focused
  coverage, passed all eight fleet candidates, and merged at `d0aba8c`.
- `v0.32.1` points to release commit `d0aba8c`; local and remote tag refs, the
  payload digest, and candidate ledger passed the release-identity preflight.
- This consumer's installed `0.32.1` payload is source-current and retains the
  singular-directory classifier under upstream provenance.
