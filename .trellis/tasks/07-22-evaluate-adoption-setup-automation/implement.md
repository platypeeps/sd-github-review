# Adoption-Driven Setup Automation Evaluation Implementation Plan

## Execution Order

1. Search checked-in task/session records for adoption or setup-friction
   evidence.
2. Run one bounded organization code search for the released immutable Action
   reference and classify source versus independent consumer repositories.
3. Record the evidence limitations and no-build decision.
4. Align the PRD acceptance criteria and entry gate with that decision.
5. Validate, review, and ship the documentation-only task closure.

## Validation Plan

- `python3 ./.trellis/scripts/task.py validate`
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- `python3 scripts/sd-ai-command-pack-install-audit.py`
- `git diff --check`
- deterministic SD full-check, exact-head CI, and configured remote review

## Documentation And Spec Updates

No live setup guide or backend spec changes. The current manual installation
contract remains unchanged; only task evidence and lifecycle records change.

## Review Notes

- Confirm the source repository is not counted as a consumer.
- Confirm one private pilot does not satisfy a three-consumer threshold.
- Confirm the evidence wording acknowledges code-search limitations.
- Confirm no automation or permission surface was added implicitly.

## Rollback Points

Revert the task-evidence commit if the bounded search was misclassified. A
future task may supersede the no-build decision when the explicit threshold is
met; it should not rewrite this dated evidence.

## Follow-Ups

None now. Create a new implementation task only after three independent
consumer installations or upgrades identify the same repeatable setup step.

