# Implement — review gate advisory convergence

**Task:** `08-09-review-gate-advisory-convergence`
**Design:** [`design.md`](design.md) · **Research:** [`research/2026-08-20-research.md`](research/2026-08-20-research.md)

---

## The shape of this plan

**The correct resolution is an upstream change plus a pack refresh.** There is no in-repo
code to write. Since `9a4787a` the pack is a thin install
(`.sd-ai-command-pack/provenance.json:4`, `"mode": "thin"`) and the gate binaries live at
`~/.agents/bin/`, outside the working tree. Confirmed by upstream PR #406, which states this
consumer *"carries no local fork and cannot."*

So the checklist below has three phases with a hard dependency between them:

- **Phase 0** — in-repo scope correction. Executable **now**, no dependency.
- **Phase 1** — upstream implementation in `platypeeps/sd-ai-command-pack`. Blocks on
  approval to open an upstream PR.
- **Phase 2** — refresh and acceptance verification here. Blocks on a Phase 1 release.

Do not start Phase 2 before a release exists. Do not treat Phase 0 as progress on the
requirement — it corrects the map, not the territory.

> **Blocking gate added 2026-08-20 (adversarial review C-1).** Phase 1b is **blocked** on an
> owner decision that step 1.3 has now forced: the family axis the design is built on cannot
> work in this consumer, because `.prism/rules.json`'s eight `focus` categories and
> `REVIEW_FINDING_FAMILY_IDS` have an **empty intersection**, so every prism finding reaches
> the gate as `family: "other"` and blocks. Phase 0 and the Phase 1a reconnaissance steps
> (1.1–1.3) remain executable now; 1.4 onward do not. See design §3 "C-1".

---

## Phase 0 — correct the task scope in this repository

Small, self-contained, and worth doing first because the current metadata sends an
implementer to files that do not exist.

- [ ] **0.1** Update `task.json` `relatedFiles`. **Three of the four are dangling** — verified
      by enumeration, not inspection:

      ```
      MISSING: scripts/sd-ai-command-pack-review-local.py
      MISSING: scripts/sd-ai-command-pack-review.py
      exists:  .prism/rules.json
      MISSING: .claude/skills/sd-review/SKILL.md
      ```

      Drop the two `scripts/` paths (they predate `9a4787a`). Drop
      `.claude/skills/sd-review/SKILL.md` — the skill is no longer repo-local; it resolves
      from `~/.claude/plugins/cache/sd-ai-command-pack/sd/<version>/skills/sd-review/`, so it
      is an upstream deliverable, not a local file. Keep `.prism/rules.json`. Add
      `.sd-ai-command-pack/provenance.json` as the artifact a refresh actually moves.
- [ ] **0.2** Reconsider `package: "scripts"`. There is no `scripts/` work in this task.
- [ ] **0.3** Correct the tally in `notes` from "three of four requirements are now met" to
      **two met, one partial, one outstanding** — requirement 4 is partial because
      `remoteGate` returns the identical `{"state": "eligible", "reason":
      "local-stage-terminal"}` for a clean receipt and a fully-rebutted one
      (`~/.agents/bin/sd-ai-command-pack-review-local.py:1970`).
- [ ] **0.4** Correct the `:900-905` citation in `notes`. That range is
      `_parse_family_finding`, which validates family-audit findings feeding the separate
      `familyGate` arm at `:1958-1960` — not the provider-finding path. The real blocker is
      that `_remote_gate` (`:1945-1970`) is never passed the findings list at all.

**Validation for Phase 0** — these must hold after the edits:

```bash
cd "$(git rev-parse --show-toplevel)"

# Every relatedFiles entry must exist. Expect: no output.
python3 -c "
import json,os
t=json.load(open('.trellis/tasks/08-09-review-gate-advisory-convergence/task.json'))
[print('MISSING:',f) for f in t['relatedFiles'] if not os.path.exists(f)]
"

# task.json must stay valid JSON. Expect: ok
python3 -c "import json;json.load(open('.trellis/tasks/08-09-review-gate-advisory-convergence/task.json'));print('ok')"
```

**Rollback point A:** Phase 0 is metadata only — `git checkout -- .trellis/tasks/08-09-review-gate-advisory-convergence/task.json`.

---

## Phase 1 — upstream (`platypeeps/sd-ai-command-pack`)

**Gate before starting: explicit owner approval to open an upstream PR.** The PRD records
this as the standing unblock condition (`prd.md:9-10`, `:128-133`).

### 1a — reconnaissance (do this before writing code)

