# Local review gate cannot converge under advisory-mode prism findings

## BLOCKED — the fix belongs upstream

**2026-08-09.** `_remote_gate` lives in `~/.agents/bin/sd-ai-command-pack-review-local.py`, which is
vendored from `sd-ai-command-pack` — its entire history here is `chore: refresh
sd-ai-command-pack to 0.54.0`. The deterministic `pack.install-audit` gate blocks any local edit
to a pack path, and its allowlist covers only `.sd-ai-command-pack/*.json`. Same boundary, same
evidence, and same unblock as `08-09-review-coordinator-stale-check`: explicit approval for an
upstream pull request, then a pack refresh.

`.prism/rules.json` is repo-owned (history: `Initial commit`), so any rules-side adjustment could
land here — but it cannot fix a gate that blocks on any finding regardless of rule configuration.

## Goal

Let `sd-review` terminate on its own when the configured local providers return observations
rather than defects, without weakening the gate for real findings.

## Problem

`_remote_gate` in `~/.agents/bin/sd-ai-command-pack-review-local.py:1857` blocks on **any** finding:

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

## Upstream: already filed, and partly fixed since 0.64.3 (2026-08-09)

The upstream task is `08-07-local-finding-rebuttal-channel` in
`sd-ai-command-pack` (PARKED), filed 2026-08-07 from PR #353 there. It covers the
missing local-finding disposition channel — the first three requirements above,
essentially — from the false-positive angle: a provider that misread quoted
source inside a Markdown PRD, and a hallucinated typo finding, neither of which
had any exit.

Upstream PR #402 has since shipped `_local_outstanding`, a rebuttal gate. This
repository is on `0.64.3` and predates it, so the gate observed here is the
pre-#402 one.

This repository's evidence was appended to that task rather than duplicated:
platypeeps/sd-ai-command-pack#406. What it adds is a failure mode the upstream
PRD does not cover — **non-convergence is distinct from false positives**. Every
PR #70 finding was individually defensible; rounds 1 and 2 still shared no
finding at all, so per-finding rebuttal disposes of one round's set while the
next invocation produces a different one. A rebuttal channel is necessary and
not sufficient. The severity/category requirement above is the part that closes
it, and was sent upstream as a new requirement plus acceptance criterion.

Also sent: the escape hatch is structurally unreachable in this topology. The
router is `absent`/`setup-descriptor-absent` by design after
`08-09-descriptor-contract-path`, so routing is optional but the receipt can
never be clean.

### What unblocks this

A pack release carrying both the rebuttal channel and a category-aware gate,
refreshed into this repository. `.prism/rules.json` is repo-owned and could be
narrowed here unilaterally, but that would suppress signal rather than fix a gate
that blocks on any finding regardless of rule configuration.

## Second observation, PR #99, 2026-08-16 — the proposed remedy is incomplete

Six rounds across three heads on `task/installer-managed-route-mode`, all six
finding sets mutually disjoint. That reproduces and extends the PR #70 result:
non-convergence is not a two-round artifact, and it does not decay with rounds.

What is new is **why** most of them were not defects. Sorted by what the citation
actually pointed at, rather than by severity:

- **Not a defect at all.** Several findings were compliments on the diff —
  "improving accuracy of required update messages", "preventing hard-to-debug
  decode failures", "This is positive". The gate cannot distinguish praise from
  a defect, because both arrive as findings.
- **Describes code the diff removed.** One round objected to a `JSON.stringify`
  configuration comparison. That comparison is what this diff deleted.
- **Cites the wrong line.** A `laneRouteModeGate()` finding landed on a schema-2
  migration test; a "routeMode must be last key" finding landed on a
  model-format error string; a "do not use `JSON.stringify` for configuration
  comparison" finding landed on a closing brace.

The last category is the one that matters for this task's design, because
**severity and category discrimination does not fix a wrong-line citation.** The
requirement above — "Severity or category must be usable in the gate decision,
so an observation-only category cannot indefinitely block a merge while a `high
correctness` finding still does" — assumes a finding's severity predicts whether
it is real. Round 6 produced a `high` finding that was false: it claimed
`CONFIG_VARIABLES` was read against a manifest without version gating, and
tracing every use disproved it (only one site reads a manifest, and it calls
`configVariablesForSchema`; the other two operate on the run's resolved
configuration). A category-aware gate would have let that one block, and would
have let the three miscited findings block, while correctly releasing the
compliments.

So the remedy as currently written closes the observation-noise half and leaves
the miscitation half open. Anyone implementing this against the requirements as
they stand will ship a gate that still cannot terminate. What is additionally
needed is a disposition whose ground is *the cited location does not contain the
described code* — checkable against the checkout, and not inferrable from the
provider's own output, which satisfies the existing "do not weaken the gate"
constraint.

Working practice on PR #99, absent any of this: every finding was checked
against its cited path and line in the checkout before disposition, and rebutted
only where the claim was untrue there. Six rounds of that is the cost this task
is meant to remove.

### Additional acceptance criterion

- [ ] A finding whose cited path and line do not contain the described code can
      be dispositioned on that ground specifically, distinctly from a finding
      that is real but low-severity — asserted by a test that supplies a `high`
      severity finding with a bad citation and shows it does not block, while a
      `high` finding with a good citation still does.
