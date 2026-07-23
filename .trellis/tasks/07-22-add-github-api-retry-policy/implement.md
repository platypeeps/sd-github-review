# GitHub API Retry And Rate-Limit Policy Implementation Plan

## Execution Order

1. Add private retry-policy constants and pure helpers in `src/github.js` for
   safe methods, transient status/rate-limit classification, normalized
   diagnostics, and bounded delay calculation.
2. Inject `sleep` and `now` through the `GitHubClient` constructor and wrap the
   existing request/parse/error path in a three-attempt loop for safe reads.
3. Leave mutation methods on one attempt so receipt and reviewer ambiguity is
   handled only by their current callers.
4. Add the focused behavior matrix in `test/github.test.js` using fake fetch,
   sleeper, and clock implementations with no real delays.
5. Document the current behavior in `DESIGN.md` and executable backend specs.

## Validation Plan

- `node --test test/github.test.js`
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- `python3 .trellis/scripts/task.py validate 07-22-add-github-api-retry-policy`
- `git diff --check`
- `bash scripts/sd-ai-command-pack-review-full-check.sh`

## Documentation And Spec Updates

- Add one transport-policy section to `DESIGN.md`; keep roadmap/future work in
  Trellis rather than duplicating it.
- Extend backend error and quality matrices with safe read retries, directed
  rate-limit waits, cap behavior, and mutation non-retry rules.
- No Action metadata changes are expected because retry tuning is not public.

## Review Notes

- Verify method safety is checked before every transport/status retry branch.
- Verify valid GitHub delay headers are never shortened to the local cap.
- Verify terminal errors retain the existing method/path/message prefix.
- Verify tests record requested delays instead of sleeping.
- Verify diagnostics copy no authorization or arbitrary response headers.

## Rollback Points

- Revert the transport commit to restore single-attempt behavior; no durable
  schema, Action input, receipt, or consumer workflow migration is required.

## Follow-Ups

- Cross-run or organization-wide throttling remains out of scope until live
  usage proves a need.
