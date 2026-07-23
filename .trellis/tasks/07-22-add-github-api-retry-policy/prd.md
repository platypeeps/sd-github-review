# Add GitHub API retry and rate-limit policy

## Goal

Make eligible transient GitHub API failures bounded and diagnosable without
repeating reviewer side effects or hiding deterministic failures.

## Requirements

- Define retryable statuses and headers, maximum attempts, delay/backoff caps,
  and deterministic test hooks.
- Retry read-only operations only when safety is provable; reconcile or fail
  closed for reviewer-request mutations whose outcome is ambiguous.
- Surface primary/secondary rate-limit context without credentials or raw
  authorization data.
- Preserve current pagination limits and exact GitHub error messages for
  terminal failures.

## Acceptance Criteria

- [ ] Tests cover successful retry, cap exhaustion, rate-limit headers,
  non-retryable failures, and interrupted reviewer requests.
- [ ] Backoff is bounded and tests do not sleep in wall-clock time.
- [ ] No retry path can issue a duplicate reviewer request.
- [ ] Runtime, metadata, and CI checks pass.
