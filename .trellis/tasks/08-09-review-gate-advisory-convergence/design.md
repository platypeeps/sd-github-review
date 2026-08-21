# Design — severity/category-aware local review gate

**Task:** `08-09-review-gate-advisory-convergence`
**Date:** 2026-08-20
**Pack baseline verified against:** `sd-ai-command-pack` 0.71.33, thin install
**Research:** [`research/2026-08-20-research.md`](research/2026-08-20-research.md)

---

## 1. Where the change lands

### The boundary, stated plainly

This repository **cannot implement this task**. Not "should not" — cannot.

Since commit `9a4787a` (*"chore: convert to a thin sd-ai-command-pack install"*) the pack is
installed in `thin` mode (`.sd-ai-command-pack/provenance.json:4`). The provenance `files`
map lists exactly one tracked executable, the layout resolver
`.sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py`. The gate binaries live at
`~/.agents/bin/sd-ai-command-pack-review-local.py` and `~/.agents/bin/sd-ai-command-pack-review.py`
— outside the working tree entirely. There is no `scripts/sd-ai-command-pack-*` path left to
patch, and a machine-level edit would be invisible to review and erased by the next install.

So the design splits into two halves with a hard seam between them:

| Half | Owner | Deliverable |
| --- | --- | --- |
| **A — the gate change** | `platypeeps/sd-ai-command-pack` | code + tests + SKILL.md, shipped in a pack release |
| **B — adoption** | this repository | pack refresh to the release carrying A, then acceptance verification |

Everything in §3–§6 describes **half A**, to be implemented upstream. §7 describes half B,
which is what actually gets executed here.

### The one local lever, and why it is not the fix

`.prism/rules.json` is repo-owned and tracked. Narrowing its `focus` array (dropping `docs`
and `style`, say) would cut advisory volume today with no upstream dependency. It is
deliberately **not** the design, for the reason `prd.md:131-133` gives: it changes how many
advisory findings arrive, not whether an advisory finding can ever terminate. A repo with
zero advisory categories still cannot converge the moment one `medium maintainability`
finding appears. Recorded as a considered-and-rejected stopgap, available if the upstream
release slips.

---

## 2. What is actually missing

Two of the four PRD requirements are already satisfied by the shipped rebuttal channel
(research §"Requirements met vs outstanding"). The design addresses the remaining two plus
the PR #99 addendum.

**The good news, and the reason this is a small change:** severity and category are already
carried on every normalized finding and are already normalized and merged correctly.

- `severity` and `family` recorded — `review-local.py:1640-1642` (single attempt),
  `:1815-1817` (cross-provider merge)
- `FINDING_SEVERITY_RANK = {"unspecified": 0, "low": 1, "medium": 2, "high": 3}` — `:69`
- cross-provider merge takes the **maximum** severity, never the minimum — `:1824-1827`
- integer severities normalized to names — `:1580-1599`

The gap is one function signature. `_remote_gate` (`:1945-1970`) is called with
`(outcome, outstanding, local_policy, family_gate, findings_present=...)` and never sees a
finding. The classification data reaches the receipt and is discarded at the decision point.

---

## 3. Design tension: requirement 2 versus requirement 3

Requirement 2 (`prd.md:75-76`) forbids a disposition **inferrable from the provider's own
output**. Requirement 3 (`prd.md:77-78`) asks the gate to use **severity or category** — which
*is* provider output. Taken naively these contradict, and a naive implementation ships a gate
a provider can open by labelling its own finding `style`.

**Resolution: the provider supplies a key; policy supplies the meaning.**

The provider's `severity`/`family` values are only ever used as lookup keys into a
classification owned by the reviewed repository and the pack, never as a decision in
themselves. Three properties keep this sound:

1. **Policy is caller-side and digested.** The advisory classification is resolved from the
   review policy — the same object already summarized as `plan["policyId"]` /
   `plan["policyDigest"]` (`:1978`) — so a change to it is visible in the receipt and in the
   receipt identity, exactly like every other policy change.
2. **A hard blocking floor no policy can lower.** Families corresponding to
   `bug` / `correctness` / `security`, and any finding of severity `high`, remain blocking
   regardless of configuration. A provider cannot label its way out; a policy author cannot
   either.
