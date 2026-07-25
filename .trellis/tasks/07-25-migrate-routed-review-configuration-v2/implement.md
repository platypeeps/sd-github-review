# Routed Review v2 Migration Implementation Plan

1. Inventory supported installer-owned v1 shapes and add fixtures.
2. Implement pure v1-to-explicit-v2 translation and diagnostics, including the
   one-time legacy exhaustion-to-merge-policy mapping.
3. Add semantic preview and ownership-transition recording.
4. Apply through the managed installer lifecycle and reject repeat legacy input.
5. Add rollback and migration documentation.

Validate canonical, partial, drifted, conflicting, repeat, rollback, and
uninstall fixtures plus the full installer and metadata gates.
