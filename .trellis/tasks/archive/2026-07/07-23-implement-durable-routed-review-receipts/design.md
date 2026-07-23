# Durable Routed-Review Receipts Design

## Overview

Add a receipt store over GitHub Check Runs and the minimum GitHub transport
needed to prove exact heads and normalize successor comparisons.

## Proposal

- `src/github.js` owns REST mechanics for PR metadata, compare, and Check Runs.
- `src/receipt.js` owns Check Run marker encoding/decoding, lookup,
  reconciliation, phase transitions, aliases, and rerequest validation.
- Use Check Run name `sd-github-review/receipt`; bind `head_sha` to the full
  current PR head and `external_id` to the protocol-derived logical ID.
- Store one bounded machine marker and canonical JSON in check output text;
  summaries remain concise and non-secret.
- Convert compare API files into only `{class, digest, counts, truncated}` in
  memory, then discard raw filenames before receipt construction.

## Boundaries And Non-Goals

- Receipt storage never dispatches a reviewer; it returns whether dispatch is
  new, already represented, conflicting, or requires reconciliation.
- No caller-provided ID, fingerprint, path list, or successor class is trusted.
- No checkout, Git command, or PR-controlled code execution.

## Affected Files

- `src/github.js`
- `src/receipt.js`
- `test/github.test.js`
- `test/receipt.test.js`
- backend error/quality/logging specs

## Data And Command Contracts

- `GitHubClient.getPullRequest(number)` returns trusted number/head/base data.
- `GitHubClient.compareCommits(base, head)` returns paginated GitHub metadata.
- `GitHubClient.listCheckRuns(head, name)`, `createCheckRun(payload)`, and
  `updateCheckRun(id, payload)` own versioned REST calls.
- `ReceiptStore.begin(request) -> { state, receipt }`
- `ReceiptStore.acknowledge(...)` and `ReceiptStore.observe(...)` require the
  unchanged live head and monotonic phase transitions.
- Any ambiguous state returns `reconciliationRequired: true` and never
  `dispatchAllowed: true`.

## Risks And Edge Cases

- Concurrent workflow jobs may both see no receipt. Use GitHub external
  identity plus post-create re-read and fail closed on duplicates; document
  that absence before mutation is not proof after a failed create response.
- Check output size is bounded before network calls.
- Compare pagination and GitHub's file ceiling must report truncation and make
  successor classification ineligible.
- A finish-work bookkeeping commit is a new head and identity even when compare
  normalization classifies the delta as bookkeeping-only.

## Validation

- focused transport/receipt tests with injected fetch;
- adversarial concurrency/ambiguity fixtures;
- `npm test`, syntax/metadata checks, install audit, and preflight.
