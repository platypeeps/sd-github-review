# Resolve OpenCode plugin dependency

## Goal

Remove the unused nested OpenCode dependency or make its installation reproducible and auditable.

## Background

Audit finding A-016 was recorded at repository head `2eeca60` with the following evidence:

- `.opencode/package.json:2` declares `@opencode-ai/plugin` with a range.
- No nested lockfile exists and the declaration is the only repository reference.

## Requirements

- Verify whether OpenCode loads the dependency implicitly from this manifest.
- Remove the manifest dependency if the installed adapter works without it.
- If required, pin the supported version through a committed lockfile and frozen installation path.
- Include the nested resolved tree in dependency and license auditing.

## Acceptance Criteria

- [ ] The chosen need/no-need decision is documented with an executable probe.
- [ ] Retained dependencies install reproducibly and are covered by audit output.
- [ ] Removing the dependency preserves OpenCode plugin/session behavior in a smoke test.
- [ ] Root package dependency claims remain accurate.

## Dependencies

- Parent remediation task `07-25-remediate-repo-audit-2eeca60`.
- Coordinate with any active routed-review task touching the same files before implementation.

## Out of Scope

- Findings other than A-016; their owning tasks remain independently deliverable.
- Starting implementation as part of audit-task creation.
