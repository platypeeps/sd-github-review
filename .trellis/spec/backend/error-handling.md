# Error Handling

> Failure contracts for Action inputs, GitHub transport, and workflow output.

## Error Types

Use standard `Error` instances with precise boundary context. This repository
does not define a custom error hierarchy.

## Error Handling Patterns

- Validate modes, booleans, positive integers, confidence, and PR numbers at
  the input boundary in `src/index.js`.
- Protocol decoders validate exact JSON scalar/container types, supported
  schema major, bounded strings/collections, exact-head identity, and
  forbidden privacy fields before projecting an allow-listed normalized
  object. They never return partially trusted data.
- Let unexpected transport and policy errors reject `runAction()`; do not
  convert them into a successful `none` route.
- Durable operations parse bounded JSON before constructing side effects.
  Missing acknowledgments fail; uncertain create/update or post-dispatch head
  changes return reconciliation required with fallback dispatch forbidden.
- Adapter acknowledgment construction validates the canonical adapter request
  and accepts only `success`, `failure`, `cancelled`, or `skipped`. It maps
  non-success outcomes to bounded error codes and never accepts provider error
  text.
- A mutation that returns without throwing is not evidence that it took
  effect. Verify a reviewer request by re-reading the requested-reviewer set
  after the POST; never derive success from the probe taken before it. A
  non-landing request fails closed to reconciliation rather than advancing a
  receipt.
- A failure that is classified but not persisted lasts one run. Write the
  failed state to the durable receipt before returning: `receiptState` reads
  `status: "failed"` at `phase: "started"` as reconciliation regardless of age,
  but reads one still saying `requested` at that phase as in-flight until
  `strandedAfterMinutes` (default 360). Reporting without writing hands the next
  six hours of readers a dead dispatch labelled as possibly-running.
- `GitHubClient#request()` includes the HTTP method, path, and GitHub response
  message when a request fails. It retries eligible `GET` failures at most
  three total attempts through an injected sleeper, but never retries a
  mutation.
- Rate-limit errors use numeric `retry-after`, then a zero-remaining
  `x-ratelimit-reset`, then the documented 60-second secondary-limit fallback.
  A directive beyond the 60-second local cap fails without retrying early and
  reports only bounded rate-limit fields.
- The executable entrypoint catches once, emits an escaped GitHub
  `::error::` annotation, and sets `process.exitCode = 1`.
- Tests inject `fetch`, file appenders, and clients rather than mutating global
  process behavior.

## Validation Matrix

| Condition | Result |
| --- | --- |
| Invalid input enum/boolean/integer | Throw a field-specific error |
| Missing PR number | Throw before constructing the GitHub client |
| Conflicting route labels | Throw; do not choose an arbitrary route |
| GitHub non-2xx response | Throw with method, path, and API message |
| Read transport failure or HTTP 408/429/500/502/503/504 | Retry at most three total attempts with bounded deterministic delay |
| HTTP 403 without rate-limit evidence | Throw immediately; do not classify every permission failure as transient |
| Primary/secondary rate-limit delay at or below 60 seconds | Honor the GitHub-directed wait before a safe read retry |
| GitHub-directed delay above 60 seconds | Throw with bounded limit context; never retry sooner than directed |
| Reviewer or Check Run mutation transport failure | Make one attempt and let the caller reconcile or fail closed |
| Reviewer request accepted but the reviewer is absent afterwards | Report `landing=absent` and `requested=false`; return reconciliation required rather than observing the receipt |
| Post-request reviewer probe throws | Report `landing=unverified`; fail closed and record the outcome as unknown, never as a clean absence |
| Any classified dispatch failure, landing or throwing | Persist it via `store.dispatchFailed` before returning, so a later read reaches the same verdict |
| The `dispatchFailed` write itself fails | Stay `reconciliation-required` and carry both the original and the persist error; never downgrade the verdict because the write failed |
| More than 3,000 files in automatic mode | Throw and require an explicit route |
| Unrelated event | Emit a successful `none` decision, not an error |
| Unsupported protocol schema major or malformed identity | Throw a field-specific error before hashing or future dispatch |
| Caller identity/fingerprint differs from canonical derivation | Throw; do not accept the compatibility value |
| Local evidence is wrong-head, oversized, sensitive, or contradictory | Throw; do not silently discard the unsafe field |
| Local outcome is failed/cancelled/skipped with positive confidence | Throw; non-positive outcomes must use zero confidence |
| Trusted successor evidence does not match `supersedes` and current head | Throw before applying successor policy |
| Receipt route/backend/dispatch state is contradictory | Throw; do not publish a partial receipt |
| Receipt Check Run is malformed, noncanonical, wrong-head, or duplicated | Throw; never authorize another dispatch |
| Check Run create/update result is ambiguous | Return `reconciliationRequired: true` and `dispatchAllowed: false`; `route` additionally fails the step unless a concurrency winner already owns the head |
| Explicit route outside the repository's `route-policy` | Throw before routing and before any receipt write; `auto` is always permitted |
| Interrupted `started` receipt younger than `stranded-receipt-minutes` | Return `in-flight` with dispatch forbidden and `reconciliationRequired: false`; do not fail the step |
| Live PR head changes before or during receipt creation | Fail closed; do not authorize dispatch for the stale head |
| GitHub comparison is rewritten, truncated, incomplete, or changes head | Emit an ineligible bounded successor class; never infer bookkeeping-only |
| Missing/mismatched external acknowledgment | Throw or retain started receipt; never finalize or dispatch a fallback |
| Malformed adapter request or unsupported adapter outcome | Throw before emitting acknowledgment JSON |
| Changed head during finalization | Return reconciliation required without updating the old-head receipt |
| Query has no exact receipt | Emit `not-found` with no dispatch authorization |

## Example

`errorAnnotation()` percent/newline-escapes error text before it becomes a
workflow command. Preserve this boundary when changing entrypoint failures.
