# Why GitHub added nobody: the Copilot account hit its credit limit

Answers the PRD open question "Why did GitHub not add the reviewer on this
PR?" and corrects two earlier findings in this task's research.

## Cause

Copilot for these repositories is licensed by a **personal seat on the
`sdelmas` account**, not by an organization seat. That account recently
reached its credit limit. While credits are exhausted, GitHub accepts a
reviewer request for Copilot and adds nobody — no error, no event.

Owner-reported, and not independently verifiable from this session: no REST
endpoint exposes personal Copilot entitlement or credit state, and the token
in use has no billing-admin scope.

It fits every observation. Copilot reviewed PRs in this repository through
2026-08-26T16:07Z and none after; the failure is uniform across pull
requests, head SHAs, diff shapes, and both reviewer identities; and nothing
throws anywhere in the path.

## The API-level reproduction

A direct request, bypassing this action entirely:

```
POST /repos/platypeeps/sd-github-review/pulls/157/requested_reviewers
     {"reviewers": ["Copilot"]}
  -> HTTP 200, body's "requested_reviewers": []
GET  .../pulls/157/requested_reviewers  -> {"users": [], "teams": []}
  timeline review_requested events: none
```

GitHub accepts the mutation and adds nobody, with none of this repository's
code in the path. Both `copilot-pull-request-reviewer[bot]` (what `action.yml`
posts) and `Copilot` (the login in the `review_requested` events of PRs that
were reviewed) behave identically, so the reviewer identity is not the
discriminator.

This is the cleanest demonstration in this task of the behavior the fix
exists to detect: a mutation that returns 2xx having added nobody is exactly
`landing=absent`.

## A measurement that is not the cause

`/orgs/platypeeps/copilot/billing` reports `seat_breakdown.total: 0` and
`seat_management_setting: "unconfigured"`, and
`/orgs/platypeeps/members/sdelmas/copilot` returns 404 "No seat found for
this user in this organization."

An earlier version of this file named that as the root cause. It is not.
Those readings are the normal steady state when the entitlement is a personal
seat — an organization seat was never assigned, including on 2026-08-25 and
2026-08-26 while Copilot was reviewing pull requests here normally. A
condition that was equally true while the lane worked cannot explain why it
stopped. Recorded here so the same wrong inference is not drawn from the same
endpoint later.

## Corrections to other findings in this task

**`divergence-point.md` calls the GitHub behavior transient.** Wrong in the
sense meant there — it does not clear on retry, and a re-POST at a fresh head
was tried and changed nothing. It is a sustained condition with an external
cause. The verification gap does not convert a transient failure into a
permanent stall; it hides a sustained one behind a green run.

**`blast-radius-audit.md` concluded the defect had "exactly one instance" in
154 pull requests.** The audit's measurement stands — 148 merged and 5 closed
PRs all carry a Copilot review, and no merged PR shipped unreviewed — but it
counts reviews that exist, not dispatches that landed, and those are not the
same thing. On #151 the `review_requested` event is at 21:56:26 with the
router run starting 21:56:29; on #153 the event is at 15:12:25 with runs at
15:13:54 and 18:20:14. On both, the request precedes the action's run, so the
action did not cause those events. How often the action's own POST landed is
not measured by that audit and is not knowable from it.

## Remedy

Restore Copilot credits on the `sdelmas` account, or wait for the quota
cycle to reset. No change in this repository substitutes for it.

The fix's value here is precisely that it stops the lane from reporting
success during such a period: every dispatch fails loudly as
`reconciliation-required` instead of minting a satisfied receipt.
