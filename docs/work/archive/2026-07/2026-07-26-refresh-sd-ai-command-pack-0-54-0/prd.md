---
title: Refresh sd-ai-command-pack to 0.54.0
status: done
created: 2026-07-26
branch: codex/refresh-sd-ai-command-pack-0-54-0
---
# Refresh sd-ai-command-pack to 0.54.0

## Goal

Install and verify the immutable sd-ai-command-pack 0.54.0 release for SD GitHub Review.

## Requirements

- Install only the immutable `sd-ai-command-pack` `v0.54.0` release at commit
  `163c104b95871dc315a8e643ffa664b00a723bf5d`.
- Refresh the managed Claude, Gemini, GitHub, and OpenCode payloads using the
  release checkout; do not hand-edit generated payload files.
- Preserve repository-owned files and unrelated work. The refresh must remain
  isolated on `codex/refresh-sd-ai-command-pack-0-54-0` targeting `main`.
- Refresh dependencies with `npm ci`, then run `npm test`, `npm run check`, and
  `npm run validate:metadata` as the configured candidate and full validation
  gates.
- Publish the refresh through the normal PR, routed-review, CI, and
  housekeeping gates. Complete and archive this task through `sd-finish-work`
  before merge.

## Acceptance Criteria

- [ ] Installation provenance reports version `0.54.0`, and the install audit
  passes for Claude, Gemini, GitHub, and OpenCode.
- [ ] `npm ci` completes from the committed lockfile without changing it.
- [ ] Tests, repository checks, and GitHub action metadata validation pass for
  the exact candidate.
- [ ] Review findings and required CI checks converge on the published PR head.
- [ ] Finish-work validates the completion bundle, archives this task, records
  the session journal, and leaves the merged repository clean and synced.

## Notes

- This is a lightweight fleet-maintenance task; the immutable release and the
  fleet manifest define the implementation boundary.
