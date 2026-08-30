# Implementation plan: Trellis-owned roadmap consolidation

1. Audit every phase bullet and potential-issue row against current code,
   tests, workflows, release state, and archived tasks.
2. Create six parent-linked planning tasks for the distinct unresolved
   outcomes and fill their PRDs.
3. Replace every generated context scaffold with grounded Trellis spec entries.
4. Delete the obsolete standalone project-plan document and remove its live
   references.
5. Remove duplicated planned-backend ordering and operational-roadmap prose
   from `DESIGN.md`; adjust `README.md` to describe only current support.
6. Validate the parent and every child with `task.py validate`.
7. Search for stale project-plan links and duplicated roadmap terminology.
8. Run `npm test`, `npm run check`, `npm run validate:metadata`, the installed
   pack audit, review preflight, and `git diff --check`.

Stop and restore the project-plan file if any source item lacks a single task
owner or a completed-evidence disposition.
