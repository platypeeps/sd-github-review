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
- `GitHubClient#request()` includes the HTTP method, path, and GitHub response
  message when a request fails.
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
| More than 3,000 files in automatic mode | Throw and require an explicit route |
| Unrelated event | Emit a successful `none` decision, not an error |
| Unsupported protocol schema major or malformed identity | Throw a field-specific error before hashing or future dispatch |
| Caller identity/fingerprint differs from canonical derivation | Throw; do not accept the compatibility value |
| Local evidence is wrong-head, oversized, sensitive, or contradictory | Throw; do not silently discard the unsafe field |
| Local outcome is failed/cancelled/skipped with positive confidence | Throw; non-positive outcomes must use zero confidence |
| Trusted successor evidence does not match `supersedes` and current head | Throw before applying successor policy |
| Receipt route/backend/dispatch state is contradictory | Throw; do not publish a partial receipt |

## Example

`errorAnnotation()` percent/newline-escapes error text before it becomes a
workflow command. Preserve this boundary when changing entrypoint failures.
