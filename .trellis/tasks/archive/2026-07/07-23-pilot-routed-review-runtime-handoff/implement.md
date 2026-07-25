# Routed-Review Runtime Pilot And Handoff Implementation Plan

## Execution Order

1. Verify archived dependencies, immutable Action/source identities, and the
   recorded private-pilot authority. Record that no upstream PR is authorized.
2. Add the existing runtime controls `rerequest-authorized` and
   `independent-review-floor` to both on-demand workflow examples. Update the
   metadata tests and durable PR-Agent setup guidance together.
3. Run focused workflow-metadata tests and the full local source gate before
   copying the reviewed durable PR-Agent workflow to the private pilot.
4. Prepare the sanitized scenario ledger before any live run. Validate setup
   discovery through source fixtures/tests without secrets or dispatch.
5. Run provider-free route/override, replay, conflict, ambiguity,
   local-evidence/floor, and successor scenarios first. Assert receipt identity
   and reviewer-mutation counts after each state transition.
6. Run one bounded PR-Agent selection/dispatch/acknowledgment/finalization
   scenario, replay it without another provider call, then run one authorized
   same-head attempt-2 rerequest. Reuse or refresh native Copilot exact-head and
   new-head evidence without exposing review contents.
7. Record only allow-listed evidence fields, verify no PR-controlled code ran
   with credentials, and document the disable/revocation rollback.
8. Ship the repo-local examples/docs/evidence PR through exact-head review and
   merge. Prepare a paste-ready immutable command-pack handoff; do not create
   its upstream PR without separate approval.

## Validation Plan

- Verify source/pilot head and workflow run URLs for each scenario.
- Query durable receipts and GraphQL review threads directly.
- Compare receipt and observable reviewer-mutation counts before/after replay,
  conflict, and rerequest scenarios.
- Run `node --test test/metadata.test.js`, `npm test`, `npm run check`,
  `npm run validate:metadata`,
  `python3 scripts/sd-ai-command-pack-install-audit.py`, and
  `git diff --check`.
- Run repository tests, metadata/check/install gates, and source CI.
- Confirm no public artifact includes forbidden pilot data.

## Documentation And Spec Updates

Update `SETUP-PR-AGENT.md` for the new dispatch controls. Update
`docs/RELEASE_CHECKLIST.md` only where live evidence changes the operating
contract. Do not restate the backlog in live docs.

## Review Notes

- Check external-write approvals and secret/PR-code boundaries first.
- Check every rerun for same-identity reconciliation rather than duplicate
  dispatch.
- Check both workflow examples retain identical control names/defaults and
  pass the values only to the route/query Action call.
- Treat missing upstream authority as a handoff blocker, not permission to
  create a command-pack PR.

## Rollback Points

Disable the pilot workflow, remove the pilot backend variables, revoke the
pilot-only credential, and preserve receipts for reconciliation. Never move an
immutable published tag or issue a fallback reviewer request after an
ambiguous result.

## Follow-Ups

The command-pack consumer implementation remains upstream-owned. Record any
consumer defect there only after explicit upstream task/PR authority.