3. **Unknown is blocking.** `severity: "unspecified"` (rank 0, `:69`) and family `"other"`
   (the fallback at `:1804-1806`) are treated as blocking, never advisory. A provider that
   omits classification gets the strict gate, so omission is never an escape.

Property 3 also answers research Open Question 5: if prism's `focus` categories turn out not
to intersect `FINDING_FAMILY_IDS`, every finding lands in `"other"` and the gate is exactly
as strict as it is today. The change degrades to a no-op rather than to permissiveness.

### C-1 (BLOCKING, measured 2026-08-20) — that hypothetical is the actual case, and it makes the family axis a guaranteed no-op here

Open Question 5 is now **answered, against the family dimension.** The two vocabularies are
disjoint — computed, not eyeballed:

- `REVIEW_FINDING_FAMILY_IDS` (`~/.agents/bin/sd_ai_command_pack_lib.py:23-36`, re-exported as
  `FINDING_FAMILY_IDS` at `review-local.py:70`) =
  `task-metadata`, `boundary-validation`, `contract-documentation-drift`,
  `generated-surfaces`, `reviewer-test-harness-quality`, `other`.
- `.prism/rules.json` `focus` = `bug`, `correctness`, `docs`, `maintainability`,
  `performance`, `security`, `style`, `testing`.
- **Set intersection: empty.** Not one focus category is a family id.

At `review-local.py:1805-1806` the merge flattens any non-member to `"other"`:

```python
source_family = _bounded(str(raw.get("family") or "other"), 80) or "other"
family = source_family if source_family in FINDING_FAMILY_IDS else "other"
```

So **every prism finding arrives at the gate with `family == "other"`**, which property 3
above defines as blocking. Consequences, stated plainly:

1. `localAdvisoryFamilies` (§4.1) can never match a finding in this consumer. Whatever the
   operator puts in it, zero findings are released.
2. The change is not merely "safe by degrading to a no-op" — it is a no-op **by
   construction** on the only provider this repository runs, so it closes neither
   requirement 3 nor AC5. Safety and fitness are different properties and only the first
   survives here.
3. §7 step 2's adoption instruction (set `localAdvisoryFamilies` to the advisory categories
   named in `severityOverrides`) is **unexecutable as written** — it keys on `docs`/`style`,
   which is not what the finding's `family` field will contain.

**The raw category is not lost**, which is what makes a remedy cheap: the merge preserves the
provider's own value as `sourceFamilies` (`review-local.py:1804`, stored at `:1819`). Three
axes are therefore available, and choosing among them is an **owner decision, unresolved**:

- **(a) key on `sourceFamilies`** — uses the real prism category; needs property 3 restated,
  because "unknown ⇒ other ⇒ blocking" no longer does the work when the lookup key is
  arbitrary provider text.
- **(b) severity only** — drop `localAdvisoryFamilies` entirely. This repository's
  `severityOverrides` already pins `bug`/`correctness`/`security` to `high` and everything
  advisory to `medium` or `low`, so `localAdvisorySeverityCeiling: "medium"` alone releases
  exactly `docs`/`maintainability`/`testing`/`performance`/`style` and holds the rest. The
  §3 hard floor still protects the three families independently.
- **(c) extend `REVIEW_FINDING_FAMILY_IDS` upstream** to carry the provider-facing
  categories. Largest blast radius: that tuple also feeds `familyGate` and
  `_parse_family_finding`.

Do not begin 1.4 in `implement.md` until this is chosen; §4.1, §6 (T4/T5/T6) and §7 step 2
all change shape depending on the answer.

---

## 4. Contracts

### 4.1 Policy input (new)

Two fields on the local review policy, both optional, both defaulting to today's behavior:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `localAdvisoryFamilies` | `list[str]` | `[]` | Family ids whose findings do not gate when their severity is at or below `localAdvisorySeverityCeiling` |
| `localAdvisorySeverityCeiling` | `"low" \| "medium"` | `"low"` | Highest severity that may be released as advisory. `"high"` is **not** an accepted value |

Empty `localAdvisoryFamilies` reproduces current behavior byte-for-byte. That is the
compatibility guarantee: a consumer that adopts the release and changes no policy sees no
gate change.

