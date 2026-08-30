---
title: Refresh sd-ai-command-pack to 0.71.62
status: done
created: 2026-08-28
branch: chore/pack-refresh-0.71.62
---
# Refresh sd-ai-command-pack to 0.71.62

## Goal

Fleet refresh: install sd-ai-command-pack v0.71.62 (tag `v0.71.62` @ `3f5c434c9d8dc2ad78a5bd34d0de7bdba7ac9096`, payload `sha256:b58199c689c580b77d4b520a6de12e5032776d869c5db8d2ce56a87f5347400f`) into sd-github-review, advancing the thin pin from 0.71.60. Managed scope: installer-managed platform files (claude, gemini, github, opencode), the installer-managed `AGENTS.md` entry-point block, receipts, and provenance only; no product-code edits. Preparation runs `npm ci`. Checks: `npm test`, `npm run check`, `npm run validate:metadata`. Gate: `npm run check:full`. Bound to refresh branch `chore/pack-refresh-0.71.62` off base `b30983044daa2254a45832b939f6c6bb54b4e532`. Completion: PR opened, review converged, CI green, merged via housekeeping, post-merge audit confirms 0.71.62.

## Requirements

- Install sd-ai-command-pack v0.71.62 (tag `v0.71.62` @ `3f5c434c9d8dc2ad78a5bd34d0de7bdba7ac9096`, payload `sha256:b58199c689c580b77d4b520a6de12e5032776d869c5db8d2ce56a87f5347400f`) for exactly the claude, gemini, github, and opencode platforms recorded in the fleet manifest. As a converted consumer its platform set is owned by the thin pin, so the printed install command carries no platform flag.
- Carry the two releases between the installed 0.71.60 and this target. Both are pack-internal review-tooling corrections with no consumer-visible product surface. 0.71.61 added a built-in `codex` local-review adapter as the first default lane and made a sole unavailable provider fall through to the next cheapest eligible one instead of ending a run with no review. 0.71.62 stopped review-thread collection from conflating a GitHub App with the like-named human account, made the 1000-row pagination cap count rows read rather than rows kept, and narrowed the emptied-set consistency guard to report a contradiction only when the other transport still holds a matching comment. The `AGENTS.md` entry-point block this consumer already carries arrived in 0.71.60 and is unchanged here.
- Limit the diff to installer-managed platform files, the `AGENTS.md` managed block, `.sd-ai-command-pack/` manifest and provenance receipts, and this task's own `.trellis/` bookkeeping. No product-code edits.
- Run the manifest-ordered preparation `npm ci` before the local gate.
- Keep the refresh on branch `chore/pack-refresh-0.71.62` off base `b30983044daa2254a45832b939f6c6bb54b4e532`, published as a single PR.
- Carry no `trellis update` diff. Trellis version drift is owned separately; a mixed PR stops the lane instead of merging.

## Acceptance Criteria

- [x] <!-- verify: install-audit release=0.71.62 platforms=claude,gemini,github,opencode --> The sd-ai-command-pack install audit passes for all four expected platforms and reports installed payload provenance 0.71.62. It runs from the sd-ai-command-pack source checkout, not from this repository.
- [x] <!-- verify: lane-evidence id=check-command --> The manifest-ordered check commands `npm test`, `npm run check`, and `npm run validate:metadata` all pass.
- [x] <!-- verify: lane-evidence id=deterministic-gate --> `npm run check:full` passes, or its only findings are dispositioned through the fleet finding severity gate with zero blockers.
- [x] <!-- verify: bundle-shape --> The refresh is published as one PR whose head carries the work commit plus this task's archive and journal bookkeeping.

<!-- sd-ai-command-pack:criteria-disposition:start -->
> Every acceptance criterion was verified by the publish run.
<!-- sd-ai-command-pack:criteria-disposition:end -->

## Post-archive handoff

Owned by the fleet campaign after this task is archived, not by its acceptance
criteria: review convergence, CI settle, merge through the consumer
housekeeping gate, refresh-branch deletion, default-branch synchronization, and
the post-merge audit that confirms the installed pack version is 0.71.62.
