# Design: Harden MVP for First Release

## Architecture and Boundaries

Keep three explicit layers:

1. **Event triage** reads the GitHub event and rejects irrelevant events before
   network work.
2. **Routing orchestration** resolves fixed/command/label precedence and asks
   for changed files only when automatic sensitive-path evaluation is needed.
3. **Side effects and reporting** request Copilot when selected, then write
   outputs, the step summary, and annotations.

`src/router.js` remains the pure policy layer. `src/github.js` remains the HTTP
boundary. `src/index.js` should expose an injectable orchestration function and
retain a thin executable wrapper so tests do not need live GitHub calls or
process-global mutation beyond a controlled harness.

## Decision and Data Flow

```text
event + inputs
  -> reject unrelated comment/label event
  -> obtain only metadata needed to authorize command or read labels
  -> resolve fixed / command / label route
  -> if still auto: obtain changed files and evaluate risk
  -> if Copilot: inspect requested reviewers and request once
  -> write stable outputs and summary
```

Explicit routes still report available pull-request metadata, but
`sensitive-files` may be an empty array because sensitive-path evaluation did
not participate in the decision. This behavior must be documented and tested.

## Test Boundaries

- `test/router.test.js`: pure precedence, parsing, trust, and glob behavior.
- New GitHub-client tests: injected `fetch`, headers, URLs, pagination, response
  decoding, failures, and reviewer request payloads.
- New action/orchestration tests: fixture events, injected client and file/output
  sinks, call-count assertions, outputs, summaries, and annotations.
- CI metadata validation: `action.yml` plus `.github/workflows/*.yml`.

Prefer test seams over a large rewrite. Extract only enough process and file
I/O to make the current behavior deterministic under Node's built-in test
runner.

## Compatibility

- Preserve all existing action input and output names.
- Preserve Node.js 20 and GitHub Enterprise API URL support.
- Preserve the documented route precedence.
- Do not require consumers to add runtime npm installation.

## Security

- Never log tokens or provider secrets.
- Keep the router's own permissions at `contents: read` and
  `pull-requests: write` only when Copilot requests are enabled.
- Do not add PR checkout to the comment-triggered example.
- Pin CI Actions by full SHA and keep automated dependency updates reviewable.

## Operational and Rollback Considerations

- Each behavior change must be separable from metadata/CI changes for review.
- If staged orchestration changes routing results, revert that slice while
  retaining tests that demonstrate the disagreement for replanning.
- The initial pilot observes cheap/deep outputs but performs no external
  reviewer side effect. Only Copilot is exercised as a live reviewer path.
- The pilot runs in the dedicated private
  `platypeeps/sd-github-review-pilot` repository without an automatic Copilot
  review ruleset; this keeps failures isolated and makes a successful reviewer
  request distinguishable from deduplication.
- Do not create `v0.1.0` until the internal pilot gate is green and the
  maintainer separately approves publication.

## Trade-offs

- A dedicated orchestration function adds a small API surface but removes the
  need for fragile child-process-only tests.
- Skipping file enumeration for explicit routes improves reliability but means
  `sensitive-files` describes evaluated risk, not all potentially sensitive
  files. Documenting this is preferable to paying for an irrelevant API scan.
- Requiring one human approval in this repository would align with the README's
  recommendation but may impede a solo-maintainer pilot; that remains a host
  policy decision outside this task.
