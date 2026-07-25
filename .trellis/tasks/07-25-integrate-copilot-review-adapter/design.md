# Copilot Review Adapter Design

## Boundary

This child owns only the native Copilot request and bounded completion observer.
It consumes durable authorization and returns the shared acknowledgment shape;
selection, budget, aggregate assurance, and final receipt logic remain outside.

Copilot prompt behavior is explicitly `handler-managed`. The adapter rejects a
referenced PR-Agent profile and does not claim access to GitHub's native prompt,
model, or effort internals.

The request is exact-head-bound and idempotent against existing requests or a
completed same-head review. Observation correlates within a fixed window.
Uncertain request or unmatched/late completion enters reconciliation and never
causes adapter-local fallback.

## Rollback

Disable the Copilot handler or restore the prior workflow version. Existing
reviews and receipts remain historical evidence.
