# Bind copilot-route review evidence to the dispatch that caused it

## Goal

A routed review that did not cause the Copilot review it is reading must say so.
Today `dispatch.status: "already-present"` and `dispatch.status: "requested"`
produce identical remote confidence, so a review summoned by the repository
ruleset or by the `PostToolUse` hook is reported as the routed lane's own
evidence.

This is an upstream change to the SD AI command pack. `scripts/` no longer
carries the pack executables — since the thin conversion they live in the
machine install at `~/.agents/bin`, and `pack.install-audit` fails any local
edit — so the fix does not land in this repository. What lands here is the spec
record and the verification evidence.

## Background

The Action already computes the discriminator and already writes it to the
receipt. The coordinator already validates it and then throws it away.

**The Action distinguishes the two cases.** `requestCopilotReviewer`
(`src/reviewer-dispatch.js:9-44`) checks the requested-reviewer set and the
reviews on the head commit first, and requests the reviewer only when neither
shows Copilot present. It returns `requested: false` when the reviewer was
already there. `src/operations.js:418-431` passes that through as
`alreadyPresent: !dispatch.requested`, and `src/receipt.js:694` records it:

```js
status: alreadyPresent ? "already-present" : "requested",
```

**The coordinator validates the field and ignores it.**
`~/.agents/bin/sd-ai-command-pack-review.py:1230` accepts the enum
`{requested, already-present, failed, skipped}`; `:1321` and `:2198` branch on
`failed` only. Nothing branches on `already-present`. Review findings are then
harvested by author and head commit alone:

```python
# :1604-1616
if _matching_author(row, authors) is not None
   and row.get("commit_id") == pr["head"]
   and row.get("state") != "DISMISSED"
```

Conversation comments carry a temporal guard — `created_at >=
dispatch.startedAt` (`:1589-1603`) — and reviews carry none.

**Why this is not hypothetical here.** The `main` ruleset's
`copilot_code_review` rule requested Copilot on PR #86 one second after the pull
request opened, twenty-two seconds before the Action routed
(`.trellis/spec/backend/consumer-installer.md`, "Three channels can request
Copilot, not two"). Every routed `copilot` review in this repository therefore
observes `alreadyPresent` and reports full remote confidence for a review it did
not cause.

**Why a timestamp guard is the wrong fix.** The obvious symmetric change — guard
reviews by `submitted_at >= dispatch.startedAt` the way comments are guarded —
does not discriminate the case that matters. The ruleset requests early but
Copilot *submits* its review well after the dispatch started, so a timestamp
guard admits the foreign review anyway. `dispatch.status` is the field that
already knows the answer.

**Why the answer is not "reject already-present evidence".** That would make the
copilot route report zero remote evidence in this repository, permanently. The
piggyback is deliberate: the retained ruleset is what summons the reviewer while
the Action's route stays the durable record of what *should* review the change
(same spec section). The receipt must qualify its confidence, not discard the
finding.

## Requirements

- A receipt whose `dispatch.status` is `already-present` must report remote
  evidence that is explicitly marked as not caused by this dispatch. The
  findings themselves are still surfaced; the confidence claim is what changes.
- A receipt whose `dispatch.status` is `requested` keeps today's behaviour
  unchanged.
- Do not drop findings. A real Copilot finding must never become invisible
  because of this change — the failure mode being fixed is overclaimed
  confidence, not oversupplied evidence.
- Do not license a direct reviewer fallback. Qualified confidence is not a
  reason to request a reviewer outside the lane.
- Do not widen receipt matching. `external_id == logicalDispatchId` plus the
  correlation-id check stay as they are.
- The new state must be legible in `sd-review` output without reading the
  receipt JSON by hand.

## Acceptance criteria

- [x] A routed `copilot` review whose receipt carries
      `dispatch.status: "already-present"` reports its remote findings together
      with an explicit limitation naming the evidence as not dispatch-caused.
      — `remote-evidence-not-dispatch-caused`, attached to all four terminal
      reports after remote observation. Unit-proven by
      `test_already_present_dispatch_qualifies_remote_confidence`
      (sd-ai-command-pack PR #481). Live end-to-end proof pending the pack
      refresh; see the verification note below.
- [x] The same review with `dispatch.status: "requested"` reports no such
      limitation and is otherwise unchanged from today.
      — `test_requested_dispatch_claims_remote_confidence` asserts
      `limitations == []`; `qualifiers` is empty on that path so no existing
      report changes.
- [x] Findings counted under `already-present` are identical in content to what
      is reported today; only the confidence framing differs.
      — `test_dispatch_status_does_not_change_harvested_findings` runs
      `_collect_observation` twice against receipts differing only in
      `dispatch.status` and asserts the observations are equal.
- [x] Regression coverage upstream drives both statuses through the real
      two-write receipt shape the lane produces, not a synthesized terminal
      write.
      — all three tests use `phases = iter([None, "started", "observed"])` via
      `run_routed_review_with_dispatch_status`.
- [x] `.trellis/spec/backend/consumer-installer.md` records what a copilot
      receipt does and does not prove about who requested the review.
      — "What a copilot receipt does and does not prove", with the
      proves / does-not-prove / closes-the-gap split and a receipt-to-reading
      table.

**Verification note.** Criteria 1 through 4 are proven by upstream unit tests at
sd-ai-command-pack `0.71.23`; the local gate there ran 2,619 tests with 0
failures and 0 skips. What is *not* yet proven is the live path: a real routed
`sd-review scope=pr` in this repository printing
`Limitations: remote-evidence-not-dispatch-caused` beside real Copilot findings.
That requires the pack release and a consumer refresh off `0.71.22`. Do not
treat this task as fully closed, or the parent's cross-child criterion as met,
until that run is recorded.

## Notes

Ordering: the sibling `08-15-retire-direct-request-hook` is preferred first. It
removes the hook as a possible requester, which leaves exactly two channels and
makes the `already-present` reading unambiguous during verification. Not a hard
dependency.

The parent `08-16-remote-review-attribution` owns the cross-child criterion that
a shipped pull request reports a remote-review state matching what actually
reviewed it.