- [ ] **1.1** ~~Read the current PRD of upstream `08-07-local-finding-rebuttal-channel`.~~
      **DONE 2026-08-20 — premise confirmed.** PR #406 is merged (2026-08-11, `sdelmas`),
      and the upstream PRD already carries, verbatim: the PR #70 three-round table, the
      "rounds 1 and 2 shared no finding at all" argument, the structurally-unreachable-escape
      analysis, the added requirement that severity/category be usable in the gate, and its
      matching acceptance criterion. **Add none of that again.** Still worth re-reading for
      drift before opening a PR, but the gap is narrower than 1.1 assumed.
- [ ] **1.2** **Answered 2026-08-20: the PR #99 miscitation evidence is NOT upstream.** The
      upstream PRD's newest section is the 2026-08-09 PR #70 material from PR #406; nothing
      references PR #99, the six disjoint rounds, or the wrong-line-citation taxonomy. So
      append `prd.md:135-187` — it is the argument that severity-awareness alone ships a
      gate that still cannot terminate (`prd.md:167-174`), and C-1 has since made that
      argument sharper, not weaker.

      **But do not file it as a new discovery.** Upstream **Open question 2** already asks
      the miscitation question directly — *"Should a finding whose cited text does not exist
      at the cited line be auto-invalidated before it ever reaches the gate?"* — and
      upstream acceptance criterion 5 requires it be answered in the upstream `design.md`.
      The correct contribution is **evidence that answers that open question**, not a new
      requirement competing with it (design §4.2 C-3).
- [ ] **1.3** ~~Confirm `FINDING_FAMILY_IDS` against `.prism/rules.json`.~~ **DONE
      2026-08-20 — and the answer kills the family axis.** Research Open Question 5 is
      resolved, computed rather than eyeballed:

      ```
      REVIEW_FINDING_FAMILY_IDS (sd_ai_command_pack_lib.py:23-36):
        task-metadata, boundary-validation, contract-documentation-drift,
        generated-surfaces, reviewer-test-harness-quality, other
      .prism/rules.json focus:
        bug, correctness, docs, maintainability, performance, security, style, testing
      intersection: []          <-- empty
      ```

      Because `review-local.py:1805-1806` flattens every non-member to `"other"`, and
      design §3 property 3 makes `"other"` blocking, **every prism finding blocks and
      `localAdvisoryFamilies` never matches anything.** The design's family dimension is
      not worth building as specified; it would ship a guaranteed no-op that closes neither
      requirement 3 nor AC5.

      **BLOCKING — do not start 1.4, 1.5 or 1.13 until the owner picks an axis** from
      design §3 C-1: (a) key on the preserved `sourceFamilies` (`review-local.py:1804`,
      `:1819`), (b) severity only — which this repository's `severityOverrides` already
      makes sufficient — or (c) extend `REVIEW_FINDING_FAMILY_IDS` upstream. The choice
      changes 1.4's field list, 1.5's classifier, T4/T5/T6, and design §7 step 2.

### 1b — implementation

- [ ] **1.4** Add the policy fields — **field list depends on the 1.3 axis decision**;
      `localAdvisorySeverityCeiling` (default `"low"`, must reject `"high"`) survives every
      axis, `localAdvisoryFamilies` (default `[]`) only survives axes (a) and (c).

      **Citation corrected 2026-08-20.** `policyDigest` is **computed** at
      `review-local.py:1309` (`plan["policyDigest"] = _digest(plan)`) over the whole `plan`
      dict built at `:1290-1308`. The previously-cited `:1978` is where `_receipt_identity`
      *consumes* it and is not where the change lands. Practical effect: add the new fields
      to the `plan` dict at `:1290-1308` — beside the existing `localPolicy` and
      `fixPolicy` — and they participate in the digest automatically, since `_digest(plan)`
      covers everything present.
- [ ] **1.5** Add `_classify_findings(findings, policy)` returning
      `(outstanding, outstanding_blocking, outstanding_advisory)` and setting each finding's
      derived `gating` boolean. Enforce all three soundness properties from design §3:
      hard blocking floor on `bug`/`correctness`/`security` and on severity `high`;
      `unspecified` severity and family `other` treated as blocking; provider values used
      only as lookup keys into policy.
