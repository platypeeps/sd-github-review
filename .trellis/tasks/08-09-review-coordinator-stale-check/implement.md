# Implementation plan — cache only a passing deterministic check

Acceptance-criterion numbering below follows `prd.md` as it now stands: AC 1 remediated-outside,
AC 2 still-failing, AC 3 cached-pass-not-rerun, AC 4 same-attempt convergence, AC 5 a test that
fails against today's code.

## Step 1 — establish the failing test first

Add the hermetic self-test before the fix, and prove it fails against today's code. AC 5 is
"a test that fails against today's code"; a test written after the fix cannot demonstrate that.

1. Add `--self-test` to `scripts/sd-ai-command-pack-review.py`, using
   `scripts/sd-ai-command-pack-housekeeping.sh:1197` (`self_test_scenario`) as the shape
   reference. That precedent is a bash helper, so this is an adaptation, not an existing Python
   convention — hold it to the same hermeticity bar housekeeping sets.
2. Build the fixture per `design.md`'s test-surface section. All four constraints are required,
   not optional hardening:
   - a **temporary Git repository**, never the checkout under test;
   - stubs for **both** `CHECK_SCRIPT` and `LOCAL_SCRIPT` — a passing check falls straight into
     `_run_local` (line 1808), whose artifacts are written under the repository's
     `.build/sd-review` because the coordinator's private root is deliberately not forwarded
     (lines 692–694);
   - `--scope changes`, never `--scope pr`, so no GitHub capability or evidence path runs;
   - a temporary private state root; and
   - the stub's invocation counter stored **outside** the temporary Git repository, so writing
     it cannot perturb `worktreeDigest` and rotate the very state file under test.

   The check stub returns a scripted sequence of typed reports, so each scenario controls what
   the "live" check says on the first and second invocation, and counts how many times it was
   actually invoked. That invocation count is the assertion separating a replay from a live
   re-run — the same discriminator the `durationMs` comparison provided by hand.
3. Four scenarios:
   - **remediated-outside-content** (AC 1) — first invocation returns `failed`, second returns
     `passed`, identity unchanged. Expect: stub invoked twice, second run reports the live
     `passed`. *Fails today* — invoked once, replays `failed`.
   - **still-failing** (AC 2) — both invocations return `failed`. Expect: still `blocked`, with
     the check's own diagnostic unchanged, and the reported `check` field populated rather than
     `null`. Passes today; it guards against weakening the gate and against the `check: null`
     regression the in-memory assignment prevents.
   - **cached-pass-not-rerun** (AC 3) — first invocation returns `passed`, then resume at an
     unchanged identity. Expect: stub invoked exactly once. Passes today; it guards the cache's
     surviving purpose.
   - **stale-failure-from-old-state** (AC 1, upgrade path) — pre-write a state file containing a
     non-null *failed* check, as today's code produces, then invoke with the stub scripted to
     return `passed`. Expect: stub invoked once and the live `passed` reported. *Fails today* —
     and it also fails against a fix whose reuse predicate tests `is None` instead of testing for
     a passing report, which is exactly the mistake this scenario exists to catch.
4. Add `test/review-coordinator-contract.test.js` invoking the self-test, mirroring
   `test/housekeeping-contract.test.js`, so `npm test` covers it.
5. Run `npm test` and record the pre-fix result:

   ```bash
   npm test 2>&1 | tail -30
   ```

   Expected before the fix: **two** scenarios fail — `remediated-outside-content` and
   `stale-failure-from-old-state`. `still-failing` and `cached-pass-not-rerun` must already pass;
   they encode behavior the fix preserves. If either failing scenario passes before the fix, the
   stub is not exercising the cache — stop and correct the fixture rather than proceeding.

## Step 2 — apply the fix

In `scripts/sd-ai-command-pack-review.py`, at the check call site (line 1796):

