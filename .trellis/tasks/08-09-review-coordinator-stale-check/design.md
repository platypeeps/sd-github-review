# Design — stop the coordinator replaying a stale deterministic-check failure

> **Superseded — do not implement as written.** This document specifies
> **pass-only reuse**: keep serving a cached `passed` report, refuse a cached
> failure. The owning upstream task, `08-07-review-check-stale-cache` in
> `sd-ai-command-pack`, requires the opposite — recompute the deterministic
> check on **every** invocation — and explicitly supersedes cached-pass reuse.
> The subject file is vendored, so nothing here can land in this repository
> anyway. Retained as a recorded, refuted alternative and for its mechanism
> analysis, which remains accurate. See the two closing sections of `prd.md`.

## Current mechanism

Three pieces in `scripts/sd-ai-command-pack-review.py` produce the defect together.

`_state_identity` (line 534) builds the key the private state file is named from:

```python
return {
    "repository": str(repo), "scope": scope, "head": head, "base": base,
    "worktreeDigest": worktree_digest, "prNumber": pr.get("number") if pr else None,
    "controls": dict(controls),
}
```

`_attempt_id` (line 615) turns that into the filename, `review-<digest(identity)[:24]>.json`,
unless the caller supplies one. `args.attempt` is not in the identity, so `--attempt N` reuses
the same file. The cache read (line 1796) is:

```python
if state.get("check") is None:
    check = _run_check(repo)
    _advance(state_path, state, "check", check=check)
check = state["check"]
```

`_run_check` shells out to `sd-ai-command-pack-check.py` live and returns the typed report.

## The actual defect

The cache is keyed on the identity, but a check's *subject* is not always inside that identity.
Five recurrences, three distinct subjects:

| Subject | Inside the identity? | Recurrences |
|---|---|---|
| tracked working-tree content | yes — a fix moves `head` or `worktreeDigest` | — |
| `.obsidian-kb` (symlink outside the tree) | no | 1–4 |
| the GitHub pull-request body | no — not in the working tree at all | 5 |

For subjects in row one the cache is correct: remediation necessarily changes the identity, so
the state file rotates and the check re-runs. For rows two and three remediation changes
nothing the identity observes, so the failure is replayed forever and no documented argument
reaches a live re-run.

The trap generalizes badly: enumerating "which subjects live outside the digest" is a list that
drifts every time a check is added. Row three did not exist when rows one and two were
analyzed.

## Chosen approach — cache only a passing check

```python
cached = state.get("check")
if isinstance(cached, dict) and cached.get("status") == "passed":
    check = cached
else:
    check = _run_check(repo)
    if check.get("status") == "passed":
        _advance(state_path, state, "check", check=check)
    else:
        # In-memory only, so the blocked report below still carries the check's
        # own diagnostics. Deliberately not persisted: a failed check must be
        # re-run on the next invocation, because its cause may have been
        # remediated outside the state identity.
        state["check"] = check
```

The reuse predicate is "the cached value is a passing report", not "the cached value exists".
Testing for `is None` would be wrong in exactly the case that matters most: state files written
by today's code already hold non-null *failed* reports, and `_load_or_create_state` (line 623)
returns an existing file unchanged. A presence test would therefore reuse precisely the stale
failures this task exists to eliminate, and every operator currently stuck behind one would stay
stuck after the upgrade. The `isinstance` guard also keeps a malformed cached value from
reaching `.get`, and the existing shape check below the block still runs on the result.

The in-memory assignment is not incidental. `_report` builds its payload from the state dict —
`"check": state.get("check")` at line 1623 — so persisting nothing at all would make every
`blocked` result carry `check: null`, destroying the per-check `status`, `diagnostic`, and
`durationMs` fields. Those fields are what identified all five recurrences; losing them to fix
the replay would trade one diagnosis problem for a worse one. The failure path returns
immediately after `_report`, so no later `_advance` can promote the in-memory value to disk.

The cache's stated purpose is to make a resume at an unchanged head cheap. That value is
entirely in the *passing* case: a passed check means the run proceeds to the expensive local
and remote stages, and re-running the suite on every resume of a long review would be pure
waste. A *failed* check ends the run immediately at `blocked` — there are no later stages to
protect, and the operator's next action is by definition to fix something and retry. Caching
the failure buys nothing and costs the only thing that matters: the retry's correctness.

This does not require knowing which subjects live outside the digest, so a sixth check with a
sixth kind of external subject inherits the fix for free.