> **Blocked on C-1.** `localAdvisoryFamilies` as specified above keys on the finding's
> `family` field, which is `"other"` for every prism finding in this repository (§3 C-1,
> measured). This table is therefore **provisional**: if the owner picks axis (b) the field
> disappears entirely and only `localAdvisorySeverityCeiling` remains; if axis (a), it is
> renamed and keyed on `sourceFamilies`. Do not implement §4.1 as literally written.

### 4.2 Disposition vocabulary (extended)

`LOCAL_DISPOSITION_VALUES` grows from `{"rebutted"}` to `{"rebutted", "miscited"}`, with the
identical grammar in both parsers (`review.py:180-202`, `review-local.py:1862-1877`).

**C-2 — the constant is defined three times, not once (verified 2026-08-20).** The single
citation above was wrong in a way that would produce a half-working release:

| Constant | Location | Value today |
| --- | --- | --- |
| `LOCAL_DISPOSITION_VALUES` | `review.py:56` | `frozenset({"rebutted"})` |
| `LOCAL_DISPOSITION_VALUES` | `review-local.py:77` | `frozenset({"rebutted"})` |
| `REMOTE_DISPOSITION_VALUES` | `review.py:55` | `frozenset({"rebutted"})` |

These are independent definitions in two files, and **`review.py`'s copy is validated
first**: `_parse_local_dispositions` runs in the coordinator and only then forwards the pair
to the local stage (`review.py:795-798`). Extending only `review-local.py:77` yields a build
where `--local-disposition '<id>=miscited'` is rejected by the coordinator before the gate
ever sees it. Both must change together. (`review-local.py:77` is the definition; the
previously-cited `:76` is a comment line and `:78` opens `FAMILY_AUDIT_DIMENSIONS`.)

**C-2b — the single value is a deliberate invariant this design silently breaks.** The
docstring at `review.py:181-185` states the intent in the pack's own words:

> Deliberately the same grammar and the same single accepted value as the remote channel
> below: a caller who has verified a finding is false should not have to learn two
> vocabularies depending on which provider raised it.

`review-local.py:74-76` says the same. Adding `miscited` to the local vocabulary alone
creates exactly the two-vocabulary split that comment exists to prevent — a miscited
*remote* finding is equally possible and would have no matching value. This design must
either grow `REMOTE_DISPOSITION_VALUES` in step with the local one, or argue explicitly why
the divergence is acceptable and update both comments. **Unresolved — owner/upstream
decision.**

**C-3 — upstream already owns this question and proposes a different remedy.** The upstream
task's PRD (`platypeeps/sd-ai-command-pack`, `08-07-local-finding-rebuttal-channel`, read
2026-08-20) carries **Open question 2**:

> Should a finding whose cited text does not exist at the cited line be auto-invalidated
> before it ever reaches the gate? That is a cheap, deterministic sanity check the
> coordinator could run itself.

