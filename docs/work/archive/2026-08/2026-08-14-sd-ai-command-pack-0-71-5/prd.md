---
title: sd-ai-command-pack 0.71.5 refresh
status: done
created: 2026-08-14
branch: chore/sd-ai-command-pack-0.71.5
---
# sd-ai-command-pack 0.71.5 refresh

## Goal

Install sd-ai-command-pack 0.71.5 in sd-github-review, replacing the installed 0.71.4, as
part of fleet campaign `refresh-0.71.5-20260814T113545Z`.

## Release identity

- Release: `0.71.5`
- Source: `platypeeps/sd-ai-command-pack`, tag `v0.71.5`, commit
  `e115c70f30efd802016c7fd19611888542d631cb`
- Payload digest: `sha256:365af6fe78f329be172605c60cbd38bbf1b504c071c09da17c6435490562d39c`
- Installed version before this refresh: `0.71.4`
- Base commit: `f11f3237a7e6c2a0d91449830cf307ef35713609` on `main`

## What 0.71.5 corrects

A tracked install refused every pack file whose template had changed since the
installed release, reporting it as a conflict that only `--force` could clear,
in checkouts nobody had touched. The installer compared the destination against
the new payload and never read the per-target digest in
`.sd-ai-command-pack/provenance.json` that proves the previous release wrote
exactly those bytes. Taking a release therefore required the one flag that also
discards genuine local edits.

A target whose bytes provenance vouches now installs as `updated`, without
`--force` and without a backup. Unvouched content, a target missing from
provenance, and provenance that is absent, symlinked, or malformed all still
conflict, so real local drift is unaffected.

## Evidence from this refresh

The refresh reported no conflicts and needed no `--force`:

```
updated     docs/SD_AI_COMMAND_PACK.md
updated     .agents/skills/sd-help/references/command-catalog.md
updated     .claude/skills/sd-help/references/command-catalog.md
updated     .sd-ai-command-pack/manifest.json
updated     .sd-ai-command-pack/provenance.json
```

The audit reports `preserved=1, unchanged=198`. The preserved target is
`.github/PULL_REQUEST_TEMPLATE.md`, which this repository owns locally and the
installer never updates automatically.

Every lane of the preceding 0.71.4 campaign, this consumer included, reported
its changed always-files as conflicts and completed only under `--force`.

## Managed scope

This refresh changes only installer-managed pack files and this task's own
artifacts:

- pack installer targets recorded in `.sd-ai-command-pack/manifest.json`
- `.sd-ai-command-pack/` provenance and installed-target records
- this task's own directory, which finalization archives under
  `.trellis/tasks/archive/` before the pull request is opened
- `.trellis/workspace/**` journal and index entries

No sd-github-review product code is edited.

## Preparation and check commands

- Prepare: `npm ci` (dependency install only; it produces no committed output)
- Candidate check: `npm test, npm run check, and npm run validate:metadata`
- Local gate: the installed typed `sd-check` coordinator

## Requirements

- Install 0.71.5 over 0.71.4 without touching product code.
- Keep the working tree free of changes outside the managed scope above.
- Publish the refresh on `chore/sd-ai-command-pack-0.71.5` and open a PR
  targeting `main`.

## Acceptance Criteria

- [x] `.sd-ai-command-pack/provenance.json` reports version `0.71.5`.
- [x] The install audit passes with every recorded target verified.
- [x] The refresh completes with no conflict and no `--force`.
- [x] The candidate check passes.
- [x] The typed `sd-check` gate passes.
- [x] The refresh diff contains no path outside the managed scope.
- [x] The refresh is committed on `chore/sd-ai-command-pack-0.71.5` with the
      release identity recorded in the commit message.

## Post-archive handoff

Publishing the pull request against `main`, its review, the gated merge, branch
deletion, and the campaign's post-merge verification all happen after this task
is archived. They belong to the fleet campaign, not to these criteria.

