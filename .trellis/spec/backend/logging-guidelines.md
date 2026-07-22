# Logging Guidelines

> Operator-visible output for the GitHub Action.

## Log Surfaces

The runtime uses three intentional surfaces instead of a logging framework:

- one concise console line from `runAction()` identifying PR, route, and
  reason;
- structured values written to `GITHUB_OUTPUT` for downstream steps; and
- a Markdown route summary written to `GITHUB_STEP_SUMMARY`.

Fatal errors use an escaped `::error::` workflow annotation. Repository
validation scripts may print progress and diagnostics to stdout/stderr.

## What to Log

- PR number, selected route, and human-readable reason;
- changed-line and sensitive-file counts in the step summary;
- whether this invocation newly requested Copilot;
- validation failures with the file or API boundary that caused them.

## What Not to Log

- GitHub or provider tokens;
- provider credentials, raw authorization headers, or full environment dumps;
- pull-request source contents;
- unnecessary event payloads or personally identifying account data.

## Example

Prefer a single concise line:

```text
Selected cheap for PR #42: routine pull request within configured risk limits
```

Do not dump the event or client configuration.