and holds an acceptance criterion — *"Open question 2 is answered in `design.md`"* — that
reserves the answer for the upstream design. So the miscitation ground is not a gap this
task discovered; it is an open upstream decision with a **stronger** candidate remedy than
the manual `miscited` value proposed here. Auto-invalidation arguably fits `prd.md:171-174`'s
own wording better ("checkable against the checkout, and not inferrable from the provider's
own output") because it removes the operator from the loop entirely, which is the cost
`prd.md:176-179` says this task exists to remove. Choosing manual disposition over
auto-invalidation is a real decision and must be made and recorded upstream, not assumed
here. **Unresolved.**

Both values are caller-supplied, both are non-gating, and they differ only in what they
record — which is precisely what the PR #99 criterion asks for (`prd.md:184-187`): a finding
whose cited path and line do not contain the described code is dispositionable **on that
ground specifically**, distinctly from one that is real but low-severity.

This matters because the two grounds have different lifetimes. A `rebutted` finding is a
judgement about the code as it stands; a `miscited` finding is a statement that the
provider's citation is structurally wrong, which is evidence about the *provider* and worth
aggregating across runs. Collapsing them into one value throws that away.

`SKILL.md:133-136` already names this misread in prose. This gives it a representation.

### 4.3 Finding record (extended)

One derived boolean per finding, computed at receipt-build time, not by the provider:

```
"gating": bool          # false only when policy classifies it advisory
```

Kept in the receipt so the decision is auditable after the fact — a reader can see *which*
findings the gate released and check that against the policy digest.

### 4.4 Gate output (extended)

`_remote_gate` gains a `findings` parameter and returns a richer, still-additive result:

| Situation | `state` | `reason` |
| --- | --- | --- |
| no findings at all | `eligible` | `local-stage-terminal` *(unchanged)* |
| findings, all rebutted/miscited | `eligible` | `local-findings-dispositioned` **(new)** |
| findings, some advisory-released, none blocking | `eligible` | `local-findings-advisory` **(new)** |
| any blocking finding outstanding | `blocked` | `actionable-local-findings` *(unchanged)* |
| provider reported findings but listed none | `blocked` | `actionable-local-findings` *(unchanged)* |

The two new `reason` values are what close requirement 4 and acceptance criterion 2
(`prd.md:86-87`), which name `remoteGate` specifically. Today a clean receipt and a
fully-rebutted one both return `{"state": "eligible", "reason": "local-stage-terminal"}` and
are indistinguishable at the gate.

`state` keeps its existing vocabulary, so any consumer branching on `state` is unaffected.
Only `reason` gains members — additive, and `reason` is already a varying diagnostic string
(`:1958-1969` emits four different values today).

### 4.5 Disposition counters (extended)

`receipt["disposition"]` (`:2116-2121` — corrected 2026-08-20; `:2115` is `"findings":
findings`) gains sibling counts beside the existing `outstanding`:

```
"outstanding":          int   # unchanged: every non-dispositioned finding
"outstandingBlocking":  int   # new: the subset the gate actually blocks on
"outstandingAdvisory":  int   # new: released by policy
```

`outstanding` keeps its current meaning so nothing reading it breaks. The gate switches to
`outstandingBlocking`. `_remote_summary` (`:2136`) surfaces the same split under
`findingCounts` (`:2159-2162` — corrected 2026-08-20; the previously-cited `:2160-2163` was
off by one and ran into `"policyId"`).

---

## 5. Control flow

Three call sites construct or recompute the gate, and all three must route through one
classifier — this is where a partial implementation would go wrong:

1. `:2098-2131` — the fresh-run receipt build
2. `:1907-1942` — `_redispose_receipt`, the stored-receipt rebuttal path
3. `:2122-2126` — the gate call inside (1)

A single helper, called by both (1) and (2):

```
_classify_findings(findings, policy) -> (outstanding, outstanding_blocking, outstanding_advisory)
```

It sets each finding's `gating` flag and returns the three counts. `_remote_gate` then takes
`outstanding_blocking` where it takes `outstanding` today. Missing site (2) would produce a
receipt whose gate disagrees with its own counts after a rebuttal — the exact class of bug
this task exists to fix, so it deserves a test of its own (§6).

---

## 6. Test contract (upstream)

Acceptance criteria 3 and 6 both demand assertion by test rather than inspection
(`prd.md:88-89`, `:184-187`). Minimum set:

| # | Scenario | Expected |
| --- | --- | --- |
| T1 | synthetic `high` / `correctness` finding, no disposition | `blocked`, `actionable-local-findings` — **AC3** |
| T2 | `high` finding with a bad citation, dispositioned `miscited` | `eligible`, `local-findings-dispositioned` — **AC6 first half** |
| T3 | `high` finding with a good citation, no disposition | `blocked` — **AC6 second half** |
| T4 | `low` / `style` finding, family in `localAdvisoryFamilies` | `eligible`, `local-findings-advisory` |
| T5 | `high` / `style` finding, family in `localAdvisoryFamilies` | `blocked` — ceiling holds against severity |
| T6 | `low` / `correctness` finding, family in `localAdvisoryFamilies` | `blocked` — hard floor holds against policy |
| T7 | `unspecified` severity, family `other`, advisory policy set | `blocked` — unknown is blocking |
| T8 | empty `localAdvisoryFamilies` | byte-identical gate to pre-change for every above input |
| T9 | rebuttal applied via `_redispose_receipt` to a stored receipt | counts and gate agree — §5 site (2) |
| T10 | two providers, same finding, `low` + `high` | merged row is `high` and blocks — `:1824-1827` preserved |

T5, T6, T7 and T10 are the ones that prove the gate was not weakened; they matter more than
the ones that prove it terminates.

---

## 7. This repository's half

Once a pack release carries §3–§6:

1. Refresh the thin install to that release. Expected footprint: `provenance.json` version
   and hashes, refreshed prompt/skill files. No `src/` change, no `scripts/` change.
2. Decide `.prism/rules.json` policy. Its `severityOverrides` (verified 2026-08-20) pins
   `style: low`; `docs`/`maintainability`/`testing`/`performance` to `medium`; and
   `bug`/`correctness`/`security` to `high`, so the three protected families are already
   above any permitted ceiling and the §3 hard floor covers them independently.

   **Superseded in part by C-1.** The original instruction here — "set
   `localAdvisoryFamilies` covering the advisory categories" — is **unexecutable**: those
   category names never appear in a finding's `family` field, which is `"other"` for every
   prism finding (§3 C-1). What the `severityOverrides` map above *does* show is that
   **axis (b) works unaided**: with severity alone and
   `localAdvisorySeverityCeiling: "medium"`, exactly `docs`/`maintainability`/`testing`/
   `performance`/`style` are released and `bug`/`correctness`/`security` are held, because
   the policy has already pinned each category to the severity that sorts it. Start at
   `"low"` (releases `style` only) and widen to `"medium"` if that share is too small.
3. Verify the acceptance criteria against a real run (§8).

---

## 8. Compatibility and risk

**Backward compatible by construction.** Empty `localAdvisoryFamilies` is the default and
reproduces today's arithmetic exactly (T8). Every schema change is additive: new optional
policy fields, new finding key, new `reason` members, new counter keys beside a preserved
`outstanding`. `schemaVersion: 1` (`:2108` — corrected 2026-08-20; `:2109` is `"receiptId"`)
can stand — no existing key changes type or meaning.

**The real risk is not compatibility, it is the PR #99 lesson.** `prd.md:158-174` is explicit
that severity/category discrimination *does not fix a wrong-line citation*, and that round 6
produced a **`high` finding that was false**. Under this design that finding blocks — correctly,
because the gate cannot know it is false — and the operator disposes of it as `miscited`
after checking the checkout. That is the intended division: policy handles the volume of
honest advisory noise, the disposition channel handles individual wrong claims, and neither
pretends to do the other's job. Any design that tried to auto-release `high` findings would
be the gate-weakening requirement 2 forbids.

**Residual risk: convergence is still not proven.** The PRD's core observation
(`prd.md:53-55`, `:137-139`) is that successive rounds share no findings — six mutually
disjoint sets on PR #99. Advisory release shrinks each round's manual disposition load
roughly in proportion to the advisory share, but a fresh `high`-severity false positive each
round would still require a fresh disposition each round. Acceptance criterion 5 (the PR #70
replay) is the honest test of whether the load drops enough to terminate, and it is the
criterion most likely to fail. It should be run before this task is called done, not assumed.

**Rollback.** Setting `localAdvisoryFamilies: []` in `.prism/rules.json` restores the strict
gate with a one-line repo-owned edit and no pack change — no downgrade, no reinstall. If the
pack release itself is bad, the thin install pins a version in `provenance.json:4`, so
reverting the refresh commit restores 0.71.33.

---

## 9. Scope correction to carry back

`task.json` needs three fixes, none of them cosmetic — they will misdirect whoever implements
this:

- **Three of four `relatedFiles` are dangling**: `scripts/sd-ai-command-pack-review-local.py`
  and `scripts/sd-ai-command-pack-review.py` predate `9a4787a`, and
  `.claude/skills/sd-review/SKILL.md` is no longer repo-local either — the skill resolves from
  the plugin cache at `~/.claude/plugins/cache/sd-ai-command-pack/sd/0.71.33/skills/sd-review/`.
  Only `.prism/rules.json` still exists.
- `package: "scripts"` implies in-repo code. There is none.
- The preserved `blockedOn` note cites `:900-905` as the gate's severity limitation. That is
  `_parse_family_finding`, the family-audit parser feeding the separate `familyGate` arm at
  `:1958-1960`, not the provider-finding path. The conclusion is right; the citation is not.
- The tally "three of four requirements are now met" overstates by one: requirement 4 is
  partial, because `remoteGate` does not yet distinguish clean from dispositioned.
