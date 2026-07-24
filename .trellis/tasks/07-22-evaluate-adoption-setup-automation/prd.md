# Evaluate adoption-driven setup automation

## Goal

Add setup automation only when repeated adoption evidence proves that a small,
safe tool will reduce operator error more than it increases permission and
maintenance cost.

## Decision

No setup automation will be added in this task. As of 2026-07-24, bounded
repository and GitHub evidence identifies only one independent consumer, the
private pilot repository. The required three-consumer threshold is not met,
and no repeated setup failure category is recorded. Manual setup remains the
supported path.

## Requirements

- Collect bounded friction evidence from at least three independent consumer
  installations or upgrade attempts.
- Separate documentation defects, GitHub permission gaps, and genuinely
  repetitive setup steps before proposing automation.
- Prefer read-only preflight and generated configuration previews; require
  explicit confirmation for repository mutations.
- Define permissions, idempotency, rollback, and unsupported states before
  implementation.

## Acceptance Criteria

- [x] Evidence identifies repeated setup pain across at least three consumers,
  or the task records a no-build decision and closes.
- [x] No tool is proposed, so no new command, permission, idempotency, or
  rollback contract is introduced.
- [x] No automation stores provider credentials or executes PR code.
- [x] Existing manual setup documentation remains the supported installation
  path.

## Entry Gate

The three-consumer threshold was not met. Reconsider automation only after
three independent installations or upgrades record a repeated friction class;
absence of that evidence remains a reason not to build tooling.
