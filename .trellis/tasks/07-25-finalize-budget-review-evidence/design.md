# Budget Review Evidence Finalization Design

## Boundary

This child consumes one durable authorization plus one bounded adapter outcome.
It validates provenance, links private reconciliation, advances the receipt,
and publishes the stable assurance/gate Check and status interfaces. It does
not select or execute a candidate.

Final state is monotonic and exact-head-bound. Unknown usage remains unknown;
ambiguous, model-mismatch, and prompt-profile-mismatch outcomes remain visible.
Status, pending, explain, recovery, and discovery expose profile identity and
other bounded facts over durable evidence, never private profile values.

Review assurance and budget accounting are separate axes. A completed review
with soft `budget_overrun` may remain successful. `incomplete_token_limit`
and hard `policy_violation` are non-success outcomes; neither can trigger
fallback after dispatch. Receipts expose bounded limit/usage/variance/pool state
but no partial reviewer output or request content.

Merge authorization is a third independent axis. Proven pre-dispatch budget
exhaustion records `reviewOutcome=deferred_budget` and
`assuranceOutcome=deferred`; the lane's explicit
`budgetExhaustion.merge=allow|block` alone determines
`gateOutcome=pass|block`. Every other non-assurance outcome blocks.

`sd-review / assurance` is the truthful signal: `success` for satisfied,
`action_required` for deferred, and a failure conclusion for terminal
non-assurance. `sd-review / gate` is the only branch-protection requirement:
`success` means policy permits merge, not that a review completed. A deferred
pass is titled `Merge allowed; review assurance deferred`. `neutral` is used
only when review policy is genuinely inapplicable.

Every projection declares `mode`. Standalone receipts use
`budgetOutcome=not_managed` and advertise no budget, pending, recovery,
quarantine, adjudication, or private-retention authority. Managed projections
preserve unavailable/unknown state and never synthesize standalone evidence
after a service failure.

Standalone local-attested projections additionally declare
`trustLevel=repository_attested`. Authorized, timely, exact-head clean evidence
records `reviewOutcome=completed_local` and may satisfy assurance; findings or
any terminal error block. Awaiting/new-head evidence is action-required plus a
blocking gate, never budget-deferred. Check copy never says GitHub ran or
independently verified the local reviewer.

Retention status is a bounded projection over private `standard-v1` state.
Purge is explicit, destructive, authorized, and idempotent; it never deletes
GitHub-native checks/comments/reviews or grants review authority. Receipts and
reports carry coverage gaps after compaction, expiry, or purge.

## Rollback

Receipts are historical evidence and are never rewritten by configuration
rollback. A superseding recovery is a new linked attempt. Exact-head Check
projections carry a monotonic revision and latest-authorized-attempt identity;
compare-and-swap updates prevent late older results from replacing newer
evidence. Setup diagnostics verify that only the stable gate Check is required
before the old branch-protection Check is retired.
