# GitHub API Retry And Rate-Limit Policy Design

## Overview

Add a bounded retry policy to the existing `GitHubClient#request()` transport
boundary. The policy improves resilience for provably safe reads while
preserving the durable runtime's central safety property: an uncertain
reviewer request or Check Run mutation is never repeated automatically.

## Proposal

`GitHubClient` will accept injected `sleep` and `now` functions alongside the
existing injected `fetch`. A read request gets at most three total attempts.
Ordinary transient failures use deterministic one- and two-second exponential
delays. GitHub rate-limit responses instead use the first applicable delay:

1. numeric `retry-after` seconds;
2. `x-ratelimit-reset` UTC epoch seconds when `x-ratelimit-remaining` is zero;
3. 60 seconds for a secondary limit without either header.

An individual delay may not exceed 60 seconds. If GitHub directs a longer
wait, the client returns a terminal diagnostic instead of retrying sooner than
allowed. Retries apply only to `GET` transport failures, HTTP 408/429,
HTTP 500/502/503/504, and HTTP 403 responses with rate-limit evidence.

Terminal errors retain the existing `GitHub API <method> <path> failed:
<message>` contract and append bounded attempt/rate-limit context. The context
allow-list is limit type, remaining count, reset epoch, retry-after seconds,
resource, and cap reason; response authorization headers are never copied.

## Boundaries And Non-Goals

- `POST`, `PATCH`, `PUT`, and `DELETE` are never retried.
- Reviewer-request and Check Run ambiguity continues through the existing
  reconciliation/fail-closed callers.
- No Action input or PR-controlled value configures retry behavior.
- No jitter, background queue, global rate-limit coordinator, or explicit
  `GET /rate_limit` probe is introduced.
- Pagination page/file caps and endpoint payloads remain unchanged.

## Affected Files

- `src/github.js`: retry classification, delay calculation, diagnostics, and
  injected timing boundaries.
- `test/github.test.js`: deterministic transport/rate-limit behavior matrix.
- `DESIGN.md`: current runtime retry and mutation-safety behavior.
- `.trellis/spec/backend/error-handling.md`: executable failure matrix.
- `.trellis/spec/backend/quality-guidelines.md`: transport contract and tests.

## Data And Command Contracts

- Maximum attempts: 3 total.
- Ordinary delays: 1,000 ms then 2,000 ms.
- Maximum individual delay: 60,000 ms.
- Retryable safe statuses: 408, 429, 500, 502, 503, 504.
- HTTP 403 is retryable only with `retry-after`, remaining zero plus reset, or
  a bounded API message identifying a secondary rate limit.
- A fetch rejection is retryable only for `GET`.
- `sleep(milliseconds)` and `now()` are constructor-injected test seams.

## Risks And Edge Cases

- Retrying mutations can duplicate reviews or corrupt receipt state: method
  classification forbids it before status/error classification.
- Capping a GitHub-directed delay by sleeping less violates rate-limit
  guidance: over-cap directives fail immediately and include the safe retry
  context.
- Malformed headers must not produce `NaN`, negative, or unbounded sleeps:
  strict numeric parsing falls back to another valid signal or ordinary
  backoff.
- Response diagnostics can leak headers: only named rate-limit fields are
  normalized and length-bounded.
- A terminal response body message remains unchanged so current callers and
  tests keep their error contract.

## Validation

- Focused `node --test test/github.test.js` coverage for transient success,
  network retry, attempt exhaustion, non-retryable status, retry-after,
  primary reset, secondary fallback, over-cap delay, and mutation ambiguity.
- Existing pagination and method/payload tests remain green.
- Run `npm test`, `npm run check`, metadata validation, task validation, and
  the repository full review gate before shipping.
