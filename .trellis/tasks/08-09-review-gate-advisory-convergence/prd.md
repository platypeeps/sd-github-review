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
      — `--local-disposition '<id>=rebutted'`; `tests/test_review_stage.py`
      `test_rebutted_local_finding_clears_the_gate_but_stays_visible`.
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

One chunk before, nine after. And the rules reach the model: all 37 findings
carry categories drawn from `focus` and nothing outside it.

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

Two runs, identical in every respect but the rules file. The finding sets are
**identical** — same 37 findings, same paths, same summaries, zero difference
either way — so only the severity rating varies:

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

Removing the map, severity varies within categories and the ceiling releases 30
of 37. This is the opposite of the "narrowing the rules would suppress signal"
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
      from `rebutted`. Both halves are in one test,
      `tests/test_review_stage.py::test_miscited_releases_a_high_finding_that_otherwise_blocks`:
      the same `high` finding blocks with no disposition and clears with the
      miscitation, so the release cannot be confused with the gate being weak.
      Severity and miscitation are separate axes — `test_one_advisory_finding_does_not_release_a_blocking_sibling`
      shows the ceiling is per-finding, not a whole-receipt verdict.
