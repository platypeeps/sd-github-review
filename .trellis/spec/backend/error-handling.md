# Error Handling

> Failure contracts for Action inputs, GitHub transport, and workflow output.

## Error Types

Use standard `Error` instances with precise boundary context. This repository
does not define a custom error hierarchy.

## Error Handling Patterns

- Validate modes, booleans, positive integers, confidence, and PR numbers at
  the input boundary in `src/index.js`.
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

## Example

`errorAnnotation()` percent/newline-escapes error text before it becomes a
workflow command. Preserve this boundary when changing entrypoint failures.
