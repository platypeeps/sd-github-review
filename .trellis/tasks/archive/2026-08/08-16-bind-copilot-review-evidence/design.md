# Bind copilot-route review evidence to the dispatch that caused it — Design

## Overview

The routed lane already knows whether it caused the Copilot review it is
reading. `requestCopilotReviewer` (`src/reviewer-dispatch.js:9-44`) checks the
requested-reviewer set and the head-commit reviews before requesting, and the
receipt records the answer as `dispatch.status` — `"requested"` when the Action
summoned the reviewer, `"already-present"` when something else already had
(`src/receipt.js:694`, via `alreadyPresent: !dispatch.requested` at
`src/operations.js:418-431`).

The coordinator validates that enum and then discards it. `scripts/sd-ai-command-pack-review.py:1230`
accepts `{requested, already-present, failed, skipped}`; `:1321` and `:2198`
branch on `failed` only. Reviews are then harvested by author and head commit
alone (`:1604-1616`), with no causal or temporal guard, while conversation
comments do carry `created_at >= dispatch.startedAt` (`:1589-1603`).

Consequence in this repository: the retained `main` ruleset's
`copilot_code_review` rule requests Copilot seconds after the pull request
opens, so every routed `copilot` review observes `already-present` and reports
full remote confidence for a review it did not cause.

## Proposal

Add one report-level qualifier, computed from the field that already holds the
answer, and attach it to every terminal report produced after remote
observation.

In `run()` in `scripts/sd-ai-command-pack-review.py`, immediately after the
existing `failed`/`started` reconciliation guard (`:2196-2204`) and before
`_pr_evidence` is re-read:

```python
qualifiers: tuple[str, ...] = (
    ("remote-evidence-not-dispatch-caused",)
    if dispatch.get("status") == "already-present"
    else ()
)
```

Then thread `qualifiers` into the four terminal reports that follow observation:

| Path | Today | After |
|------|-------|-------|
| `observation_status == "clean"` | `_report(status="ready")` | `limitations=qualifiers` |
| `observation_status == "findings"` | `_report(status="findings", diagnostic=...)` | `limitations=qualifiers` |
| `observation_status == "blocked"` | `_report(status="blocked", diagnostic=...)` | `limitations=qualifiers` |
| fallthrough | `limitations=("observation-pending",)` | `limitations=(*qualifiers, "observation-pending")` |

`_report` already accepts `limitations: Sequence[str]` and writes them to
`report["limitations"]` (`:1706`, `:1779`); `_print_human` already prints
`Limitations: ...` (`:1793-1794`). Nothing new is needed to make the state
legible without reading receipt JSON.

### Why this discriminator and not a timestamp

The symmetric change — guarding reviews by `submitted_at >= dispatch.startedAt`
the way comments are guarded — does not discriminate the case that matters. The
ruleset *requests* early but Copilot *submits* well after the dispatch starts, so
a timestamp guard admits the foreign review anyway. `dispatch.status` is the
field that already knows.

### Why qualify rather than reject

