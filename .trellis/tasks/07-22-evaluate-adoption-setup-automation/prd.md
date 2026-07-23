# Evaluate adoption-driven setup automation

## Goal

Add setup automation only when repeated adoption evidence proves that a small,
safe tool will reduce operator error more than it increases permission and
maintenance cost.

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

- [ ] Evidence identifies repeated setup pain across at least three consumers,
  or the task records a no-build decision and closes.
- [ ] Any proposed tool has a minimal contract, dry-run behavior, permission
  matrix, idempotency tests, and rollback path.
- [ ] Automation does not store provider credentials or execute PR code.
- [ ] Documentation remains sufficient for manual setup.

## Entry Gate

Keep this task planned until adoption evidence satisfies the three-consumer
threshold; absence of evidence is a reason not to build tooling.
