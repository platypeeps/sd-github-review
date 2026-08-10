# Review coordinator replays a stale sd-check failure remediated outside the content digest

## Goal

Stop `sd-review` from blocking indefinitely on a deterministic-check failure that has already
been fixed, when the fix does not change any tracked repository content.

## Problem

`scripts/sd-ai-command-pack-review.py:1796` caches the typed check result in the coordinator's
private state and replays it on every later invocation:

```python
if state.get("check") is None:
    check = _run_check(repo)
    _advance(state_path, state, "check", check=check)
check = state["check"]
```

The state file is `<artifact-root>/review-<digest(identity)[:24]>.json`, and `_state_identity`
covers repo, scope, head, base, worktree digest, PR number, and controls — **not** `args.attempt`. So
`--attempt N` does not produce a fresh state file, and a cached failure survives every retry.

That is correct when the failure lives in tracked content, because fixing it moves the head or
the worktree digest. It is wrong for `knowledge.obsidian-kb`, whose subject is `.obsidian-kb` —
in this repository a symlink to a path outside the working tree. Refreshing the KB fixes the
check and changes no digest, so the coordinator replays the stale failure forever and no
argument reaches a live re-run.

### Observed

PR #68, 2026-08-09. Editing three docs made the KB stale; the check failed correctly. After
`scripts/sd-ai-command-pack-update-spec-kb.py` reported `copies: 496 / conflicts: none`, three
further coordinator invocations — including `--attempt 3` — each replayed byte-identical output,
`durationMs 259` and all, while the standalone gate reported 7/7 passed:

```
coordinator:  knowledge.obsidian-kb failed — copies: 493 ... expected copies: 496
standalone:   sd-check: passed {'failed': 0, ..., 'passed': 7}
```

The only exit was `--attempt-id <fresh>`, which is not a documented `sd-review` control.

### Prior occurrences

Third recurrence. Previously seen on PR #41 (520/524 reported against 524/524 live) and once
more between. Both earlier investigations concluded "environment isolation artifact" and
proceeded through housekeeping. That diagnosis was wrong: `_run_check` shells out live and
inherits the ambient environment except for cache variables. The cause is the state replay
above, and the identical `durationMs` across invocations is the evidence.

**Fourth recurrence: PR #70, 2026-08-09.** Same shape, same trigger. A spec edit made the KB
stale and `knowledge.obsidian-kb` failed correctly at `copies: 496 / expected 497`. After
`sd-ai-command-pack-update-spec-kb.py` reported `copies: 497 / conflicts: none` and the
standalone `--check` exited 0, the coordinator replayed the identical failure — same
`durationMs: 258`, same `copies: 496` — while the live gate reported 497. Two data points this
run make the replay unambiguous: the *preceding* attempt at the parent head had recorded
`durationMs: 196 / copies: 497 / passed`, so the cache is per-attempt state rather than a
global one, and the two attempt-2 invocations were byte-identical to each other.

The exit used was `--attempt-id <fresh>`. Correcting one detail in the problem statement above:
`--attempt-id` *is* a real coordinator CLI flag (`sd-ai-command-pack-review.py --help` lists it),
it is simply undocumented in `sd-review`'s public control list — so the workaround requires
reading the script rather than the skill. That gap is part of what this task should close: the
documented `--attempt N` control is the one that does not work.

