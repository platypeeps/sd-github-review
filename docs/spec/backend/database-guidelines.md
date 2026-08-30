# Database Guidelines

> Database scope for this repository.

## Status

Not applicable. The Action is stateless and has no database, ORM, migrations,
cache, queue, or persistence schema. Runtime state comes only from the GitHub
event payload, Action inputs, and live GitHub REST responses.

## Guardrail

Do not introduce persistence as an incidental implementation detail. A hosted
service, cross-run state, or database-backed deduplication would change the
product boundary described in `DESIGN.md` and requires a separately approved
task, architecture design, threat model, and operational plan.

## Current Example

Copilot deduplication in `src/index.js` derives state from requested reviewers
and completed reviews for the current PR head instead of storing local state.
