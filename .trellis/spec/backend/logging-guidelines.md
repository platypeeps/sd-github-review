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
- durable operation/state, exact head, dispatch phase, backend channels, and
  reconciliation status;
- adapter acknowledgment status and backend ID, without provider output or
  unbounded error detail;
- validation failures with the file or API boundary that caused them.

## What Not to Log

- GitHub or provider tokens;
- provider credentials, raw authorization headers, or full environment dumps;
- pull-request source contents;
- paths, prompts, raw findings, provider transcripts, configuration values, or
  local artifact contents from routed-review protocol data;
- unnecessary event payloads or personally identifying account data.

Protocol validation errors name only the field and violated bound or contract.
They must not echo the rejected value. Durable receipts may carry only bounded
normalized observation metadata; native finding bodies remain on their
declared GitHub surfaces.

The `sd-github-review/receipt` Check Run stores only the v1 marker and canonical
normalized receipt. Successor comparison may inspect GitHub filenames in
memory, but persists only a path-sensitive digest, bounded counts, and the
normalized comparison class; raw filenames and patches are discarded.
Durable summaries expose only the sensitive-file count; the matching paths do
not enter outputs, summaries, logs, adapter requests, or receipts.

## Example

Prefer a single concise line:

```text
Selected cheap for PR #42: routine pull request within configured risk limits
```

Do not dump the event or client configuration.
