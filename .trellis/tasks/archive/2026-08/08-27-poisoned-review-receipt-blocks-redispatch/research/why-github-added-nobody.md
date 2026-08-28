# Why GitHub added nobody: the Copilot account hit its credit limit

Answers the PRD open question "Why did GitHub not add the reviewer on this
PR?" and corrects two earlier findings in this task's research.

## Cause

Copilot for these repositories is licensed by a **personal seat on the
`sdelmas` account**, not by an organization seat. That account recently
reached its credit limit. While credits are exhausted, GitHub accepts a
reviewer request for Copilot and adds nobody — no error, no event.

Owner-reported when first recorded, and not verifiable from this session's
REST access: no endpoint exposes personal Copilot entitlement or credit state,
and the token in use has no billing-admin scope. It was confirmed behaviourally
a few hours later, when the credits came back — see below.

It fits every observation from the outage. Copilot reviewed PRs in this
repository through 2026-08-26T16:07Z and none between then and the restore;
across that window the failure was uniform over pull requests, head SHAs, diff
shapes, and both reviewer identities; and nothing threw anywhere in the path.

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

## Confirmed by restoration, 2026-08-27

Credits were restored the same day, and the lane recovered without any change
to this repository:

```
POST /repos/platypeeps/sd-github-review/pulls/157/requested_reviewers
     {"reviewers": ["Copilot"]}
  -> timeline: 2026-08-27T22:48:57Z  sdelmas -> Copilot
  -> reviews:  copilot-pull-request-reviewer[bot]  COMMENTED
```

The review was clean: "Copilot reviewed 15 out of 17 changed files in this pull
request and generated no comments."

That is the discriminating test the earlier readings could not supply. The same
request, the same code, the same reviewer identity, minutes apart — refused
while credits were exhausted, accepted once they were not.

## What restoration did not fix: #156

#156 kept refusing after the restore. Five requests in total, spanning three
head SHAs (`de440b6`, `70379db`, and the later journal head) and both reviewer
identities, each returning HTTP 200 with no `review_requested` event, while
#157 succeeded as a control in the same minutes.

So the credit exhaustion explains the outage across the repository and does
**not** explain #156. Why that one PR is unreviewable was not established.
Hypothesis, recorded as a hypothesis and not tested: Copilot declines a pull
request with nothing to review, and #156 is a one-line change to a single
`.trellis/**` JSON file. No API surface found in this session reports a
reviewer's own decision to decline, so the hypothesis is not falsifiable from
here.

#156 was merged without a Copilot review by owner decision on 2026-08-27,
through the `sd-housekeeping` gate.

## Remedy

Restoring credits on the `sdelmas` account was the remedy, and it worked. No
change in this repository substitutes for it.

The fix's value is that it stops the lane from reporting success during such a
period: every dispatch fails loudly as `reconciliation-required` instead of
minting a satisfied receipt.
