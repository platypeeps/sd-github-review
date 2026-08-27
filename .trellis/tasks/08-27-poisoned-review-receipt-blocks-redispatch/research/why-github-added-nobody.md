# Why GitHub added no reviewer: the org has zero Copilot seats

Answers the PRD open question "Why did GitHub not add the reviewer on this
PR?" and corrects two earlier findings in this task's research.

## The measurement

```
GET /orgs/platypeeps/copilot/billing
  seat_breakdown: { total: 0, added_this_cycle: 0, active_this_cycle: 0,
                    pending_invitation: 0, pending_cancellation: 0 }
  seat_management_setting: "unconfigured"
  plan_type: "business"
```

Zero seats. `copilot-pull-request-reviewer[bot]` therefore cannot be assigned
as a reviewer on any pull request in this organization.

## The API-level reproduction

A direct request, bypassing this action entirely:

```
POST /repos/platypeeps/sd-github-review/pulls/157/requested_reviewers
     {"reviewers": ["Copilot"]}
  -> HTTP 200, body's "requested_reviewers": []
GET  .../pulls/157/requested_reviewers  -> {"users": [], "teams": []}
  timeline review_requested events: none
```

GitHub accepts the mutation and adds nobody. This is the exact behavior the
fix exists to detect, reproduced without any of this repository's code in the
path. It is not specific to a head SHA, a receipt, a diff shape, or a PR.

Both reviewer identities behave identically: `copilot-pull-request-reviewer[bot]`
(what `action.yml` posts) and `Copilot` (the login recorded in the
`review_requested` events of PRs that were reviewed). The identity is not the
discriminator.

## Corrections to earlier findings in this task

**`divergence-point.md` calls the GitHub behavior transient.** It is not. It
is the steady state whenever the org has no seat. The verification gap does
not convert a transient condition into a permanent stall; it hides a
permanent condition behind a green run.

**`blast-radius-audit.md` concluded the defect "has produced exactly one
instance" in 154 pull requests.** That framing does not survive this
evidence. The audit's own measurement stands — 148 merged and 5 closed PRs
all carry a Copilot review, and no merged PR shipped unreviewed — but "one
instance of the defect" was inferred, not measured.

What is established about the earlier PRs is narrower. On #151 the
`review_requested` event is at 21:56:26 and the router run started at
21:56:29; on #153 the event is at 15:12:25 and the runs at 15:13:54 and
18:20:14. On both, the reviewer request precedes the action's run, so the
action did not cause those events. #151 also has a separate `Running Copilot
Code Review` workflow run. Whether the action's own POST would additionally
have landed while seats existed is not determinable from this evidence, and
is not claimed either way.

## What this does and does not change about the fix

Nothing about the fix. A mutation that returns 2xx and adds nobody is exactly
what `landing=absent` names, and the API reproduction above is the cleanest
demonstration of it in this task. Under the fixed code every dispatch in this
condition fails loudly as `reconciliation-required` instead of reporting a
satisfied receipt.

It does change the remedy for the lane: restoring a Copilot seat is what
makes reviews happen again. No change in this repository can substitute for
it, and the fix's value is that it says so out loud instead of reporting
success.
