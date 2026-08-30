---
title: Retire the direct-request hook now that a receipt exists
status: done
created: 2026-08-15
---
# Retire the direct-request hook now that a receipt exists

## Goal

Stop the `PostToolUse` hook from requesting Copilot in repositories that carry
the routed-review setup descriptor, and confirm on a subsequent pull request
that the reported remote-review state matches what actually reviewed the change.

## Background

`08-15-prove-routed-lane` established the precondition this task was gated on: a
real durable receipt. On PR #86 the lane dispatched twice, published a
`sd-github-review/receipt` Check Run both times, and recorded
`selectedRoute: "copilot"` with backend `github-copilot`. The routed channel is
no longer hypothetical, so the competing channel can go.

Two facts change the shape of this task from what was originally planned.

**There are three channels, not two.** The `main` repository ruleset carries a
`copilot_code_review` rule that requested Copilot on PR #86 one second after the
pull request opened — twenty-two seconds before the Action routed. Retiring the
hook therefore does not make the Action the sole requester. That overlap was
reviewed and deliberately kept (`consumer-installer.md`, "Three channels can
request Copilot, not two"); this task removes the hook, not the ruleset.

**The routed lane can report `ready` again.** The client-side receipt-cache
defect that wedged every routed review at `remote-reconciliation-required` is
fixed and shipped: `_receipt_in_flight` re-queries a non-terminal cached receipt
inside the existing poll loop
(`~/.agents/bin/sd-ai-command-pack-review.py:2157-2190`), pinned here at
sd-ai-command-pack 0.71.22. `08-15-review-receipt-cache-race` is archived
completed. Verification of this task can therefore expect a genuine terminal
result rather than a recorded limitation.

**Retiring the hook does not make the reported state trustworthy on its own.**
The coordinator attributes Copilot review findings by author and head commit
alone (`sd-ai-command-pack-review.py:1604-1616`), with no branch on
`dispatch.status: "already-present"`, so the retained ruleset's review is still
counted as the routed lane's own evidence. That is the sibling task
`08-16-bind-copilot-review-evidence`. This task closes the contract collision;
it does not close the attribution collision, and the criteria below are scoped
accordingly.

## Requirements

- The hook edit lives in `~/.claude/settings.json`, outside this repository, and
  is the operator's to make. Scope it by the presence of
  `config/routed-review-setup-v1.json` so the change follows the descriptor
  rather than a hard-coded repository list.
- Do not remove the ruleset's `copilot_code_review` rule as part of this task.
  That is a separate policy decision and it was made the other way.
- Verification happens on a pull request opened after the hook change, not on
  the one that records it.

## Acceptance criteria

- [x] **Inherited:** the losing contract no longer fires in this repository, by
      configuration rather than by convention. Guard 4 in the `PostToolUse`
      command; two real pushes on `feat/retire-direct-request-hook` produced no
      hook output, where an identical push earlier in the same session, before
      the edit, emitted the direct-request instruction.
- [x] The hook's scoping is by descriptor presence, and a repository without
      `config/routed-review-setup-v1.json` still gets the hook. Six synthetic
      cases against the live extracted command string, plus the
      `CLAUDE_PROJECT_DIR` branch repeated with `.cwd` absent.
- [x] A pull request shipped after the change completes its review loop with no
      direct `requested_reviewers` call made by the agent, and the only
      reviewer requests visible on it come from the routed Action or the
      retained ruleset. PR #92: one `review_requested` timeline event, actor
      `sdelmas` requesting Copilot — the ruleset. Copilot reviewed, raised one
      finding, it was fixed and the thread resolved.
- [x] The hook change is verified against the actual hook contract — a real
      `PostToolUse` payload shape, run in both a descriptor-carrying and a
      descriptor-free repository — not by reading the edited command string.
      A probe hook captured the real payload first (`CLAUDE_PROJECT_DIR`,
      `.cwd`, and `$PWD` all resolve to the project root), and the live command
      string was extracted from settings and run against payloads for both
      repository kinds. **Limitation:** the descriptor-free side was exercised
      synthetically. No real push was made from a descriptor-free repository, so
      "the hook still fires elsewhere" rests on cases 2–4 rather than a live
      observation.

## Notes

The inherited criterion "a PR reports a remote-review state that matches what
reviewed it" moved up to the parent `08-16-remote-review-attribution`. Retiring
the hook is necessary for it and not sufficient: the retained ruleset can still
supply the review the receipt claims as its own, which is the sibling task
`08-16-bind-copilot-review-evidence`.
