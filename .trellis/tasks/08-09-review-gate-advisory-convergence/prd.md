# Local review gate cannot converge under advisory-mode prism findings

## Goal

Let `sd-review` terminate on its own when the configured local providers return observations
rather than defects, without weakening the gate for real findings.

## Problem

`_remote_gate` in `scripts/sd-ai-command-pack-review-local.py:1857` blocks on **any** finding:

```python
if outstanding or outcome == "findings":
    return {"state": "blocked", "reason": "actionable-local-findings"}
```

`.prism/rules.json` configures `focus` across eight categories — including `docs`,
`maintainability`, and `style` — plus a `review-recurrence-prevention` required rule. That
configuration is deliberate and produces useful signal, but most of what it produces is
commentary on the change rather than a defect in it. The two are indistinguishable to the gate.

### Observed on PR #70, 2026-08-09

Three rounds against the same branch, each at a new head after fixes:

| Round | prism | gito | Overlap with prior round |
| --- | --- | --- | --- |
| 1 | 9 findings | clean | — |
| 2 | 11 findings | clean | none |
| 3 | 10 findings | clean | 2 residuals of one family |

Thirty findings, zero confirmed defects in the change. Every finding was verified against the
checkout; the two that claimed a real defect were refuted by the code (the `pending` -> `active`
manifest protocol is the partial-write recovery one claimed was missing, and `check` already
distinguishes a missing file from a missing manifest block). The one real signal —
managed-resource enumeration drift, which the repo's own `review-recurrence-prevention` rule
targets — recurred all three rounds and was genuinely fixed, and rounds 2 and 3 confirmed the
fix by narrowing it.

Rounds 1 and 2 shared no finding at all, which is the evidence that a fourth round converges on
nothing: the provider emits a fresh observation set per invocation.

Meanwhile this repository's remote lane is `absent`/`setup-descriptor-absent` **by design** —
`08-09-descriptor-contract-path` moved the descriptor off the probe path precisely so the router
does not self-match. So the documented escape (`A router classified absent may complete locally
only when routing is optional and the local receipt is clean`) is unreachable: the receipt can
never be clean.

The available exits are all wrong:

- `--successor bookkeeping` requires bookkeeping evidence asserting the whole base..head delta
  is bookkeeping. False for any real change.
- `--successor low-risk` still selects a provider, which returns a fresh set.
- `--remote-disposition <id>=rebutted` is explicitly remote-receipt-only and explicitly not for
  an unfixed finding.
- `review.round-extension` asks a human every time, which is not convergence — it is a prompt
  in place of a gate. PR #70 needed it after three rounds and a merge decision.

## Requirements

- A verified-and-refuted finding must be dispositionable without a false classification claim,
  and the disposition must be recorded as evidence rather than asserted in prose.
- Do not weaken the gate: an unaddressed finding that is a real defect must still block, and a
  disposition must not be inferrable from the provider's own output.
- Severity or category must be usable in the gate decision, so an observation-only category
  cannot indefinitely block a merge while a `high correctness` finding still does.
- The behavior must be visible in the typed result: a reader must be able to tell a clean
  receipt from a dispositioned one.

## Acceptance criteria

- [ ] A finding verified and refuted against the checkout can be dispositioned through a
      documented `sd-review` control, with the reason recorded in the receipt.
- [ ] The typed result distinguishes "no findings" from "findings dispositioned", and
      `remoteGate` reflects the difference.
- [ ] A synthetic `high correctness` finding still blocks with no disposition supplied — asserted
      by a test, not by inspection.
- [ ] `sd-review`'s public control list documents whatever control this adds, and documents
      `--attempt-id`, which exists in the CLI but not in the skill.
- [ ] The three-round PR #70 sequence, replayed against the new gate, terminates without a
      human round-extension decision.

## Notes

Related but distinct from `08-09-review-coordinator-stale-check`, which is about a *stale* check
result replaying. This one is about a *live, correct* result that has no terminating disposition.
Both surfaced on PR #70 in the same session.
