# Routed-Review Runtime Pilot And Handoff Implementation Plan

## Execution Order

1. Verify all dependency PRs and exact source candidate CI.
2. Obtain explicit authority for private-pilot writes; prepare the sanitized
   scenario ledger before running workflows.
3. Run setup discovery, route/override, native/external, replay/rerequest,
   ambiguity, local-evidence/floor, and successor matrices in bounded order.
4. Record only sanitized evidence and test rollback/disable behavior.
5. Update source docs/task evidence and ship the repo-local evidence PR.
6. Obtain separate approval before creating any command-pack handoff PR;
   otherwise provide a paste-ready immutable handoff.

## Validation Plan

- Verify source/pilot head and workflow run URLs for each scenario.
- Query durable receipts and GraphQL review threads directly.
- Run repository tests, metadata/check/install gates, and source CI.
- Confirm no public artifact includes forbidden pilot data.

## Documentation And Spec Updates

Update release/pilot guidance only where live evidence changes the operating
contract. Do not restate the backlog in live docs.

## Review Notes

- Check external-write approvals and secret/PR-code boundaries first.
- Check every rerun for same-identity reconciliation rather than duplicate
  dispatch.
- Treat missing upstream authority as a handoff blocker, not permission to
  create a command-pack PR.

## Rollback Points

Disable the pilot workflow, revoke pilot-only credentials, and preserve
receipts for reconciliation. Never move an immutable published tag or issue a
fallback reviewer request after an ambiguous result.

## Follow-Ups

The command-pack consumer implementation remains upstream-owned. Record any
consumer defect there only after explicit upstream task/PR authority.
