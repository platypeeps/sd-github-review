# v0.1.0 Release And Consumer Evidence

## Publication

- Approved immutable commit:
  `8636a3983d18de17c49907a4c48170a61b1bb713`
- Annotated tag: `v0.1.0`, created at `2026-07-24T22:54:36Z`
- Tag object target:
  `8636a3983d18de17c49907a4c48170a61b1bb713`
- GitHub release: published at `2026-07-24T22:54:51Z`
- Release URL:
  `https://github.com/platypeeps/sd-github-review/releases/tag/v0.1.0`

The tag is an annotated tag whose target type is `commit`; the release is
neither a draft nor a prerelease. The tag and release were absent during the
immediate preflight and were created without moving or replacing prior state.

## Released-SHA Consumer Smoke

The private pilot repository's standalone and durable workflows were already
pinned to the released full SHA. A trusted `/review deep` comment on pilot PR
`#3` triggered a fresh provider-free standalone run after publication:

- Workflow run:
  `https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30132372458`
- Route job: `89609360380`, completed successfully
- Pilot pull-request head:
  `bd53cf5c183a8972a19f3c57db025f549806f661`
- Selected route: `deep`
- Selected model: `pilot-deep`
- External-adapter flag: `true`

The run recorded routing outputs only. It did not invoke a provider.

## Disable And Restore Drill

After the smoke completed, standalone pilot workflow `317871946` was disabled
and verified as `disabled_manually`. It was then re-enabled and verified as
`active`. This proves the operational rollback control without deleting prior
runs or changing the immutable release pin.

## Public Evidence Boundary

After the smoke and rollback drill, the pilot still reported zero Actions
secrets and zero repository rulesets. Neither pilot workflow referenced a
checkout action or repository secret. This record contains no raw private event
payload, prompt, finding, source path, or provider credential.

The provider-free pilot and synthetic durable acknowledgment validate routing,
receipt, and rollback behavior. They do not validate live model quality,
provider billing, or a paid adapter runtime.
