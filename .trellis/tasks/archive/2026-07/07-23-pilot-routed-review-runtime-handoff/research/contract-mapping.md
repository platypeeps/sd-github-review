# Pilot And Handoff Contract Mapping

This task owns integrated evidence for archived R9-R11 and R16-R23. It consumes
the separate external-adapter validation result without reopening adapter
conformance work.

## Immutable Identities

- Runtime Action: `8636a3983d18de17c49907a4c48170a61b1bb713`
- Source baseline: `195faec46fa62341a43e0867c04d2ef188536cc4`
- Setup contract: `sd-github-review/setup@1`
- Review request, adapter request/acknowledgment, and receipt contract major: `1`

## Acceptance Map

| Acceptance criterion | Implementation or evidence source |
| --- | --- |
| Copilot and external adapter lifecycle | Native Copilot exact-head scenario plus one PR-Agent route, dispatch, acknowledgment, finding-channel, receipt, and new-head scenario |
| Replay, rerequest, conflict, ambiguity | Provider-free lifecycle matrix, reviewer-mutation counts, and one bounded PR-Agent replay/authorized attempt-2 pair |
| Local evidence, floors, successor heads | Provider-free request matrix covering clean, missing/failed, sensitive/large, bookkeeping-only, mixed, explicit, and required-floor cases |
| Setup discovery taxonomy | `config/routed-review-setup-v1.json`, `fixtures/setup/v1/discovery.json`, and metadata tests; no live dispatch |
| No PR code with credentials | Workflow metadata test, pilot step inventory, and absence of checkout/workspace mounts on the credentialed job |
| Immutable evidence and approvals | Sanitized scenario ledger, exact SHAs, run/Check Run URLs, limitations, rollback, private-pilot authority, and explicit no-upstream-authority note |
| Green repository state | Focused metadata test, full local gates, exact-head source CI, review-thread polling, and post-merge housekeeping |

## Public Evidence Allowlist

Each row may include only scenario ID, Action/source SHA, private PR number,
head SHA, route, backend ID/tier, receipt/logical IDs, phase, finding-channel
type, run or Check Run URL, pass/fail, limitation, and rollback state. Do not
copy request JSON, comments, findings, file names, prompts, source, workflow
logs, secret values, or provider configuration values.

## Authority Boundary

Private-pilot writes for this task are approved. No command-pack PR is
approved; the deliverable is a paste-ready handoff until separate authority is
given for that exact upstream PR.
