# Compiled Review Configuration Promotion Implementation Plan

1. Add catalog retrieval and safe-projection fixtures.
2. Integrate compiler invocation and deterministic semantic diff, including
   explicit per-lane budget-exhaustion merge policy.
3. Implement pending validation and atomic active promotion.
4. Add drift, interrupted promotion, rollback, update, and uninstall handling.
5. Add redacted diagnostics and operator documentation.

Validate stale/missing/mismatched catalog, compiler failure, crash boundaries,
idempotence, ownership preservation, secret scans, and full installer gates.
