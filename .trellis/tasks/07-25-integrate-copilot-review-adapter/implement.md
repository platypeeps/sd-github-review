# Copilot Review Adapter Implementation Plan

1. Add authorized, handler-managed/referenced-profile, existing, completed,
   timeout, and ambiguity fixtures.
2. Gate native request on matching durable authorization.
3. Implement idempotent request and exact-head completion observation.
4. Emit bounded `handler-managed` shared acknowledgments and reconciliation
   states.
5. Add permissions, logging, replay, and rollback documentation.

Validate no duplicate request, exact-head isolation, changed-head behavior,
observer deadline, and absence of management secrets.
