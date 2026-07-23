# Define Public Trellis Metadata Policy Design

## Overview

Publish reproducible project knowledge and shared AI-tool distribution files,
while keeping machine, developer-runtime, cache, log, session, and temporary
state out of Git. Enforce the boundary in the existing metadata validator.

## Proposal

1. Add `docs/PUBLIC_METADATA_POLICY.md` as the authoritative human policy.
2. Keep the command-pack-managed root ignore block intact and add only
   project-owned `.agents/` local-state exclusions below it.
3. Extend `validateMetadata()` to obtain the tracked file list with
   `git -C <root> ls-files -z` and reject paths matching a small exported
   prohibited-metadata classifier.
4. Add focused unit tests for prohibited and allowed paths plus the current
   repository integration assertion.
5. Link the policy from the README development section.

## Boundaries And Non-Goals

- No Git history rewrite, removal of current workspace records, or routing
  behavior change.
- Do not edit the command-pack-managed `.gitignore` block.
- Do not attempt content-based secret detection in this path policy; secret
  scanning remains a separate defense. Documentation makes all tracked
  metadata reviewable and public by definition.

## Affected Files

- `docs/PUBLIC_METADATA_POLICY.md`
- `README.md`
- `.gitignore`
- `scripts/validate-action-metadata.mjs`
- `test/metadata.test.js`
- active Trellis task artifacts

## Data And Command Contracts

- Input: POSIX-style paths returned by `git ls-files -z`.
- Output: `validateMetadata()` retains existing counts and adds a tracked path
  count.
- Failure: one actionable error lists each prohibited tracked path and directs
  the maintainer to untrack it or revise the public policy deliberately.
- The classifier is deterministic, side-effect free, and exported for table
  tests. Git listing failures fail closed with repository context.

## Risks And Edge Cases

- Ignore rules do not affect already tracked files; the Git-backed validation
  closes that gap.
- Windows separators are normalized before classification.
- Broad patterns could reject shared adapters, so allowed-path tests cover
  Trellis tasks/specs/workspace Markdown and representative platform files.
- Generated command-pack updates may replace their managed ignore block; the
  project-specific `.agents/` section remains outside it.

## Validation

- `npm test`
- `npm run check`
- `npm run validate:metadata`
- `python3 scripts/sd-ai-command-pack-install-audit.py`
- `git diff --check`