### Why not the alternatives the PRD listed

- *KB-state fingerprint in `_state_identity`* — fixes row two only. Row five proves the list is
  open-ended, and a PR body cannot be fingerprinted without a network call on every invocation.
- *Re-run only checks whose subject lies outside the content digest* — requires each check to
  declare its subject's containment, a new field on every check and a classification to keep
  correct forever. Strictly more machinery for strictly less coverage.
- *A bounded documented re-check control* — the PRD already rejects it: it fixes the symptom
  and leaves the trap. It also keeps the operator responsible for noticing the replay, which
  took five recurrences and a `durationMs` comparison to notice even once.

## Round-limit interaction

The round-limit refusal is raised at lines 1687–1695, during argument validation — before
`_load_or_create_state` at line 1725, before the check runs, and before any provider executes.
The coordinator keeps no record of which earlier numbered attempts actually reached a provider,
so *true* round accounting ("spend the budget only on attempts that executed a provider") would
require new per-attempt state. That is a separate change with its own risk, and this task does
not take it on.

What this fix does deliver is narrower and sufficient for the observed failure. In PR #71 the
operator had to keep incrementing `--attempt` only because re-running the *same* attempt number
replayed the cache; that escalation is what walked the run into the limit. Once a failed check
is never cached, re-running the same attempt number re-runs the check live, so remediation
converges without spending a further numbered attempt and the replay can no longer push a run
toward the limit at all. The acceptance criterion is worded to that property, and the round
limit itself is left untouched — the criterion is closed by needing fewer attempts, never by
raising or relaxing the limit.

## Compatibility and blast radius

- No schema change. A newly created state file keeps `"check": null` until a check passes (a
  legacy file retains whatever failed report it already holds until a passing run overwrites it,
  which is harmless because the reuse predicate rejects it); `_load_or_create_state`
  already initializes that field to `None` and `_report` reads `state.get("check")`, so a state
  file written by the old code stays readable. Because the reuse predicate tests for a *passing*
  report rather than for presence, a state file carrying a cached failure from the old code is
  re-run rather than trusted — every operator currently stuck behind a stale failure is released
  by the upgrade itself, with no state file to delete by hand.
- No CLI change: `--attempt-id` stays exactly as it is. This task does not document it as a
  public control, because after the fix it is no longer needed to escape a replay.
- Cost: one extra `sd-check` execution per resume of a *failing* review. The observed suite runs
  in well under a second (`733`–`858` ms across the recurrences above).

## Test surface

The coordinator has no test coverage today — nothing in `test/` references
`sd-ai-command-pack-review.py`. The repository's established shape for a helper's contract is a
hermetic `--self-test` inside the helper plus a node test that invokes it, as
`scripts/sd-ai-command-pack-housekeeping.sh:1197` (`self_test_scenario`) is driven by
`test/housekeeping-contract.test.js`. That precedent is a **bash** helper; there is no existing
Python-helper `--self-test` in this repository, so this task *adapts* the convention rather than
following an established one. The adaptation is still preferable to introducing a Python test
runner the repo does not have.

Hermeticity needs more than a stub check helper, and this is the part that is easy to get wrong.
Once a check returns `passed` the coordinator falls directly into `_run_local` (line 1808), and
the comment at lines 692–694 is explicit that the coordinator's private root is *not* forwarded
to the local helper — which creates run directories and JSON artifacts under the repository's
`.build/sd-review`. PR scope additionally performs GitHub capability and evidence work before
the check runs. A self-test that stubbed only the check helper would therefore write inside the
repository and, under PR scope, reach the network.

The fixture must consequently:

- run against a **temporary Git repository**, not the checkout under test, so no artifact can
  land in `.build/sd-review`;
- stub **both** `CHECK_SCRIPT` and `LOCAL_SCRIPT`, so a passing check cannot start a real local
  provider run;
- use `--scope changes`, never `--scope pr`, so no GitHub capability or evidence path executes;
  the cache logic under test is scope-independent; and
- point the private state root at a temporary directory.

Housekeeping's self-test sets the bar here — it empties `PATH` and overrides every external
collaborator in-process — and this fixture is held to the same standard: no network, and no
write anywhere inside the repository under test.

## Rollback

One commit touching one call site plus the added self-test and its node test. Revert with
`git revert <sha>`; there is no migration, no persisted format change, and no consumer-visible
contract to unwind.