Rejecting `already-present` evidence would make the copilot route report zero
remote evidence in this repository permanently. The piggyback is deliberate: the
retained ruleset summons the reviewer while the Action's route stays the durable
record of what should review the change
(`.trellis/spec/backend/consumer-installer.md`, "Three channels can request
Copilot, not two"). The receipt must qualify its confidence, not discard the
finding.

### Where the computation lives

In `run()`, not inside `_collect_observation`. Two reasons: `dispatch` is already
in scope there, and the controller's routed-review test fixture patches
`_collect_observation` wholesale (`tests/test_review_controller.py:1983-1987`),
so a qualifier computed inside it would be unreachable from the regression tests
that must drive both statuses through the real two-write receipt shape.

## Boundaries And Non-Goals

- **No finding is dropped.** `matching_reviews`, `review_findings`,
  `conversation_findings`, and the exit codes are untouched. The failure mode
  being fixed is overclaimed confidence, not oversupplied evidence.
- **`requested` behaviour is byte-identical to today.** `qualifiers` is empty,
  so every existing report keeps its exact `limitations` list.
- **No direct-reviewer fallback is licensed.** Qualified confidence never
  becomes a reason to call GitHub's reviewer API outside the lane.
- **Receipt matching is not widened.** `external_id == logicalDispatchId` and
  the correlation-id check stay exactly as they are.
- **The ruleset is not removed.** That policy decision was made the other way by
  the parent task and this design does not reopen it.
- **The gate is not weakened.** A qualifier is advisory metadata on the report;
  it changes no exit code and no status.
- **Not in scope:** removing the `already-present` condition at its source,
  changing what the Action requests, or touching the `pr-agent` route.

## Affected Files

### Upstream — `platypeeps/sd-ai-command-pack` (where the fix lands)

| File | Change |
|------|--------|
| `scripts/sd-ai-command-pack-review.py` | Canonical: compute and thread `qualifiers` through the four terminal reports |
| `templates/scripts/sd-ai-command-pack-review.py` | Byte-identical twin — copy, enforced by `full-check` ("template twin pairs compared") |
| `plugins/sd/bin/sd-ai-command-pack-review.py` | Generated by `make generate` — do not hand-edit |
| `plugins/sd/machine-payload/scripts/sd-ai-command-pack-review.py` | Generated by `make generate` — do not hand-edit |
| `tests/test_review_controller.py` | Regression coverage for both dispatch statuses |
| `docs/SD_AI_COMMAND_PACK.md` (~:944) | Document the new limitation alongside `zero-remote-confidence` |
| `templates/docs/SD_AI_COMMAND_PACK.md` | Mirror |
| `plugins/sd/machine-payload/docs/SD_AI_COMMAND_PACK.md` | Generated mirror |
| `CHANGELOG.md`, version metadata | Release bookkeeping per pack convention |

### This repository — `platypeeps/sd-github-review`

| File | Change |
|------|--------|
| `.trellis/spec/backend/consumer-installer.md` | Record what a copilot receipt does and does not prove about who requested the review |
| `.trellis/tasks/08-16-bind-copilot-review-evidence/*` | Planning artifacts, verification evidence |

`scripts/` in this repository no longer carries the pack executables — since the
thin conversion they live in the machine install at `~/.agents/bin`, and
`pack.install-audit` fails any local edit — so no code change lands here.

## Data And Command Contracts

- **New limitation token:** `remote-evidence-not-dispatch-caused`. Kebab-case,
  consistent with `zero-remote-confidence`, `remote-intentionally-skipped`,
  `observation-pending`, `receipt-pending`.
- **Report shape:** unchanged. `limitations` is an existing `list[str]` on the
  schema-v1 `sd-review` report; this adds one possible member.
- **Exit codes:** unchanged. `0` ready, `1` findings/blocked, `3` pending.
- **Receipt shape:** unchanged. No new receipt field is written or required;
  the discriminator is read from the existing `dispatch.status` enum.
- **Idempotency:** the qualifier is a pure function of the stored receipt, so
  re-running an attempt against the same receipt produces the same report.
- **Backward compatibility:** a consumer on an older pack simply never sees the
  token; a consumer reading `limitations` as an opaque string list is unaffected.

## Risks And Edge Cases

| Risk | Handling |
|------|----------|
| A gate somewhere treats a non-empty `limitations` list as failure, or enumerates allowed tokens | **Checked, not assumed.** `ready` + non-empty `limitations` + exit `0` is pre-existing: `:2077-2081` (`remote-intentionally-skipped`) and `:2090-2095` (`router-not-configured`, `zero-remote-confidence`). No consumer enumerates the tokens — `sd-ai-command-pack-review-learnings.py:1796-1797, 2469-2472` treats the list as opaque strings (dedup, join), and `sd-ai-command-pack-review-local.py:2129` builds its own unrelated list. `templates/.agents/skills/sd-review/SKILL.md:134` already says "Do not call it fully reviewed if limitations say otherwise" — a generic rule that picks up the new token with no skill edit. |
| `dispatch.status: "skipped"` on `route: none` accidentally qualified | Guard is `== "already-present"` exactly; `skipped` and `requested` both yield `()`. |
| Twin drift between `scripts/` and `templates/scripts/` | `full-check` compares template twin pairs and fails on drift. |
| Hand-editing a generated `plugins/` copy | Run `make generate`; `sd-ai-command-pack-surface-check.py` catches divergence. |
| Shipped-script coverage gate | New lines are covered by the two new regression tests; `check-shipped-script-coverage.sh` runs in `make test`. |
| Reviewer reads this as suppressing evidence | The tests assert findings content is identical across both statuses — only `limitations` differs. |

## Validation

Upstream, in `platypeeps/sd-ai-command-pack`:

1. `.venv/bin/python -m unittest tests.test_review_controller -v` — targeted. The
   pack's suite is unittest, sharded by `.github/scripts/run-tests.sh`; there is
   no pytest lane.
2. `make test` — full suite plus shipped-script coverage and docs gates.
3. `make lint` — ruff + mypy over `scripts` and `templates/scripts`.
4. `make generate` — regenerate the `plugins/` copies; tree must be clean after.
5. `make full-check` — template twin parity ("template twin pairs compared").
6. Stash-the-fix check: with the source change reverted and the new tests kept,
   the two new tests must fail. A test that passes without the fix proves
   nothing.

Here, after the pack release:

7. Refresh this consumer to the released pack version.
8. Run a routed `sd-review scope=pr` on a real pull request in this repository
   and confirm the report prints
   `Limitations: remote-evidence-not-dispatch-caused` while still listing the
   Copilot findings — the ruleset guarantees `already-present` here, which makes
   this repository the natural proving ground.