- [ ] **1.6** Extend the disposition vocabulary to `{"rebutted", "miscited"}`. **The
      constant is defined in two files, not one (corrected 2026-08-20)** — see design §4.2
      C-2. Change **both**, or the release half-works:

      ```
      review.py:56           LOCAL_DISPOSITION_VALUES  = frozenset({"rebutted"})
      review-local.py:77     LOCAL_DISPOSITION_VALUES  = frozenset({"rebutted"})
      review.py:55           REMOTE_DISPOSITION_VALUES = frozenset({"rebutted"})   # C-2b
      ```

      `review.py`'s copy is validated **first** — `_parse_local_dispositions` runs in the
      coordinator and only then forwards the pair on (`review.py:795-798`) — so extending
      only `review-local.py:77` gets `=miscited` rejected before the gate ever sees it.

      Update both parsers (`review.py:180-202`, `review-local.py:1862-1877`) and both error
      strings, which currently read `must use <stable-id>=rebutted`.

      **Before writing this, settle C-2b and C-3 (design §4.2), both unresolved:** the
      docstrings at `review.py:181-185` and `review-local.py:74-76` state the single value
      is *deliberately* identical to the remote channel's, so this change breaks a stated
      invariant — decide whether `REMOTE_DISPOSITION_VALUES` grows too. And upstream
      `08-07-local-finding-rebuttal-channel` Open question 2 proposes **auto-invalidation**
      of a bad citation instead of a manual value, with an acceptance criterion reserving
      that answer for the upstream design. Do not pre-empt it here.
- [ ] **1.7** Give `_remote_gate` (`:1945-1970`) the findings/blocking count. Add the two new
      `reason` values `local-findings-dispositioned` and `local-findings-advisory`. Leave the
      `state` vocabulary untouched.
- [ ] **1.8** Wire **all three** call sites through `_classify_findings` — the fresh-run
      build at `:2098-2131`, `_redispose_receipt` at `:1907-1942`, and the gate call at
      `:2122-2126`. Design §5: missing the `_redispose_receipt` site yields a receipt whose
      gate disagrees with its own counts after a rebuttal.
- [ ] **1.9** Add `outstandingBlocking` / `outstandingAdvisory` beside the preserved
      `outstanding` in `receipt["disposition"]` (`:2116-2121`) and surface the split in
      `_remote_summary` `findingCounts` (`:2159-2162`). Both ranges corrected 2026-08-20;
      the previous `:2115-2120` / `:2160-2163` were each off by one.
- [ ] **1.10** Update `sd-review/SKILL.md`: document `miscited` alongside the existing
      `--local-disposition` text at `:123-131`, and state the ground that separates it from
      `rebutted`. `--attempt-id` is already documented at `:111` — AC4 needs no new work
      there, only confirmation it survives the edit.

### 1c — tests (design §6)

- [ ] **1.11** T1: `high`/`correctness`, no disposition → `blocked` — **AC3**.
- [ ] **1.12** T2: `high` with bad citation, `=miscited` → `eligible`; T3: `high` with good
      citation, no disposition → `blocked` — **AC6**, both halves in one pair.
- [ ] **1.13** T4 advisory release; T5 `high`/`style` still blocks (ceiling beats severity);
      T6 `low`/`correctness` still blocks (hard floor beats policy); T7 unspecified/other
      blocks.
- [ ] **1.14** T8: empty `localAdvisoryFamilies` reproduces the pre-change gate for every
      input above. **This is the compatibility guarantee** — if it fails, the default is not
      backward compatible and the release is not safe to ship.
- [ ] **1.15** T9 `_redispose_receipt` counts/gate agree; T10 two providers `low`+`high`
      merge to `high` and block (preserves `:1824-1827`).

**Validation for Phase 1** (run in the upstream checkout):

```bash
# Full pack test suite. Expect: 0 failures.
# T5, T6, T7, T10 are the gate-not-weakened assertions — a pass there matters
# more than a pass on the termination tests.

node scripts/sd-ai-command-pack-review-preflight.mjs   # expect 0 failures
```

- [ ] **1.16** Cut a pack release carrying 1.4–1.15. Record the version.

**Review gate 1:** upstream PR reviewed and merged. Do not proceed to Phase 2 on an unmerged
branch — a refresh against an unreleased version cannot be verified or rolled back cleanly.

**Rollback point B:** nothing in this repository has changed through the end of Phase 1. An
abandoned upstream PR costs no local state.

---

## Phase 2 — adopt and verify here

Blocks on a released version from 1.16.

- [ ] **2.1** Refresh the thin install to that release. Expected footprint: version and
      hashes in `.sd-ai-command-pack/provenance.json`, refreshed `.github/prompts/*` and
      skill files. **No `src/` change, no `scripts/` change** — if either appears, stop and
      investigate before committing.
