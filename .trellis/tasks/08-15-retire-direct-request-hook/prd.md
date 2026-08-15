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

**The routed lane cannot currently report `ready`.** A client-side receipt-cache
defect wedges every routed review at `remote-reconciliation-required`
(`08-15-review-receipt-cache-race`). That limits what the second criterion below
can mean today: an explicit, recorded limitation is an acceptable match, a
silent one is not.

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

- [ ] **Inherited:** the losing contract no longer fires in this repository, by
      configuration rather than by convention.
- [ ] **Inherited:** a PR shipped after the change reports a remote-review state
      that matches what reviewed it — either a router receipt with real remote
      confidence, or an explicit, recorded local-only limitation with no
      side-channel review happening behind it.
- [ ] The hook's scoping is by descriptor presence, and a repository without
      `config/routed-review-setup-v1.json` still gets the hook.

## Notes

If `08-15-review-receipt-cache-race` lands first, the second criterion can be
met by a genuine `ready` result rather than a recorded limitation. That ordering
is preferable but not required.