**Fifth recurrence: PR #71, 2026-08-09.** A different check and a worse outcome. The failing
subject was `pack.review-scope` — "tooling/generated files changed, but the PR body does not
include a recognized tooling/generated scope section" — whose remediated artifact is the
**GitHub pull-request body**, further outside the content digest than the `.obsidian-kb`
symlink because it does not live in the working tree at all. The section was regenerated with
the pack's own `sd-ai-command-pack-pr-body-scope.py --prepare-tooling-body` and applied via
`gh pr edit --body-file`; no tracked file changed, so the head stayed `d9e31e9`. The
standalone validator then exited 0 ("PR body scope sections cover detected change
categories") while attempts 3, 4, and 5 all replayed `failed` at a byte-identical
`durationMs: 733`. The escape run under a fresh `--attempt-id` passed at `durationMs: 858`.

What makes this recurrence worse than the first four: attempt 6 never reached the cache at
all, exiting `status: invalid` / `phase: setup` with "attempt exceeds remoteIntegration
roundLimit; record the structured review.round-extension decision before continuing". Attempts
4 and 5 ran no provider and revealed nothing — they existed only to prove the replay — yet
they still consumed the round budget. A stale cache that merely delayed a run now manufactures
an operator gate for an already-remediated check.

## BLOCKED — the fix belongs upstream, not in this repository

**2026-08-09.** The implementation was written, validated, and then reverted here, because
`scripts/sd-ai-command-pack-review.py` is a **vendored** copy owned by `sd-ai-command-pack`
(present locally at `../sd-ai-command-pack`). Two independent pieces of evidence:

- The file's entire history in this repository is pack refreshes — `chore: refresh
  sd-ai-command-pack to 0.64.0 (#29)` and `... to 0.54.0`. It has never carried a local edit.
- With the fix applied, the deterministic gate failed: `pack.install-audit` reported "installed
  target drifted from pack 0.64.3 content: scripts/sd-ai-command-pack-review.py". The audit's
  local-edit allowlist (`LOCAL_ALLOWED_PACK_FILES`) covers only `.sd-ai-command-pack/*.json`
  configuration, so there is no sanctioned way to carry this change here. Even if the gate were
  bypassed, the next pack refresh would overwrite it.

This is why the planning artifacts read as though the file were repo-owned: `task.json`
`relatedFiles` lists it, and nothing in the task directory recorded the vendoring boundary.
Any future task touching a `scripts/sd-ai-command-pack-*` path should check ownership first.

### What was proven before the revert

The work is not lost — it is complete and evidence-backed, just landed in the wrong repository:

- The fix is a one-site change: reuse a cached check only when it is a well-formed report whose
  `status` is `passed`, and keep a failing report in memory rather than on disk.
- A hermetic `--self-test` with five scenarios was added to the coordinator, driven by
  `test/review-coordinator-contract.test.js`. Against unmodified code exactly three scenarios
  failed (`remediated-outside-content`, `stale-failure-from-old-state`, `failure-not-persisted`);
  with the fix all five passed, and `npm test` reported 637 pass / 0 fail against a 635 baseline.
- Mutation testing corrected a design assumption: the **pass-only reuse predicate is the
  load-bearing fix**, and the non-persistence guard is state hygiene, not correctness. Restoring
  failure-caching breaks only `failure-not-persisted`; it does not break
  `remediated-outside-content`, because the predicate still refuses the cached failure.

The reverted implementation is preserved outside the repository for transfer; `design.md` and
`implement.md` remain accurate and are directly executable against `../sd-ai-command-pack`.

### What unblocks this

Explicit approval for a pull request against `sd-ai-command-pack`, which the autonomous
run-level authority excludes. After that lands and a pack refresh brings 0.64.4+ into this
repository, `test/review-coordinator-contract.test.js` and the `error-handling.md` spec section
can follow here.

## Requirements

- A remediated check must be re-runnable without inventing an undocumented `--attempt-id`, and
  without deleting coordinator state by hand.
- Do not weaken the gate: a check that is genuinely still failing must still block.
- ~~Do not make every invocation re-run the full check suite; the cache exists to make a resume at
  an unchanged head cheap, and that property should survive.~~ **Superseded.** The owning upstream
  task requires recomputing the deterministic check on every invocation: correctness over reuse.
  Only the expensive local and remote stages stay memoized.

## Acceptance criteria

- [ ] With a cached failing check whose cause is fixed outside tracked content, one documented
      `sd-review` invocation re-runs the check and reports the live result.
- [ ] With a cached failing check whose cause is **not** fixed, the same invocation still reports
      blocked.
- [ ] ~~A resume at an unchanged head with a cached *passing* check does not re-run the suite.~~
      **Superseded** by the upstream recompute contract, which requires a cached *pass* to be
      recomputed too — a live input that has since broken must block. Replaced upstream by: the
      coordinator's verdict equals a direct `sd-check` run's verdict on the same tree, for both a
      pass and a fail, with state pre-seeded to the opposite verdict.
- [ ] After a cause is remediated outside tracked content, re-running the **same** attempt
      number reaches the live result, so escaping a replay never requires spending a further
      numbered attempt.
- [ ] The behavior is covered by a test that fails against today's code.

## Notes

Candidate approaches, to be settled in design rather than here: include a KB-state fingerprint in
`_state_identity`; re-run only checks whose subject lies outside the content digest; or promote a
bounded, documented re-check control. The third alone would fix the symptom and leave the trap
for the next operator.

Found while shipping `08-09-descriptor-contract-path`; the workaround used there was a fresh
`--attempt-id`, recorded in PR #68.

## Upstream: already filed there, and this task's design is superseded (2026-08-09)

The upstream task exists and predates this one: `08-07-review-check-stale-cache`
in `sd-ai-command-pack`, P1, `planning`, filed 2026-08-07 from a different
consumer (`platypeeps/se-ai-command-pack`). It reaches the same defect from the
same call site and is more thorough — it pins citations to `v0.64.27`, identifies
`pack.review-scope` as the one genuinely blocking live-input check, and notes
that `7865666c` (first in `v0.64.22`) already downgrades an external-symlink
`knowledge.obsidian-kb` failure to `skipped`. Under that change the four
`.obsidian-kb` recurrences recorded above would no longer block; only the fifth,
`pack.review-scope` on PR #71, would.

This repository's evidence was appended to that task rather than duplicated:
platypeeps/sd-ai-command-pack#406.

### The design here is rejected upstream — do not implement it as written

`design.md` and `implement.md` specify **pass-only reuse**: keep serving a cached
`passed` report, refuse a cached failure. The upstream PRD requires the opposite
and says so explicitly — "the source's cached-pass-reuse AC ... is superseded by
this task's recompute contract — recompute wins, correctness over reuse. Do not
resurrect the reuse AC." It requires recomputing the deterministic check on
**every** invocation, and carries an acceptance criterion for the stale-**pass**
direction, which pass-only reuse leaves unfixed.

So AC 3 above ("a resume at an unchanged head with a cached passing check does
not re-run the suite") also conflicts with the upstream contract and does not
survive. Treat both design artifacts as a recorded, refuted alternative: the
validated implementation in scratchpad is evidence that the smaller change works,
not a patch to submit. The reference implementation upstream will build from is
`bc01bc2` in `se-ai-command-pack`, which extracts a `_resolve_check` helper.

Two findings from the work here do carry forward and were sent upstream:

- The failing report must stay in the emitted result. The coordinator's `check`
  diagnostics are how all five recurrences here were identified, and a naive fix
  that emits `check: null` on a failure would destroy that.
- Escaping a replay must cost no numbered attempt. The `roundLimit` refusal fires
  before the state file is loaded, so attempts spent proving a replay are spent
  anyway — which is how PR #71 reached the attempt-6 `review.round-extension`
  demand for an already-remediated check.

### What unblocks this now

Not a fix PR from here. The remedy is upstream's to design under its own
recompute contract. This task resumes when a pack release carrying that fix is
refreshed into this repository; at that point the local
`test/review-coordinator-contract.test.js` and the `error-handling.md` spec
section can follow, if they still add anything the upstream tests do not.
