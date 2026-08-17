# Make the reported remote-review state match what actually reviewed the change

## Goal

A routed review in this repository reports remote confidence only for the review
its own dispatch caused, and no unsanctioned channel requests a reviewer behind
its back.

## Background

Three channels can request Copilot on a pull request here
(`.trellis/spec/backend/consumer-installer.md`, "Three channels can request
Copilot, not two"):

1. the routed Action, via `src/index.js:265-272`;
2. the `main` repository ruleset's `copilot_code_review` rule, which requested
   Copilot on PR #86 one second after the pull request opened, twenty-two
   seconds before the Action routed;
3. the user-global `PostToolUse` hook in `~/.claude/settings.json`, which fires
   after every successful `git push` and instructs the agent to request Copilot
   directly with `gh api ... /requested_reviewers`.

Channel 2 is deliberately kept. Channels 1 and 3 collide in two separate ways,
and only one of them is documented.

**The contract collision.** The hook tells the agent to make a direct reviewer
request; `~/.agents/skills/sd-review/SKILL.md:14-15` forbids exactly that. Both
fired on PR #81, and the forbidden channel found the defect the sanctioned one
missed. Recorded in `08-15-remote-review-channel-authority`; retiring the hook
is what closes it.

**The attribution collision.** The copilot receipt declares
`reviewAuthors: ["copilot-pull-request-reviewer[bot]"]`
(`src/operations.js:110-123`, default from `action.yml:117`). The coordinator
then harvests review findings by author and head commit alone:

```python
# ~/.agents/bin/sd-ai-command-pack-review.py:1604-1616
if _matching_author(row, authors) is not None
   and row.get("commit_id") == pr["head"]
   and row.get("state") != "DISMISSED"
```

There is no causal or temporal binding to the dispatch. Conversation comments
are guarded by `created_at >= dispatch.startedAt` (`:1589-1603`); reviews are
not guarded at all. So a review requested by channel 2 or channel 3 — same bot,
same head commit, possibly *before* the dispatch existed — is counted as the
routed lane's remote evidence, and the run reports remote confidence it did not
earn.

This is why the two deliverables belong under one parent. Retiring the hook
removes one of the two unsanctioned requesters but does not fix attribution,
because the ruleset stays. Fixing attribution makes the receipt honest but
leaves the contract contradiction in place. Neither child alone gets to the
goal.

## Requirements

- Both collisions are addressed by configuration and code, not by convention or
  by an instruction the agent is asked to remember.
- The ruleset's `copilot_code_review` rule is not removed. That policy decision
  was made the other way and this parent does not reopen it.
- Fail-closed behaviour is preserved throughout. Narrowing what counts as
  evidence must reduce false remote confidence, never suppress a real finding
  and never license a direct reviewer fallback.
- Each child is independently verifiable and archivable. Ordering, where it
  matters, is stated in the children's own artifacts.

## Task map

| Child | Deliverable |
|-------|-------------|
| `08-15-retire-direct-request-hook` | The `PostToolUse` hook stops requesting Copilot in repositories that carry the routed-review setup descriptor. Closes the contract collision. |
| `08-16-bind-copilot-review-evidence` | Copilot-route review evidence is bound to the dispatch that caused it. Closes the attribution collision. |

Preferred ordering is hook first, attribution second: the hook edit is cheap,
removes one variable from the evidence picture, and makes the attribution child's
verification easier to read. It is a preference, not a dependency — neither
child blocks the other.

## Acceptance criteria

- [x] A pull request shipped after both children reports a remote-review state
      that matches what actually reviewed it: either a receipt whose remote
      evidence is provably caused by its own dispatch, or an explicit recorded
      limitation with no side-channel review happening behind it.

      PR #93 exercised both halves of the disjunction across five live routed
      rounds. Round 2 (head `a8392a1`) reported `dispatch.status: "requested"`
      with `limitations: []` — the lane caused that review. Rounds 1, 3, 4 and 5
      reported `already-present` with
      `limitations: ["remote-evidence-not-dispatch-caused"]`, and the only other
      requester behind them was the retained `main` ruleset.

- [x] No channel outside the routed Action and the retained ruleset requests a
      reviewer in this repository.

      The `PostToolUse` hook's fourth guard fires here:
      `config/routed-review-setup-v1.json` is present at the repository root, so
      the hook exits before emitting its request instruction. Verified by
      evaluating the guard's own condition against this checkout.

- [x] A Copilot review that the routed dispatch did not cause is not counted as
      that dispatch's remote evidence.

      Shipped upstream as `platypeeps/sd-ai-command-pack#481` (0.71.24) and
      pinned here at 0.71.26. The claim is withdrawn by the limitation rather
      than the findings being dropped; upstream
      `test_dispatch_status_does_not_change_harvested_findings` runs the harvest
      twice against receipts differing only in `dispatch.status` and asserts the
      two observations are equal.

- [x] The three-channel picture in
      `.trellis/spec/backend/consumer-installer.md` is updated to state which
      channels remain, and what the receipt does and does not prove about who
      reviewed the change.

      Three sections carry it: "Three channels can request Copilot, not two"
      (:481), "The hook is now scoped out of durable-lane repositories" (:499,
      "Two channels remain here"), and the receipt-reading table (:573-575)
      mapping each `dispatch.status` to what it does and does not prove.

## Notes

The client-side receipt-cache wedge that blocked the earlier framing of this
work is fixed and shipped: `_receipt_in_flight` re-queries a non-terminal
cached receipt inside the existing poll loop
(`~/.agents/bin/sd-ai-command-pack-review.py:2157-2190`), pinned here at
sd-ai-command-pack 0.71.22. Routed reviews can reach a terminal state again, so
"an explicit recorded limitation" is no longer the only outcome available to
these criteria.
