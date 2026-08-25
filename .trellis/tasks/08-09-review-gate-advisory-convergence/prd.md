# Local review gate cannot converge under advisory-mode prism findings

## The gate shipped; the replay that would prove it is blocked elsewhere

**Rewritten 2026-08-24, replacing a header that said "STILL BLOCKED ... no
future pack refresh alone will move it".** A pack refresh did move it. The
missing requirement 3 — severity usable in the gate decision — shipped upstream
in 0.71.47 (PR #536), is adopted here at `medium`, and five of the six
acceptance criteria are now met with test evidence.

The sixth, replaying PR #70, is **unmet and was attempted**. It is blocked on
provider tooling — prism returns clean without reviewing any range, and the
Kimi code models spend their whole output budget on reasoning — not on the gate
this task is about. Full measurements in "Replay" below.

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

**Reconciled 2026-08-24 against sd-ai-command-pack 0.71.47 (PR #536, merged
`7b5262f3`), which is where the gate this task was parked on actually lives.**
Five of six are met with test evidence upstream. The sixth is the replay, and it
is recorded **unmet** — not inferred from the five that pass.

- [x] A finding verified and refuted against the checkout can be dispositioned through a
      documented `sd-review` control, with the reason recorded in the receipt.
      — `--local-disposition '<id>=rebutted'`; the pack's review-stage test
      module, `test_rebutted_local_finding_clears_the_gate_but_stays_visible`.
- [x] The typed result distinguishes "no findings" from "findings dispositioned", and
      `remoteGate` reflects the difference.
      — `_remote_gate` reports `local-stage-terminal`, `local-findings-dispositioned`
      and `local-advisory-released`, strongest claim first; asserted by
      `test_disposition_reason_outranks_advisory_release`.
- [x] A synthetic `high correctness` finding still blocks with no disposition supplied — asserted
      by a test, not by inspection.
      — `test_advisory_ceiling_does_not_release_a_high_finding`, plus
      `test_advisory_predicate_keeps_a_floor_a_wider_vocabulary_cannot_lower`
      which pins the floor directly, since at the permitted ceilings the
      end-to-end test passes even with the floor deleted.
- [x] `sd-review`'s public control list documents whatever control this adds, and documents
      `--attempt-id`, which exists in the CLI but not in the skill.
      — both corrected in `templates/.agents/skills/sd-review/SKILL.md` in PR #536.
- [ ] The three-round PR #70 sequence, replayed against the new gate, terminates without a
      human round-extension decision.
      — **UNMET, and now for a precise reason. Replayed twice on 2026-08-24.**
      The ceiling works: 30 of 37 findings released as advisory once
      `severityOverrides` stopped overwriting severity with a category lookup.
      All seven survivors were verified against the checkout and **none is a
      defect in the change**; four were dispositioned as `rebutted` or
      `miscited`, leaving `outstanding: 3` and `remoteGate: blocked`. The three
      are accurate and deliberate, so no existing ground fits them. See "Second
      replay" below and the additional requirement it records.
      **Filed upstream 2026-08-24** as sd-ai-command-pack task
      `08-24-accepted-finding-disposition-ground`, whose final acceptance
      criterion is this replay reaching `eligible`. The ground shipped in pack
      **0.71.51**; what closes this criterion is restated structurally in the
      2026-08-25 section "What closing criterion 6 actually requires".

## Replay, 2026-08-24 — run, and the four provider defects it exposed

**The replay ran.** The ceiling releases, the floor holds, and the receipt says
so. What it took to get there was four fixes in `prism`, none of them in this
repository or in the pack.

Replay target, reconstructed rather than assumed: PR #70's merge commit is
`9a6cdb99`, whose parents give base `c3ec5f64` and head `2880186`. That range is
23 files and 1407 insertions, and the historical `.prism/rules.json` at that head
is **byte-identical** to today's, so the severity mapping under test is the one
the original rounds ran under.

`.sd-ai-command-pack/review.json` sets `policy.localAdvisorySeverityCeiling:
"medium"`, and the plan carries it: `localAdvisorySeverityCeiling: "medium"` with
`policyDigest: b8c4553b…`. So the ceiling reaches receipt identity.

### What the gate did, on real findings

Two runs against the same range, `--local-policy optional --fix none --no-reuse`:

| run | provider | findings | advisory | outstanding | `remoteGate` |
| --- | --- | --- | --- | --- | --- |
| `replay-fixed-r1` | gito | 5 (1 low, 2 medium, 2 high) | 3 | 2 | `blocked` / `actionable-local-findings` |
| `replay-fixed-r2` | prism | 35 (2 low, 28 medium, 5 high) | 30 | 5 | `blocked` / `actionable-local-findings` |

Both times the outstanding count is exactly the set of `high` findings and
nothing else. The ceiling released every `low` and `medium` without a hand
disposition of any of them; the `high` ones still block. That is the mechanism
this task asked for, observed end to end on provider output rather than on a
synthetic fixture. prism exited 0 in 84.8s.

### Correction: prism was not returning clean without reviewing

An earlier revision of this section, and commit `1a9335a` which carried it,
recorded **"prism's range and commit modes return clean without reviewing"** as
cause 3 and called it the blocker. That characterization is wrong and is
withdrawn.

A logging HTTP proxy in front of the provider captured what prism actually sent:
one well-formed request carrying the entire 110054-character diff. Replaying that
exact prompt by hand returned `[]` — 2 characters of text, 4 output tokens, 3.2
seconds. prism transmitted correctly and reported what it received. **The model
returned an empty array on a whole-diff prompt.** The same prompt shape over a
single 14 KB file returned 8 findings.

So the observable — `Findings: 0` in about 2 seconds — was real, and the
mechanism behind it was not the one recorded. It was the whole-diff prompt
degenerating, which is downstream of the first defect below.

### The four defects, all silent

Each one leaves the review exiting zero with a finding count printed, so nothing
tells the caller what was skipped. Fixed in `~/repos/ai/prism` on
`fix/chunking-rules-maxtokens`, commit `1bad8d6`; `go test ./...` passes.

1. **Chunking could never split.** `reviewPipeline` passed `cfg.MaxDiffBytes` to
   `SplitIntoChunks`, but `MaxDiffBytes` has already truncated the diff by the
   time chunking runs, so `maxBytes >= len(diff)` by construction and every diff
   became exactly one chunk. `SplitIntoChunks` was unreachable in practice. Chunk
   size is now its own setting, `chunkMaxBytes`, default 20000. On this range: 1
   request before, 7 after. This is what was producing the degenerate `[]`.
2. **`.prism/rules.json` was never loaded.** `LoadRules("")` returned nil and
   nothing defaulted the path, so the repository's `focus` categories,
   `severityOverrides` and `review-recurrence-prevention` required rule reached
   the model only when a caller passed `--rules` explicitly. **The pack never
   does** — there is no `rules` reference anywhere in
   `templates/scripts/sd-ai-command-pack-review-local.py`. So this repository's
   entire review policy has been inert for every pack-driven prism review, here
   and in every other consumer, for as long as the thin install has existed.
   `LoadRules` now falls back to `.prism/rules.json` when it exists.

   This also withdraws the rationale in commit `bc793bb`, which justified the
   `medium` ceiling by "this repository's own `.prism/rules.json`
   `severityOverrides`". Those overrides had never been applied to anything. The
   ceiling choice stands on its own — `high` is not a permitted ceiling value, so
   `medium` is the widest release the pack allows — and the overrides only start
   mattering now that the rules load.
3. **`MaxTokens` was hardcoded to 8192** at five call sites. Reasoning models
   spend the budget thinking before answering, so an exhausted budget yields an
   empty completion rather than a short one. Measured directly against Moonshot
   on a 40 KB slice of this diff:

   ```
   kimi-k2.7-code            finish_reason: length  content_len: 0  reasoning_len: 9060
   kimi-k2.7-code-highspeed  finish_reason: length  content_len: 0  reasoning_len: 9316
   ```

   Zero answer, all thinking — the whole of `empty text content in API
   response`. At `max_tokens: 16000` the highspeed model finishes with
   `finish_reason: stop`. Now `cfg.MaxTokens`, default 8192.
4. **Provider HTTP timeouts were hardcoded.** Same root cause: with a reasoning
   model the answer arrives in one late burst after thinking completes, so a
   fixed 120s deadline expires on a request that is still healthy — `context
   deadline exceeded ... awaiting headers`. Overridable with
   `PRISM_REQUEST_TIMEOUT_SECONDS`; per-provider defaults unchanged.

Also added: a stderr warning when `--max-diff-bytes` truncates. The existing
marker is in-band and addressed to the model; a caller reading `Findings: 0` had
no way to tell a clean review from one that never saw most of the change.

### Two more, outside prism

**`GITO_ENV_FILE` does not redirect gito's model.** The wrapper sources the
override, but gito re-reads `~/.gito/.env` itself with `load_dotenv(override=True)`,
so the real file wins. The first replay's own log proves it: `Can't resolve
tiktoken encoding for 'kimi-k2.7-code'` while the override said
`kimi-k2.7-code-highspeed`. Changing gito's model required editing
`~/.gito/.env` directly, which is what unblocked the gito run above.

**The receipt's per-finding `disposition` does not record the ceiling.**
`_disposition_counts` counts advisory findings but never writes back, so
`receipt.disposition.advisory` reads 30 while all 35 entries in
`receipt.findings[]` still carry `"disposition": "outstanding"`. A consumer
filtering per-finding gets the pre-ceiling answer and disagrees with the
aggregate the gate actually used. Upstream follow-up, recorded alongside 4b.3 and
4b.4 in `08-24-local-gate-advisory-severity/implement.md`.

### What this establishes, and what it does not

Established: the ceiling is adopted, reaches the plan, changes the policy digest,
and releases sub-ceiling findings from real provider output while `high` findings
still block. Criterion 3's floor holds on live data, not only on the fixture.

Not established, and the reason criterion 6 stays unmet: the replay **blocks**.
Five `high` prism findings and two `high` gito findings are outstanding, so a
caller reaching this point still needs either a disposition per finding or a
human `review.round-extension` — the same exit the original three rounds needed.
Whether those `high` findings are real defects has not been checked against the
checkout, and until it is, "the gate blocks correctly" and "the gate cannot
terminate" are indistinguishable from the receipt alone.

Nor is this a faithful replay of the 2026-08-09 sequence. Defect 2 means the
original three rounds ran with **no rules loaded at all**, and defect 1 means they
ran as a single whole-diff prompt. Today's run loads the rules and sends seven
chunks, which is why it produces 35 findings where round 1 produced 9. The gate
under test is the new one; the provider under it is also new. The convergence
question — does round 2 share findings with round 1 — needs a second round at a
new head to answer, and has not been run.

## Second replay, 2026-08-24 — the workaround, the severity measurement, and the answer

Everything below ran against PR #70's range (`c3ec5f64...2880186`) with
`PRISM_BIN` pointed at the **unpatched** prism binary — confirmed stock by its
rejection of `chunkMaxBytes` — so none of it depends on the patches in
`~/repos/ai/prism`.

### The provider defects have a repo-side workaround

`scripts/prism-chunked-review.py` does the chunking on the caller's side and
passes `--rules`, wired in through the pack's own `argv` adapter in
`.sd-ai-command-pack/review.json` — the one path `pack.install-audit` allows. No
pack change, no patched binary:

```
prism-chunked: 23 files, 147018 diff bytes, 9 chunks of at most 20000
exit 0, 56.0s, 37 findings
```

One chunk before, nine after.

**Correction, 2026-08-24.** This section previously claimed the rules reached
the model, on the grounds that all 37 findings carried categories drawn from
`focus` and nothing outside it. That is not evidence of anything.
`internal/review/prompt.go:28` hardcodes the identical eight categories into
every prompt prism builds — `bug, security, performance, correctness, style,
maintainability, testing, docs` — and this repository's `focus` array is that
same list. Every finding prism has ever produced satisfies the test, rules file
or no rules file. `BuildRulesPromptSection` (`internal/review/rules.go:52`) does
render `focus` and `required` into the prompt when a rules file loads, so the
plumbing exists; what is missing is any observation that distinguishes the two
cases. The chunking numbers above are unaffected — those come from the
provider's own diagnostic line, not from the finding set.

Two of the four defects have no workaround. An earlier run of the same provider
against Moonshot lost 6 of 9 chunks to prism's hardcoded 120s client deadline
and came back `unavailable` with 3 findings. Neither that nor the hardcoded
`MaxTokens: 8192` is reachable from the caller — both are avoided by provider
choice, not fixed. **The workaround is the argv provider plus a non-reasoning
provider; the argv provider alone is not sufficient.**

### `severityOverrides` was destroying the axis this task depends on

Requirement 3 asks for severity or category to be usable in the gate decision.
Measured, they were the same axis, and the configured one could not release
anything.

**Corrected 2026-08-24, same day.** This was first written as "two runs
identical but for the rules file", which is wrong about the mechanism. The
second run completed in 0.6s — a prism cache replay, not nine fresh model
calls — and the severities differ because `ApplySeverityOverrides`
(`internal/review/rules.go:82`, applied at `engine.go:166` and `:396`) is a
**client-side post-process** that rewrites each finding's severity from its
category *after* the model answers. The cache key does not include the rules
file, which is why the replay hit at all.

That makes the conclusion stronger, not weaker: severity under this rules file
was not merely *observed* to equal category, it is a deterministic overwrite in
code. The rules text also asks the model for the same mapping
(`BuildRulesPromptSection`), but the model's own rating never survives the
overwrite. The counts below are one model run with the rewrite applied and not
applied:

| | high | medium | low | advisory | outstanding |
| --- | --- | --- | --- | --- | --- |
| with `severityOverrides` | 19 | 15 | 3 | 18 | 19 |
| without | 7 | 25 | 5 | 30 | 7 |

With the map, `high` was exactly `correctness 14 + security 3 + bug 2 = 19`, and
advisory was exactly `docs 4 + maintainability 7 + testing 4 + style 3 = 18`.
Both sides exact. Severity carried no per-finding information at all — it was a
lookup on category, and `.prism/rules.json` pinned `bug`, `correctness` and
`security` to `high` regardless of what the finding said. A `medium` ceiling
under that map is not a severity ceiling; it is a category filter that can never
release a `correctness` observation however trivial.

Removing the map, the model's own rating survives, severity varies within
categories, and the ceiling releases 30 of 37. This is the opposite of the "narrowing the rules would suppress signal"
note recorded further down: the map was not adding signal, it was overwriting
the model's own judgement with a constant. `severityOverrides` has been removed
from `.prism/rules.json`; `focus` and the four required checks are untouched.

### The seven survivors, verified against the checkout

Every remaining `high` finding was read against its cited path and line at
`2880186`. **None is a defect in the change.**

| citation | verdict |
| --- | --- |
| `examples/sd-review.yml:70` — token grants write to a third-party container | accurate, and deliberate; :67-69 is an inline comment explaining the isolation |
| `examples/sd-review.yml:109` — empty API key vars for non-selected providers | accurate, trivial impact |
| `examples/sd-review.yml:148` — image digest may not match | **refuted** — pinned `@sha256:cae31b…`; a digest pin *is* the identity |
| `scripts/consumer-installer.mjs:185` — `JSON.stringify` key-order sensitivity | accurate mechanism; consequence is one redundant idempotent rewrite. Cited :185, code is :182 |
| `scripts/consumer-installer.mjs:232` — manifest mutated via spread | **refuted** — `{...pendingManifest}` builds a new object, and `createManifest` fully resolves at :220-226. Cited :232, code is :228 |
| `scripts/consumer-installer.mjs:252` — partial write corrupts state | **refuted** — the pending→active protocol *is* the recovery mechanism |
| `test/installer-modules.test.js:192` — name-extraction regex | **miscited** — the regex is at :211-212; :192 is `early.descriptor = {...}` |

The third refutation is the important one. That exact claim was raised and
refuted on 2026-08-09 — it is quoted in the "Observed on PR #70" section above as
one of the two that "claimed a real defect were refuted by the code". Fifteen
days and a different provider configuration later it came back verbatim. **A
rebuttal at one head does not survive to the next run.** That is the PRD's
"necessary but not sufficient" thesis, measured rather than reasoned.

### Applying the dispositions: the gate still does not converge

Four of the seven are dispositionable with today's vocabulary — three `rebutted`
and one `miscited`. Applied against the same receipt (`run: reused`, no provider
re-invocation):

```
"advisory": 30, "dispositioned": 4, "outstanding": 3
remoteGate: {"state": "blocked", "reason": "actionable-local-findings"}
```

**Three findings block, and none of them can be dispositioned without lying.**
`sd-review.yml:70` is *true*: the token does grant write access to a third-party
container. It is a deliberate, documented decision — the surrounding comment
narrows the grant specifically so the container cannot write durable receipts.
Calling that `rebutted` would be exactly the false classification claim
requirement 1 forbids. The same applies to `:109` and to the `JSON.stringify`
observation: accurate, understood, and not worth a code change.

So the remaining gap is not severity, and not miscitation. Both of those now
work. It is that the vocabulary has a ground for *"this finding is wrong"* and a
ground for *"this finding is pointed at the wrong place"*, and no ground for
**"this finding is right, and the answer is still no."**

### Additional requirement, measured 2026-08-24

- An accurate finding that the repository accepts — a deliberate design
  decision, or an observation whose consequence is not worth a change — must be
  dispositionable on that ground, distinctly from `rebutted`. Without it, three
  of seven verified-correct findings block a merge with no exit but a human
  round-extension, which is the failure this task exists to remove.

## Provider switch, 2026-08-24 — and why it does not close criterion 6

The prism patches have been retired. `~/repos/ai/prism/prism` is the stock
binary again (it rejects `chunkMaxBytes`), and both providers moved off the
Kimi reasoning models, which is what the patches' `MaxTokens` and timeout fixes
existed to accommodate.

Moonshot lists no non-reasoning model — `kimi-k2.6` (HTTP 400),
`kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k3`. DeepInfra does.
Probed at `max_tokens: 8192`, stock prism's hardcoded cap, on a 5 KB diff:

```
Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo   3.9s  finish=stop  content=188  reasoning=0
Qwen/Qwen3-235B-A22B-Instruct-2507          9.7s  finish=stop  content=253  reasoning=0
Qwen/Qwen3-Next-80B-A3B-Instruct            0.6s  finish=stop  content=146  reasoning=0
kimi-k2.7-code                                 —  finish=length content=  0  reasoning=9060
```

Both `~/.prism/.env` and `~/.gito/.env` now point at
`Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` on DeepInfra. gito's
`MAX_CONCURRENT_TASKS` went from 4 to 12 — gito issues one request per changed
file and its own default is 40, so 4 was running a 23-file branch as six serial
waves. gito on a one-commit range now completes in 12.8s; on Kimi it hit the
600s timeout.

### The gate converges, and that is not good news

Full replay, stock binary, chunked provider, no `severityOverrides`:

| provider | findings | high | advisory | outstanding | gate |
| --- | --- | --- | --- | --- | --- |
| anthropic `claude-sonnet-4-6` | 37 | 7 | 30 | 7 | blocked |
| deepinfra `Qwen3-Coder-480B` | 35 | **0** | 35 | 0 | **eligible** |

19.2s, all nine chunks clean. The receipt reaches `eligible` with no
disposition, no round-extension, and no human decision — which is literally
what the final acceptance criterion asks for.

**It should not be counted.** Qwen rated nothing `high` at all. The gate did not
converge because the ceiling correctly released observations; it converged
because the provider never engages the floor. A model that never says `high`
turns a severity ceiling into a rubber stamp, and criterion 3 — a `high`
correctness finding must still block — would pass upstream on a fixture while
being unreachable in practice here.

The two providers also barely agree: **4 of roughly 34 finding locations
overlap**, and where anthropic raised three `high` security findings — including
`GITHUB__USER_TOKEN` being handed to a third-party container — Qwen raised one,
at `medium`. That is this task's non-convergence thesis appearing on a third
axis: not just across rounds and across heads, but across providers on an
identical diff.

So criterion 6 stays unmet. Convergence that depends on which model is
configured is not the property this task is asking for.

### Settled configuration: `anthropic/claude-sonnet-4.6` via OpenRouter

Qwen was replaced after benchmarking eight non-reasoning models on one 8 KB diff
at `max_tokens: 8192`, scoring the two things the Qwen run failed — does the
model rate anything `high`, and does it catch `GITHUB__USER_TOKEN` reaching a
third-party container:

```
anthropic/claude-sonnet-4.6   $3.00/$15.00   ~6s    high=2,2     caught 1 of 2
qwen/qwen3-coder-plus         $0.65/$3.25    2.7s   high=1,1,1   caught 3 of 3
amazon/nova-pro-v1            $0.80/$3.20    1.2s   high=1       missed
openai/gpt-4.1                $2.00/$8.00    2.8s   high=0       missed
moonshotai/kimi-k2-0905       $0.60/$2.50    6-15s  high=0       caught
mistralai/mistral-medium-3.1  $0.40/$2.00    4.3s   high=0       caught
qwen/qwen3-max                $0.78/$3.90    2.6s   high=0       missed
Qwen3-Coder-480B (previous)   $0.30/$1.00    2.4s   high=0       caught
```

Zero-`high` is a model property, not an artifact of the prompt: sonnet returns
two `high` findings on the identical prompt where six others return none. Cost
is not the deciding factor at this volume — a full 147 KB branch review is about
40k input and 5k output tokens, roughly $0.20 on sonnet against $0.04 on the
cheapest option. Sonnet is reasoning-capable but does not reason unless asked;
both probes returned `finish_reason: stop` with zero reasoning tokens, so it
stays inside stock prism's hardcoded 8192-token cap.

Full replay on the stock binary, nine chunks, 50.2s, exit 0:

```
27 findings -> 16 low, 9 medium, 2 high
advisory 25, outstanding 2, remoteGate blocked / actionable-local-findings
```

Both `high` findings are security, and both follow the pattern already
established. `examples/sd-review.yml:115` — "all provider API keys injected
unconditionally" — is accurate in form and trivial in impact: the env vars are
always present, with `|| ''` supplying empty values for non-selected providers.
`examples/sd-review.yml:152` — "pinned by digest but image name uses mutable tag
pattern" — is **refuted**: the line reads `pragent/pr-agent@sha256:cae31b…` and
carries no tag at all.

**This is the cleaner statement of the same result.** With a provider that does
engage the floor, the gate blocks — and the findings it blocks on are, once
verified, one trivially-accurate observation and one false claim. Neither is a
defect in the change. So the gap is not provider calibration and not the
ceiling: it is still the missing disposition ground recorded above. Two capable
providers, two different finding sets, same structural outcome.

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

- [x] A finding whose cited path and line do not contain the described code can
      be dispositioned on that ground specifically, distinctly from a finding
      that is real but low-severity — asserted by a test that supplies a `high`
      severity finding with a bad citation and shows it does not block, while a
      `high` finding with a good citation still does.
      — `--local-disposition '<id>=miscited@<path>:<line>'`, a ground distinct
      from `rebutted`. Both halves are in one test in the pack's review-stage
      test module, `test_miscited_releases_a_high_finding_that_otherwise_blocks`:
      the same `high` finding blocks with no disposition and clears with the
      miscitation, so the release cannot be confused with the gate being weak.
      Severity and miscitation are separate axes — `test_one_advisory_finding_does_not_release_a_blocking_sibling`
      shows the ceiling is per-finding, not a whole-receipt verdict.

## 2026-08-25 — the binary claim above is out of date, and criterion 6 is parked

Two things changed after the provider-switch section was written, and one of
them makes a statement in it false as of today.

### The patches are back, from a fork

"The prism patches have been retired. `~/repos/ai/prism/prism` is the stock
binary again (it rejects `chunkMaxBytes`)" was true on 2026-08-24 and is not
true now. The work was rebuilt on a personal fork, `sdelmas/prism`, whose `main`
carries both fix branches as merge commits, and `~/bin/common/prism` resolves to
a binary built from it. Nothing in this repository or the other eight consumers
selects that build by configuration — the pack and the chunked provider both
invoke the bare string `prism`, and the wrapper on `PATH` is the only one. The
fleet runs the fork because there is nothing else to run, which is worth stating
plainly: it is not a setting anyone can check, so it is also not a setting
anyone can get wrong.

No change goes to `dshills/prism`; the `upstream` push URL is `DISABLED` by
owner directive.

### A fifth defect, and why the chunked provider stays

`scripts/prism-chunked-review.py` justified itself by two stock-prism defects —
the unreachable chunker and `.prism/rules.json` never loading. Both are fixed in
the fork, so read literally the script argued for its own deletion. Measuring
before deleting found a third defect that the script never named and that keeps
it load-bearing: `NeedsChunking` gates on its own `ChunkThreshold` constant of
100 KB rather than on `ChunkMaxBytes`, so a delta below 100 KB never reaches
`SplitIntoChunks` at all and the configured 20 KB chunk size is simply not
consulted.

A/B on this repository's own delta, same binary, `main..HEAD`, 47,563 bytes
across 8 files:

| path | findings | severity | wall clock |
| --- | --- | --- | --- |
| plain `prism review range` | 15 | 1 high, 6 medium, 8 low | 81.7s |
| `prism-chunked-review.py` | 19 | 8 medium, 11 low | 51.9s, 3 chunks |

The band that matters — larger than one good prompt, smaller than prism's
chunking gate — is where ordinary branches live. Recorded in the script's
docstring so the next reader does not repeat the deletion attempt.

This is a fourth axis for the non-convergence thesis, and the sharpest one yet:
the same provider, the same model, the same diff and the same binary produce
different finding sets depending only on how the diff was cut. Convergence that
depends on chunk boundaries is no more the property this task wants than
convergence that depends on which model is configured.

### Criterion 6 cannot close here — parking

The remaining criterion needs a disposition ground for "this finding is right,
and the answer is still no". The vocabulary has `rebutted` and `miscited`;
neither fits a finding that is true, understood, and deliberately accepted. That
ground is pack-owned, and it is filed as sd-ai-command-pack task
`08-24-accepted-finding-disposition-ground`, whose own final criterion is this
replay reaching `eligible`.

Waiting is the correct state, but leaving the task `in_progress` misreports it
as work in flight. Parked against that dependency, on the same convention the
2026-08-09 and 2026-08-15 parks used. It resumes when the pack ships the ground
— not on a pack refresh, which is the mistake the 2026-08-24 note already
records for requirement 3.

## 2026-08-25 — the ground shipped, and what closing criterion 6 requires

`accepted` shipped in sd-ai-command-pack **0.71.51** (PR #541). The vocabulary
is now `rebutted`, `miscited`, `accepted`, in both the stage and the controller,
and a receipt carrying an accepted finding reaches `remoteGate: eligible` with
`reason: local-findings-accepted` — a fourth gate reason, distinct from
`local-findings-dispositioned`, so a waiver is legible as a waiver in the
receipt rather than being folded in with rebuttals. The dependency this task was
parked against is discharged.

### What closing criterion 6 actually requires

The criterion has been carried alongside one run's arithmetic — `advisory: 30,
dispositioned: 4, outstanding: 3` — and those numbers are not a target. The
replay history in this file records **37**, **35**, and **27** findings across
three runs, differing by provider, by model, and (per the fourth axis above) by
chunk boundary alone. A criterion stated in counts cannot be met except by
coincidence, and a near miss can always be argued into a pass. That is the
failure mode this restatement exists to remove.

Criterion 6 closes when, in a single replay of the PR #70 sequence:

1. Every finding the gate treats as blocking is verified against the checkout,
   individually, with the verification recorded.
2. Each is dispositioned on the ground that matches what verification found —
   `rebutted` where the finding is wrong, `miscited` where it points at the
   wrong place, `accepted` where it is right and the answer is deliberately
   still no, each `accepted` carrying its reason.
3. The gate reports `remoteGate.state == "eligible"`. Where any finding was
   accepted, `remoteGate.reason == "local-findings-accepted"`.
4. No human round-extension decision is spent.

No finding count appears in that list, because no finding count is the property
under test. What is under test is that the vocabulary can express the true
disposition of every blocking finding a real replay produces.

### The failure condition, named before the run

If verification finds that a blocking finding is a **genuine defect in the
change**, `accepted` is the wrong disposition and the correct action is to fix
the code. The ground existing does not make that outcome a pass, and reaching
`eligible` by accepting a real defect is the specific abuse this criterion must
not reward. Record it as a failed replay and fix the finding.

### Cost, stated because it is not free

The replay is a live paid provider run against `sdelmas/prism`. The A/B above
puts a pass in the 52–82s band, though that was measured on this repository's
own delta rather than on PR #70's larger range, so treat it as an order of
magnitude and not a budget. There is no stored receipt to redispose: each
attempt is a new call producing a new finding set.
That is a reason to state the criterion structurally before spending one, not a
reason to defer it.
