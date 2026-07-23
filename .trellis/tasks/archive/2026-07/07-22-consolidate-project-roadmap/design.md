# Design: Trellis-owned roadmap consolidation

## Authority Boundaries

- Planned work lives under `.trellis/tasks/` with one task per independently
  verifiable outcome.
- `DESIGN.md` owns current architecture, contracts, supported backends, and
  present limitations; it does not own delivery order.
- `README.md` owns current installation and adapter instructions.
- `docs/RELEASE_CHECKLIST.md` remains the executable release/pilot runbook.
- Archived tasks and Git history remain historical evidence.

## Migration

1. Classify every project-plan entry as completed or unresolved using current
   code, tests, workflows, archived tasks, and live release state.
2. Collapse overlapping unresolved entries into six child tasks.
3. Put the complete future requirement and acceptance contract in each child
   PRD, with explicit source-item coverage in the parent PRD.
4. Delete the obsolete standalone project-plan document only after task
   validation proves the mapping is complete.
5. Remove forward-looking backend order and operational-roadmap statements
   from live design/docs, retaining factual descriptions of current support.

## Compatibility

This migration changes repository planning metadata only. It must not change
the Action runtime, workflow events, inputs, outputs, permissions, or examples.
Existing archived task paths remain valid historical references.

## Rollback

Restore the obsolete project-plan document and its links if validation exposes
an unmapped requirement. Do not delete or archive a child task merely to hide
overlap; correct the owning PRD and parent mapping instead.
