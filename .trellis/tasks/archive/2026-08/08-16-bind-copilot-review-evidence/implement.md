# Bind copilot-route review evidence to the dispatch that caused it — Implementation Plan

Two repositories, in order. The code lands upstream in
`platypeeps/sd-ai-command-pack`; the spec record and verification evidence land
here in `platypeeps/sd-github-review`. Step 1 does not depend on this
repository, and step 2 depends on step 1 being released.

## Execution Order

### Stage A — upstream fix (`~/repos/platypeeps/sd-ai-command-pack`)

1. **Branch.** From clean `main`: `task/bind-copilot-review-evidence`.

2. **Write the failing tests first** in `tests/test_review_controller.py`,
   beside the existing two-write tests (`:1992-2110`). Reuse
   `routed_review_context` and the `routed_receipt(request, phase=..., status=...)`
   helper — it already takes `status`, so both dispatch statuses go through the
   real two-write sequence rather than a synthesized terminal write.

   - `test_already_present_dispatch_qualifies_remote_confidence` — drive
     `phases = iter([None, "started", "observed"])` with
     `status="already-present"`; assert `(code, status) == (0, "ready")` and
     `report["limitations"] == ["remote-evidence-not-dispatch-caused"]`.
   - `test_requested_dispatch_claims_remote_confidence` — same sequence with the
     default `status="requested"`; assert `report["limitations"] == []`. This is
     the regression guard for acceptance criterion 2.
   - `test_dispatch_status_does_not_change_harvested_findings` — patch
     `_collect_observation` with a `status: "findings"` observation carrying one
     `CHANGES_REQUESTED` review; run once per dispatch status and assert the
     `remote` finding payloads are equal between the two runs while only
     `limitations` differs. This is acceptance criterion 3, asserted rather than
     asserted-about.

   All three drive the real two-write sequence
   (`phases = iter([None, "started", "observed"])`) rather than a synthesized
   terminal write — that is acceptance criterion 4, and the fixture that only
   ever produces the second write is the one the sibling receipt-cache-race task
   was burned by.

   Run them: `.venv/bin/python -m unittest tests.test_review_controller -v`.
   The pack's suite is **unittest**, sharded by `.github/scripts/run-tests.sh`;
   there is no pytest lane. They must fail now, for the stated reason, before any
   source edit.

3. **Edit the canonical source** `scripts/sd-ai-command-pack-review.py`:

   - After the `failed`/`started` guard that returns
     `remote-reconciliation-required` (`:2196-2204`) and before
     `latest = _pr_evidence(...)`, compute:

     ```python
     qualifiers: tuple[str, ...] = (
         ("remote-evidence-not-dispatch-caused",)
         if dispatch.get("status") == "already-present"
         else ()
     )
     ```

   - Pass `limitations=qualifiers` to the `ready`, `findings`, and `blocked`
     reports (`:2218-2232`), and `limitations=(*qualifiers, "observation-pending")`
     to the fallthrough (`:2233-2238`).

   Nothing else in the file changes. Do not touch `_collect_observation`,
   `matching_reviews`, or the receipt validator at `:1230`.

4. **Mirror the twin.**
   `cp scripts/sd-ai-command-pack-review.py templates/scripts/sd-ai-command-pack-review.py`
   — byte-identical, per `CONTRIBUTING.md:97-98` and the Makefile note at `:58`.
   Not optional and not cosmetic: `tests/test_review_controller.py:21` sets
   `SCRIPT = PACK_ROOT / "templates/scripts/..."`, so the twin is the copy the
   suite actually exercises.

5. **Document the token.** In `docs/SD_AI_COMMAND_PACK.md` around `:944`, in the
   paragraph that already names `router-not-configured` and
   `zero-remote-confidence`, state that a routed copilot receipt whose
   `dispatch.status` is `already-present` reports
   `remote-evidence-not-dispatch-caused`: the findings are real and reported, the
   dispatch did not cause them. Mirror into `templates/docs/SD_AI_COMMAND_PACK.md`.

6. **Release bookkeeping.** Patch bump per `CONTRIBUTING.md:162-171`
   (compatible bug fix): `manifest.json` `version` plus a matching top
   `CHANGELOG.md` heading — CI's `Release payload gate` blocks a payload change
   whose version and top heading do not agree. The sibling receipt-cache-race
   fix shipped this way as PR #468 / v0.71.15.

   **The version is a claim on a shared counter, not a local edit.** This PR
   opened as `0.71.23` and had to be re-cut as `0.71.24` because PR #480 merged
   to `main` during review and took `0.71.23` first. A version chosen at branch
   time is only provisional. Before merging, re-read `origin/main`'s
   `manifest.json` and top `CHANGELOG.md` heading, and if the number has been
   taken: rebase, renumber both, regenerate, and sweep every consumer artifact
   that cites the version — here that is
   `.trellis/spec/backend/consumer-installer.md` and this task's `prd.md`, not
   only the file where the number was first typed.

7. **Regenerate, in this order.** `make generate` fails the first time by
   design; each failure names its own preparation command:
   - `make generate` → reports `mirror.stale`, `provenance.stale`, and
     `provenance.candidate-stale`;
   - `make sync` → self-installs the pack over itself, refreshing
     `.sd-ai-command-pack/manifest.json` (tracked, not ignored) and the mirrored
     `sd-help` command catalogs;
   - `.venv/bin/python scripts/sd-ai-command-pack-fleet-candidate-check.py` →
     rewrites `docs/fleet/candidate-validation.json` with the new `packVersion`
     and `payloadDigest`, validating each fleet consumer clone (~2 min, network);
   - `make generate` again → must report `shipped-surface closure: clean`.

   Never hand-edit `plugins/sd/bin/`, `plugins/sd/machine-payload/`, or the
   generated catalogs.

