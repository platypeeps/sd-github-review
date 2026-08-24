# The lanes over-grant `issues: write`, and nothing needs it

## The question this task was created to answer, and its answer

Carried forward from `08-22-fleet-reviewer-v050-defects`, which parked it:

> In the **durable** lane, PR-Agent is isolated in its own `pr-agent` job holding
> `contents: read, pull-requests: write` and **no** `issues: write`. In the
> **router** lane it shares a job that has `issues: write`. The two lanes give
> the same container different permissions for the same task.
>
> If PR-Agent needs `issues: write` to post a conversation comment, the durable
> lane cannot publish findings at `cheap`/`deep` — which is precisely what the
> `mezmo_benchmark` #522 reviewer claimed. If a PR conversation comment is
> covered by `pull-requests: write`, then the router's grant is dead and the
> isolation comment naming `issues: write` is misleading.

That task recorded this as needing "a live PR-Agent run on the durable lane at
`cheap` or `deep`" and therefore the credentialed pilot behind
`docs/RELEASE_CHECKLIST.md` §2. **That was wrong, and it is worth being precise
about why, because the same mistake is easy to repeat.** The question is not
"what does PR-Agent do" — it is "what does a GitHub Actions token holding
`contents: read` + `pull-requests: write` permit". PR-Agent is irrelevant to it.
The permission boundary can be probed directly, with no container, no provider
key, and no spend.

**Answered 2026-08-23 by direct probe.** A job in
`platypeeps/sd-github-review-pilot` granted exactly the durable lane's
`pr-agent` permissions — `contents: read`, `pull-requests: write`, no
`issues: write` — successfully exercised both channels against a pull request
(run 32623601322):

```
RESULT_COMMENT=SUFFICIENT
RESULT_LABEL=SUFFICIENT
```

The comment was confirmed present on the pull request afterwards, so this is not
a silent no-op:

```
github-actions[bot] | PROBE: posted from a job holding contents:read + pull-requests:write, no issues:write.
```

Labels were probed as well as comments because labels are issue-scoped in
GitHub's REST API (`POST /repos/{o}/{r}/issues/{n}/labels`) and PR-Agent's
`review` command can apply them. Both are covered by `pull-requests: write`
when the target is a pull request.

A second probe (run 32623799937) swept the remaining issue-scoped endpoints
PR-Agent could plausibly reach, from a job with the same reduced grant:

```
PROBE LIST_COMMENTS=SUFFICIENT
PROBE REACTION=SUFFICIENT
PROBE ISSUE_EVENTS=SUFFICIENT
PROBE UPDATE_COMMENT=SUFFICIENT
```

The rule this establishes is general, and stating it is more useful than the
four results: **on a pull request, `pull-requests: write` covers the
`/issues/...` REST paths.** The `/issues/` prefix reflects that GitHub models
pull requests as issues in the REST layout; it does not mean the `issues`
permission scope governs them. That mismatch between REST path and permission
scope is the entire reason this was believed, and it is why reading the path
was never going to settle it.

### What follows

1. **The `mezmo_benchmark` #522 claim is false.** The durable lane *can* publish
   findings at `cheap`/`deep`. Its `pr-agent` isolation costs nothing.
2. **The router lane's `issues: write` is a dead grant.**
3. **`issues: write` on the durable lane's `review` and `finalize` jobs is also
   dead.** The action's entire request surface, enumerated from `src/github.js`
   rather than restated, is `/pulls`, `/compare`, `/check-runs`, and
   `/requested_reviewers`. There is no `/issues` path and no reactions call
   anywhere in `src/`, and no shipped lane has a `run:` step touching issues or
   labels.
4. **D1's original finding was directionally inverted.** Three consumer pull
   requests reported "the descriptor under-declares `issues: write`". The
   descriptor was right; the *lanes* over-grant. Attempting the reported fix
   correctly failed `assertSetupContract`.

## Goal

Remove the dead `issues: write` grant from every shipped lane, correct the
documentation that claims it is required, and add the gate that keeps lane
permissions and the setup descriptor from drifting again.

## Why this matters beyond tidiness

The descriptor is what a consumer provisions permissions *from*. Today a careful
operator reading `SETUP-PR-AGENT.md` grants `issues: write` to a workflow that
runs a third-party container, on the documented grounds that the container needs
it to publish. It does not. Every consumer that followed those instructions is
handing a pinned-but-third-party image a write scope over every issue in the
repository, for no functional reason.

This is the same class of finding as D2 — a stated security property that the
implementation does not actually hold — inverted. D2 was a bound that did not
bind. This is a grant that does not grant anything needed.

## Requirements

- Remove `issues: write` from all eight occurrences across the shipped lanes,
  enumerated from the filesystem rather than from this list.
- Correct `SETUP-PR-AGENT.md` (two places) and `DESIGN.md` (one), which state
  the grant is required for PR-Agent's comment channel.
- Add the lane-versus-descriptor permission-union gate that `08-22`'s Phase 1
  specified. It was impossible then because it would have had to accept a
  descriptor the contract rejects; with the lanes corrected, the union and
  `requiredPermissions` agree and the gate can be set-equality.
- The gate must fail in **both** directions and be proven by mutation, not
  first observed passing.
- No consumer may be left with a lane that grants more than the descriptor
  declares.

## Acceptance criteria

- [x] No shipped lane grants `issues: write`, verified by a repo-wide sweep that
      enumerates lanes from disk.
      `grep -rn 'issues: *write' examples/ .github/workflows/` returns only
      explanatory comments, no grant lines (2026-08-23).
- [x] A gate fails when a lane requests a permission the descriptor omits, and
      when the descriptor declares one no lane requests. Proven by mutation in
      both directions.
      `npm test` 751 pass / 0 fail; `npm run validate:metadata` validated
      action.yml, 3 workflows, 7 examples, 1160 tracked public paths.
- [x] `SETUP-PR-AGENT.md` and `DESIGN.md` no longer claim `issues: write` is
      needed for the comment channel, and cite what actually covers it.
      `SETUP-PR-AGENT.md:342` now reads "**not** required and should not be"
      selected.
- [ ] A live run on the durable lane at `cheap` or `deep` confirms PR-Agent
      still publishes with the reduced grant. **This one requires the
      credentialed pilot and the owner's approval under
      `docs/RELEASE_CHECKLIST.md` §2.** The permission probe settles the
      *permission* question; it does not prove PR-Agent's own behaviour end to
      end. If approval is withheld, this criterion is recorded unmet rather
      than quietly satisfied by the probe.
      **UNMET.** Approval was never given, so Phase 5 never opened. Carried
      forward parked to
      `.trellis/tasks/08-23-pr-agent-reduced-grant-live-confirmation/`, whose
      unpark trigger is any consumer moving off `copilot`. Not waived, not
      satisfied by the probes.
- [x] The fleet carries the reduced grant, verified from each default branch.
      9 of 9 at pin `6ba1eff` with zero `issues: write`, enumerated from each
      default branch's `.github/workflows/sd-review.yml` on 2026-08-24. Table
      in `implement.md` Phase 6.

## Out of scope

- Changing what PR-Agent is invoked with, its pinned digest, or its model
  configuration.
- The `checks: write` boundary between the receipt jobs and the reviewer job.
  That isolation is load-bearing and unaffected: `pr-agent` still holds no
  `checks: write`, so a compromised reviewer still cannot forge receipts.