- [ ] **2.2** Confirm the refresh landed:

```bash
cd "$(git rev-parse --show-toplevel)"
python3 -c "import json;print(json.load(open('.sd-ai-command-pack/provenance.json'))['version'])"
# expect the release from 1.16, not 0.71.33

git status --short   # expect only .sd-ai-command-pack/, .github/prompts/, .claude/
```

- [ ] **2.3** Run the repo's own suite to prove the refresh broke nothing:

```bash
npm test   # expect: pass, same count as before the refresh
```

- [ ] **2.4** Confirm the gate default did not change behavior before touching policy. Run
      `sd-review` on a small branch with `.prism/rules.json` **unmodified**. Expect the gate
      to behave exactly as at 0.71.33 — this is T8 observed in the real consumer.
- [ ] **2.5** Only now set `localAdvisoryFamilies` in `.prism/rules.json`, guided by the
      existing `severityOverrides` (which already pins `style: low` and
      `docs`/`maintainability`/`testing`/`performance` to `medium`). Start with
      `localAdvisorySeverityCeiling: "low"`; widen to `"medium"` only if the advisory share
      proves too small to matter.
- [ ] **2.6** Verify the receipt distinguishes the cases — **AC2**:

```bash
# On a branch with findings, all dispositioned:
#   remoteGate.reason == "local-findings-dispositioned"
# On a branch with only advisory findings:
#   remoteGate.reason == "local-findings-advisory"
# On a clean branch:
#   remoteGate.reason == "local-stage-terminal"
# All three must differ. Identical values mean AC2 is still unmet.
```

- [ ] **2.7** Verify `disposition.outstandingBlocking` and `outstandingAdvisory` appear and
      sum to `outstanding`.

### 2a — the acceptance criterion most likely to fail

- [ ] **2.8** **AC5 — replay the PR #70 sequence and confirm it terminates without a human
      `review.round-extension` decision.** Design §8 flags this as the honest test and the
      likeliest failure: advisory release cuts the manual disposition load roughly in
      proportion to the advisory share, but the PRD's central observation (`prd.md:53-55`,
      `:137-139` — six mutually disjoint finding sets on PR #99) means a fresh `high`-severity
      false positive each round still costs a fresh disposition each round.

      Note the honesty problem recorded as research Open Question 4: **neither the PR #70 nor
      the PR #99 finding sets are archived in this task directory.** A literal replay is not
      possible from what is on disk. Either reconstruct them upstream as fixtures during 1.11–1.15,
      or restate AC5 as a live re-run on a comparable branch and say so explicitly rather than
      claiming a replay that did not happen.

- [ ] **2.9** If 2.8 does not terminate: **do not widen the ceiling to `"high"` to force it.**
      That is the gate-weakening requirement 2 forbids (`prd.md:75-76`). Record the residual
      non-convergence as new upstream evidence, exactly as PR #406 did for PR #70.

**Rollback point C:** if the refreshed pack misbehaves, revert the Phase 2 commit —
`provenance.json` pins the version, so this restores 0.71.33 with no downgrade or reinstall.

**Rollback point D:** if only the *policy* is wrong, set `localAdvisoryFamilies: []` in
`.prism/rules.json`. One repo-owned line restores the strict gate with no pack change.

---

## Definition of done

| Criterion | Closed by | Verified by |
| --- | --- | --- |
| Req 1 — dispositionable, recorded | **already met** at 0.71.33 | `review.py:1814`, `review-local.py:1880-1904` |
| Req 2 — gate not weakened | 1.5 hard floor + 1.14 | T5, T6, T7, T10 |
| Req 3 — severity/category usable | 1.5, 1.7, 1.8 — **blocked on the C-1 axis decision (1.3)** | T4, T5, T6 |
| Req 4 — typed result distinguishes | 1.7, 1.9 | 2.6, 2.7 |
| AC3 — `high correctness` still blocks | 1.11 | T1 |
| AC4 — controls documented | 1.10 | `SKILL.md` diff |
| AC6 — miscitation distinct | 1.6, 1.12 | T2 + T3 |
| AC5 — PR #70 replay terminates | 2.8 | live run, **or** an explicit restatement per 2.8 |

**Report honestly at the end.** AC3 and AC6 are asserted by upstream tests, not by anything
runnable in this repository — say which suite proved them and quote the result. AC5 is the
one that may legitimately come back unmet; a recorded "not converged, evidence filed
upstream" is a real outcome, and preferable to widening the ceiling until the number looks
right.