8. **Validate** — see the Validation Plan below.

9. **Pull request** into `platypeeps/sd-ai-command-pack`. This is a cross-repo
   PR: surface it explicitly for approval rather than treating it as covered by
   the local run's repo-local authority. Land it green, then tag/release.

### Stage B — consumer record (`platypeeps/sd-github-review`)

10. **Branch** from clean `main`: `task/bind-copilot-review-evidence`.

11. **Refresh the pack** to the released version carrying the fix. Confirm
    `.sd-ai-command-pack/provenance.json` moves off `0.71.22` and that
    `node scripts/install-consumer.mjs check --target .` reports no *new* drift.
    Pre-existing drift on `main` is not this task's to fix — record it, do not
    absorb it.

12. **Update `.trellis/spec/backend/consumer-installer.md`**, in the "Three
    channels can request Copilot, not two" section: record what a Copilot receipt
    does and does not prove about who requested the review, and that
    `remote-evidence-not-dispatch-caused` is the expected steady state in this
    repository for as long as the `main` ruleset's `copilot_code_review` rule is
    retained. This is acceptance criterion 5.

13. **Record verification evidence** in the task directory: the `sd-review`
    output showing the limitation alongside live Copilot findings.

14. **Ship** through `sd-ship until=merge`.

15. **Close the parent.** Re-check `08-16-remote-review-attribution`'s
    cross-child acceptance criteria; with the sibling hook task already archived
    (`a93fbbd`), this child closes the last one.

## Validation Plan

Upstream, from the pack repo root:

| # | Command | Expected |
|---|---------|----------|
| 1 | `.venv/bin/python -m unittest tests.test_review_controller -v` | all pass, including the three new tests |
| 2 | `make test` | full suite green; shipped-script coverage and docs gates pass |
| 3 | `make lint` | ruff + mypy clean over `scripts`, `templates/scripts`, `tests` |
| 4 | `make generate` | `shipped-surface closure: clean` |
| 5 | `make full-check` | passes, including "template twin pairs compared" |
| 6 | Write the tests before the source hunk and run them | `test_already_present_dispatch_qualifies_remote_confidence` **fails** with `AssertionError: Lists differ: [] != ['remote-evidence-not-dispatch-caused']`. The other two are regression guards and are green both before and after — that is what makes them guards. |

The controller tests load `templates/scripts/sd-ai-command-pack-review.py`
(`tests/test_review_controller.py:21`), not `scripts/`. Editing only the
canonical copy leaves the suite testing the old code and failing for the wrong
reason. Mirror the twin before rerunning.

Use `.venv/bin/python`, not system `python3` — the pack's `.venv` is where the
dev dependencies live (`Makefile:4`, `VENV_PYTHON = $(VENV)/bin/python`, Python
3.13.15). And use `unittest`, not `pytest`: `make test` runs
`PYTHON_BIN="$(VENV_PYTHON)" bash .github/scripts/run-tests.sh`, whose header
states it "Shards the unittest suite by module across workers". A `pytest`
invocation is not the gate CI runs.

Check 6 is the decisive one: it is what separates "the tests pass" from "the
tests test the fix".

Here, after release:

| # | Command | Expected |
|---|---------|----------|
| 7 | `node scripts/install-consumer.mjs check --target .` | no new drift beyond what `main` already carries |
| 8 | `sd-review scope=pr` on this branch's PR | `Limitations: remote-evidence-not-dispatch-caused`, with Copilot findings still listed and exit code unchanged from the equivalent run today |

## Documentation And Spec Updates

- Upstream: `docs/SD_AI_COMMAND_PACK.md` + `templates/docs/` mirror + `CHANGELOG.md`.
- Here: `.trellis/spec/backend/consumer-installer.md` (acceptance criterion 5).
- Here: this task's `prd.md` acceptance boxes, checked only against real output.

## Review Notes

Reviewer-sensitive points, worth calling out in the PR body:

- **This does not suppress findings.** Test 3 asserts payload equality across
  both dispatch statuses; only `limitations` differs.
- **`ready` with a non-empty `limitations` list is pre-existing**, not something
  this change introduces — `:2077-2081` returns exit `0` with
  `remote-intentionally-skipped`, and `:2090-2095` with `router-not-configured`.
  No gate needs to change to accommodate the new token.
- **A timestamp guard was considered and rejected.** The ruleset requests early
  but Copilot submits late, so `submitted_at >= dispatch.startedAt` admits the
  foreign review anyway. `dispatch.status` is the field that already knows.
- **Rejecting `already-present` evidence was considered and rejected.** It would
  zero out remote confidence in this repository permanently; the piggyback is
  deliberate.

## Rollback Points

- After stage A step 3: revert the source hunk; the tests fail loudly and
  nothing has shipped.
- After stage A step 9: the pack release is additive — a consumer that does not
  refresh keeps today's behaviour exactly, since `requested` is unchanged and
  the token is simply absent.
- After stage B step 11: the pack refresh is a self-contained commit; revert it
  to return to `0.71.22`.
- Stage B is revertible independently of stage A. Stage A is not revertible by
  stage B.

## Follow-Ups

Explicitly outside this PR:

- Removing the `already-present` condition at its source (retiring or narrowing
  the `main` ruleset's `copilot_code_review` rule). The parent task settled that
  the rule stays.
- Applying the same causal binding to the `pr-agent` route, if that route ever
  grows an equivalent already-present path.
- The pre-existing install-audit drift on this repository's `main`, recorded in
  `08-15-remote-review-channel-authority` and not this task's to absorb.
