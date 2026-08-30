# Design: Harden MVP for First Release

The product architecture, routing workflow, backend contract, and security
boundaries are canonical in [`DESIGN.md`](../../../DESIGN.md). This task design
records only the first-release implementation and verification choices.

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
