# Integrate Copilot review adapter

## Goal

Request and observe native Copilot reviews using immutable exact-head authorization.

## Requirements

- Accept only a durable immutable Copilot child authorization bound to the exact
  repository, PR, head, attempt, and candidate, with prompt-profile mode
  explicitly set to `handler-managed`.
- Request Copilot idempotently and record bounded request identity without
  exposing alternate candidates or management credentials.
- For audit finding A-001, distinguish replay of an existing attempt from an
  explicitly authorized same-head rerequest. A distinct authorized attempt
  must issue one new request even when the prior attempt already has a
  completed exact-head review; a pending request for the new attempt remains
  deduplicated.
- Observe completion against the same exact head within a bounded window and
  return the shared acknowledgment shape with `handler-managed` prompting.
- Treat request uncertainty, timeout, head change, and missing correlation as
  visible reconciliation states rather than triggering fallback.

## Acceptance Criteria

- [ ] Authorized request, existing request, already-reviewed head, timeout,
      ambiguity, changed head, and replay fixtures never duplicate a request;
      an authorized attempt-2 fixture with a prior completed review issues
      exactly one new request and a replay of attempt 2 issues none.
- [ ] Completion evidence cannot satisfy a different head or attempt.
- [ ] Logical cheap/deep lane remains separate from native Copilot handler.
- [ ] Copilot rejects referenced PR-Agent profiles and acknowledges only
      `handler-managed`; no prompt body or configurable profile is implied.
- [ ] Workflow permissions and outputs contain no provider-management secret.

## Dependencies

- `07-25-authorize-budget-aware-review-plans` and the v2 acknowledgment schema.

## Out of Scope

- External model invocation or Copilot model/effort selection not exposed by
  GitHub's review interface.
