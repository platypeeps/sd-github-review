# Implementation Plan: Harden MVP for First Release

## Ordered Work

1. Replace the generic Trellis backend/frontend guidance needed by this task
   with repository-derived JavaScript/action conventions, or explicitly scope
   the task to the relevant quality guidance.
2. Add GitHub-client tests around injected `fetch`, pagination, failures, and
   reviewer request behavior.
3. Extract a small injectable orchestration entrypoint from `src/index.js`.
4. Add event fixtures and orchestration tests, including call-count assertions
   for unrelated and explicit routes.
5. Stage decision-making so irrelevant events and explicit routes avoid
   automatic-only PR-file enumeration.
6. Add action/workflow metadata validation to CI and pin third-party Actions by
   full commit SHA.
7. Update the quick start with a runnable smoke procedure, explicit consumer
   prerequisites, and the semantics of outputs when automatic risk evaluation
   is skipped.
8. Add a release checklist covering versioning, tag/release creation, required
   checks, immutable SHA instructions, internal pilot evidence, and rollback.
9. Create the private `platypeeps/sd-github-review-pilot` repository without an
   automatic Copilot review ruleset, then define fixtures for automatic,
   command, label, cheap/deep output-only, and live Copilot paths without
   provider credentials.
10. Run the full validation set and review the diff against the PRD.

## Validation Commands

```sh
npm test
npm run check
npm run validate:metadata
python3 scripts/sd-ai-command-pack-install-audit.py
git diff --check
```

Also run the selected action/workflow metadata validator and a local fixture
smoke command added by this task. Before the pilot, require a green GitHub
Actions run for the exact candidate commit. Before public release, require the
pilot exit criteria and separate maintainer approval.

## Risky Files and Rollback Points

- `src/index.js`: highest behavior risk; keep event gating, route resolution,
  and side effects reviewable in small commits/hunks.
- `src/router.js`: precedence contract; avoid changing unless a failing test
  proves policy logic, not orchestration, is wrong.
- `.github/workflows/ci.yml`: pinning or validator setup can block all PRs;
  verify the exact check name remains compatible with branch protection.
- `examples/review-router.yml`: security-sensitive because it handles
  `issue_comment`; do not introduce checkout or secret-bearing execution of PR
  code.

## Review Gates

- The pilot target is the dedicated private
  `platypeeps/sd-github-review-pilot` repository. The route/provider scope is
  fixed to routing outputs plus live Copilot, with no external reviewer
  provider.
- Confirm branch protection still requires the emitted `test` check if CI job
  names change.
- Re-run the SD pack audit after changing `.github` or shared tooling files.
- Do not publish a tag or release as part of implementation without explicit
  maintainer approval.

## Focused First-Review Evidence

The candidate is larger than a narrow runtime patch because the risk-reducing
tests, metadata gate, and pilot/release documentation ship together. Review the
runtime slice (`src/index.js` and `src/router.js`) independently from the
test/docs/CI slice. Boundary coverage includes malformed inputs, missing event
context, untrusted and unrelated events, injected environment/output state,
multiline output encoding, GitHub pagination and API errors, explicit-route
shortcuts, and Copilot request deduplication. The YAML parser is development
only and validates repository-owned paths; it does not process pull-request
content at runtime.
