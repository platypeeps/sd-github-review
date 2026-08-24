# Local review gate cannot converge under advisory-mode prism findings

## STILL BLOCKED — but on half of what it was

**Re-checked 2026-08-24. Nothing has moved since 2026-08-20, and the evidence
below says why no future pack refresh alone will move it either.**

The header this replaces was written 2026-08-09 and quoted a gate that no longer
exists. Requirements 1, 2 and 4 have since been met upstream; **requirement 3 —
severity or category usable in the gate decision — has not**, and neither has
the miscitation ground added after PR #99. Those two are the whole remaining
task.

### What shipped

`_remote_gate` no longer blocks on the presence of findings. The version this
PRD originally quoted:

```python
if outstanding or outcome == "findings":
```

is now, at `~/.agents/bin/sd-ai-command-pack-review-local.py:1956`:

```python
if outstanding or (outcome == "findings" and not findings_present):
```

carrying the comment *"the count of findings left outstanding is what decides:
rebutted ones do not gate."* The control is
`--local-disposition <stable-id>=rebutted` (line 2237), applied by
`_apply_local_dispositions`, which errors rather than no-ops on an id matching
no finding at the current head — a stale id from an earlier head cannot open the
gate. Both it and `--attempt-id` are documented in
`~/.agents/skills/sd-review/SKILL.md`, closing the documentation criterion.

### What has not, and the reason it will not arrive on its own

`LOCAL_DISPOSITION_VALUES = frozenset({"rebutted"})` — one value, no grounds, no
reason field. The gate reads `outstanding`, `family_gate`, and `outcome`; it
reads neither severity nor category. So a `high` finding with a bad citation and
a `low style` observation are still the same object to it, which is exactly the
gap PR #99 identified.

**The pack refreshes are not delivering this, and the file proves it.**
`sd-ai-command-pack-review-local.py` is byte-identical
(`9efca3af9030d4af01a58762569fdd2345a26d2d23cb771ba4e98dd313200ead`) across every
cached release from `0.71.1` through `0.71.33`, and identical again to the copy
in force at `~/.agents/bin/`. Three refreshes landed in this repository during
August — `0.71.33`, `0.71.38`, `0.71.45` — and none of them touched this file.
Waiting for the next refresh is therefore not a plan; the unblock needs the
upstream change itself to be made.

### Where the code actually lives now

**This repository no longer vendors the script.** Commit `9a4787a`
(`chore: convert to a thin sd-ai-command-pack install`) removed it;
`.sd-ai-command-pack/provenance.json` records `"mode": "thin"` at `0.71.45`, and
`installed-targets.txt` lists 31 targets, none of them a review script.

`task.json` has not caught up: three of its four `relatedFiles` are dangling —
both `scripts/sd-ai-command-pack-review*.py` paths and
`.claude/skills/sd-review/SKILL.md`, leaving only `.prism/rules.json`. Its
preserved `blockedOn` note also cites `:900-905` as the gate's severity
limitation, which is `_parse_family_finding` feeding the separate `familyGate`
arm, not the provider-finding path — right conclusion, wrong line.
`design.md` §9 and `implement.md` step 0.1 already record both corrections and
carry the fix; they are not themselves stale. Read any surviving `scripts/`
citation against `~/.agents/bin/` — the content is byte-identical, so the line
numbers still resolve.

The original boundary is unchanged and still decides the outcome: the
deterministic `pack.install-audit` gate blocks any local edit to a pack path, and
its allowlist covers only `.sd-ai-command-pack/*.json`. Same unblock as
`08-09-review-coordinator-stale-check` — explicit approval for an upstream pull
request, then a pack refresh.

`.prism/rules.json` is repo-owned (history: `Initial commit`), so any rules-side
adjustment could land here — but it cannot fix a gate that blocks on any finding
regardless of rule configuration.

### One claim this task makes that is now worth retesting

The PRD's thesis is that per-finding rebuttal is *necessary but not sufficient*,
because each new head emits a disjoint finding set. That was measured before a
rebuttal channel existed. With one, a caller can terminate at a single head by
rebutting its set rather than fixing and re-running into a fresh one — which
would make the six-round PR #99 sequence a two-round one and would satisfy the
final acceptance criterion without any further upstream work.

**This is reasoning, not measurement. It has not been run.** It is recorded here
because it decides how much of this task is left: if it holds, only the
miscitation ground and the severity gate remain as quality improvements rather
than as the difference between converging and not.

## Goal

Let `sd-review` terminate on its own when the configured local providers return observations
rather than defects, without weakening the gate for real findings.

## Problem

**Historical, as observed 2026-08-09.** This is the gate that produced the PR #70
and PR #99 evidence below; it is not the gate in force today. See the header for
what replaced it and what did not. Kept in present tense because the measurements
that follow were taken against it.

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

Upstream PR #402 has since shipped `_local_outstanding`, a rebuttal gate. At the
time this was written the repository was on `0.64.3` and predated it, so the gate
observed here is the pre-#402 one.

**Superseded 2026-08-24.** The repository is now on `0.71.45` and the rebuttal
gate is in force — see the header. Note the symbol did not survive under that
name: there is no `_local_outstanding` in the shipped file. The mechanism landed
as an `outstanding` count computed in `_redispose_receipt` and read by
`_remote_gate`. Grepping for the upstream symbol will report the fix as absent
when it is present, which is why the header verifies against the gate expression
itself.

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