```python
cached = state.get("check")
if isinstance(cached, dict) and cached.get("status") == "passed":
    check = cached
else:
    check = _run_check(repo)
    if check.get("status") == "passed":
        _advance(state_path, state, "check", check=check)
    else:
        # In-memory only, so the blocked report keeps the check's diagnostics.
        # Never persisted: a failed check must re-run on the next invocation.
        state["check"] = check
```

Three details that are easy to get wrong:

- The reuse predicate tests for a **passing report**, not for presence. `if cached is None`
  would reuse the non-null failed reports today's code has already written to operators' state
  files, preserving the exact defect being fixed. `stale-failure-from-old-state` is the scenario
  that catches this.
- Remove the unconditional `check = state["check"]` that currently follows the block; keeping it
  would discard the freshly-run failing report and read back `None`.
- The `state["check"] = check` on the failure path is required, not decorative. `_report` reads
  `state.get("check")` (line 1623), so without it every `blocked` result would carry
  `check: null` and lose the per-check `status`, `diagnostic`, and `durationMs` fields — the
  very fields used to diagnose all five recurrences.

Change nothing else — not `_state_identity`, not `_attempt_id`, not the `--attempt-id` flag, and
not the round-limit check at lines 1687–1695.

## Step 3 — validate

```bash
npm test
npm run test:coverage
npm run check
node scripts/sd-ai-command-pack-review-preflight.mjs
```

Expected: all four scenarios pass; the pre-existing suite stays at its current pass count with
zero new failures; coverage does not regress; preflight reports 0 failures.

### End-to-end check on a real run

The self-test drives stubs, so confirm the behavior once against the real coordinator. The
check must arrange a genuine failure remediated outside tracked content — two plain runs at an
unchanged head would prove nothing, because if the first run *passes* the design intentionally
caches it and the second run correctly reuses it (that is AC 3, not a defect).

Arrange it deliberately:

1. Make `knowledge.obsidian-kb` stale by editing a spec file, and run the coordinator until it
   reports `blocked` on that check.
2. Refresh the KB with `scripts/sd-ai-command-pack-update-spec-kb.py --if-present`. This changes
   no tracked content, so the head and worktree digest are unchanged.
3. Re-run the coordinator at the **same** `--attempt` number, with no `--attempt-id`:

   ```bash
   bash scripts/sd-ai-command-pack-toolchain.sh run-python -- \
     scripts/sd-ai-command-pack-review.py --repo . --scope changes \
     --local auto --remote auto --fix auto --attempt <same n> --json
   ```

   Use `--scope changes`, not `--scope pr`. Step 1 leaves the spec edit in the working tree, and
   PR scope refuses a dirty tree at line 464 — "PR scope requires a clean working tree" — before
   execution ever reaches the cache call site, so the PR-scoped form of this check cannot run.
   The caching logic under test is scope-independent.

   Expected: the check now reports `passed`. The oracle is the `failed` → `passed` transition at
   an unchanged identity, which is only reachable by a live re-execution. Do **not** treat
   differing `durationMs` as the proof: two live runs can round to the same millisecond, so
   equality is weak evidence in one direction and no evidence in the other. `durationMs` was the
   manual diagnostic that first exposed the replay; it is corroboration here, not the test.

   This single run also closes AC 4: convergence required no further numbered attempt.

## Step 4 — mutation check

Assertion is not evidence. Run two mutations, restoring after each:

- Replace the reuse predicate with `if cached is not None:` — `stale-failure-from-old-state`
  must fail.
- Remove the `if check.get("status") == "passed":` guard so failures are cached again —
  `remediated-outside-content` must fail.

A scenario that does not fail against the corresponding broken implementation proves nothing and
must be rewritten.

## Review gates

- The self-test writes nothing inside the repository under test and makes no network call.
- The gate is not weakened: `still-failing` must still report `blocked` with the check's own
  diagnostic, and the reported `check` field must not be `null`.
- No new public CLI control is added; `--attempt-id` is unchanged and stays undocumented.
- The round limit at lines 1687–1695 is untouched.

## Rollback

`git revert <sha>` on the single implementation commit. No schema, persisted format, or
consumer-visible contract changes, so nothing else unwinds.
