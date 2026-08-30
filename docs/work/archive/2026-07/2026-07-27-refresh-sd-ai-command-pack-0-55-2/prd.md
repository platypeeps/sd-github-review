---
title: Refresh sd-ai-command-pack to 0.55.2
status: done
created: 2026-07-27
branch: codex/refresh-sd-ai-command-pack-0-55-2
---
# Refresh sd-ai-command-pack to 0.55.2

## Goal

Install and verify the immutable sd-ai-command-pack 0.55.2 release for SD GitHub Review.

## Requirements

- Install only from the pinned immutable `sd-ai-command-pack` 0.55.2 release archive.
- Limit changes to this task, installer-managed payload and provenance, and deterministic preparation output required by the repository.
- Preserve repository-owned configuration and all unrelated work.
- Run the manifest preparation and candidate checks, the repository's full local gate, exact-head review and CI, and the normal finish-work and housekeeping lifecycle.

## Acceptance Criteria

- [ ] Installed provenance reports release 0.55.2 and the audit passes for every expected platform and managed target.
- [ ] Focused candidate checks and the repository's full local gate pass.
- [ ] The exact published head has no unresolved review findings and all required CI checks pass.
- [ ] The task is archived through finish-work and the merged default branch is clean and synchronized.

## Notes

- This is a lightweight rollout task; no design or implementation document is required.
