# Routed Review Source Scaffolding Implementation Plan

1. Add canonical explicit-source fixtures and invalid input cases.
2. Render explicit per-lane budget-exhaustion merge policy and schema-validate
   the complete source in memory.
3. Add conflict-aware dry run and ownership-safe write behavior.
4. Add reserved candidate/slot-label detection that reports unsupported
   controls without provisioning, adopting, or deleting labels.
5. Document fresh installation and alternate candidate aliases.

Validate focused installer tests, idempotent reapply, unmanaged collision,
secret scan, `npm test`, `npm run check`, and metadata validation.
