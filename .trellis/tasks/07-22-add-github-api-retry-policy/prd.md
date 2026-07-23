# Add GitHub API retry and rate-limit policy

## Goal

Make eligible transient GitHub API failures bounded and diagnosable without
repeating reviewer side effects or hiding deterministic failures.

## Requirements

- Retry read-only `GET` operations at most three attempts for transport
  failures, HTTP 408/429, HTTP 500/502/503/504, and HTTP 403 only when the
  response proves a primary or secondary rate limit.
- Use deterministic exponential backoff for ordinary transient failures;
  prefer GitHub's numeric `retry-after`, then primary-limit
  `x-ratelimit-reset`, and never sleep or retry sooner than GitHub directs.
- Cap an individual delay at 60 seconds. When a valid GitHub-directed delay is
  longer, fail with actionable context instead of retrying early.
- Inject the sleeper and clock so tests never use wall-clock delays.
- Never retry `POST`, `PATCH`, or another mutating operation. Reviewer requests
  and Check Run mutations remain owned by their existing reconciliation or
  fail-closed boundaries when transport outcome is ambiguous.
- Surface primary/secondary rate-limit context without credentials or raw
  authorization data; expose only bounded status, remaining, reset,
  retry-after, and resource values.
- Preserve current pagination limits and exact GitHub error messages for
  terminal failures.

## Acceptance Criteria

- [x] Tests cover successful retry, cap exhaustion, rate-limit headers,
  non-retryable failures, and interrupted reviewer requests.
- [x] Backoff is bounded and tests do not sleep in wall-clock time.
- [x] No retry path can issue a duplicate reviewer request.
- [x] Runtime, metadata, and CI checks pass.

## Boundaries

- Retry policy stays inside `GitHubClient`; routing, receipt identity, and
  provider dispatch policy do not change.
- No new Action input allows pull-request content to tune retries.
- The client does not call `GET /rate_limit`; it uses the response headers on
  the failed request.
