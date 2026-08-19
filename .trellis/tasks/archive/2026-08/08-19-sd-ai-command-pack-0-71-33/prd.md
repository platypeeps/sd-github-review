# Refresh sd-ai-command-pack to 0.71.33

## Goal

Fleet refresh: install sd-ai-command-pack v0.71.33 (tag v0.71.33 @ 6c6d05a6450e1d52b22b0b08d8f275d4af358115, payload sha256:0fe1997c752034d6ce6231c235565ac7c79e8c369a42561f24ad1e9dbc67667a) into sd-github-review, replacing the 0.71.26 pin. Managed scope: installer-managed platform files (claude, gemini, github, opencode), receipts, and provenance only; no product-code edits. Prepare: npm ci. Check: npm test, npm run check, npm run validate:metadata. Bound to refresh branch chore/pack-refresh-0.71.33 off base 3e75da79a89ae5ecc170c4222c2a57b8be677da5. Completion: PR opened, remote review, CI green, merged via housekeeping, post-merge audit confirms 0.71.33.

## Requirements

- Install sd-ai-command-pack v0.71.33 (tag `v0.71.33` @ `6c6d05a6450e1d52b22b0b08d8f275d4af358115`, payload `sha256:0fe1997c752034d6ce6231c235565ac7c79e8c369a42561f24ad1e9dbc67667a`) for exactly the claude, gemini, github, and opencode platforms recorded in the fleet manifest. This consumer is a thin install: its platform set is owned by its pin, so the refresh carries no `--platform` flag.
- Limit the diff to installer-managed platform files, `.sd-ai-command-pack/` manifest and provenance receipts, and this task's own `.trellis/` bookkeeping. No product-code edits.
- Run this consumer's manifest-ordered commands in order: `npm ci` to prepare, then `npm test`, `npm run check`, and `npm run validate:metadata`.
- Run the repository's declared full local gate before publishing.
- Keep the refresh on branch `chore/pack-refresh-0.71.33` off base `3e75da79a89ae5ecc170c4222c2a57b8be677da5`, published as a single PR.
- Carry no `trellis update` diff. Trellis version drift is owned separately; a mixed PR stops the lane instead of merging.
- Leave the 18 pre-existing `planning` tasks in this repository untouched. This refresh owns only its own task directory.

## Acceptance Criteria

- [x] The pack install audit, run from the sd-ai-command-pack source checkout
  with `--repo` pointed at this repository, passes for all four expected
  platforms and reports installed payload provenance 0.71.33.
- [x] This consumer's manifest-ordered check commands pass after `npm ci`.
- [x] The declared full local gate passes, or its only findings are dispositioned through the fleet finding severity gate with zero blockers.
- [x] The refresh is committed as exactly one work commit on `chore/pack-refresh-0.71.33`, containing only installer-managed paths plus this task's own directory.
- [x] The 18 pre-existing `planning` tasks are unchanged by this refresh.

## Post-archive handoff

Owned by the fleet campaign after this task is archived, not by its acceptance
criteria: publish the branch as one PR whose head carries the work commit plus
this task's archive and journal bookkeeping, merge through the housekeeping
gate, delete the refresh branch, synchronize the default branch, and record the
post-merge install audit as the lane's `post-merge-verification` receipt.

## Local gate disposition

None required. The declared full local gate passes clean: every check reports
`passed`, with the Obsidian knowledge-base check skipped because this
repository has no knowledge base. The manifest-ordered commands also pass —
`npm ci`, then `npm test`, `npm run check`, and `npm run validate:metadata`,
each exiting zero — and the pack install audit reports 31 targets checked at
provenance 0.71.33 with matching vouched hashes.

Unlike the other consumers in this campaign, this repository carries no
pre-existing preflight debt, so no finding needed the fleet finding severity
gate.
