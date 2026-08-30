# Design — Isolate PR-Agent receipt authority (A-004)

## Problem

`examples/pr-agent-on-demand-review-router.yml` runs everything in one `review`
job whose job/workflow permissions include `checks: write` (line 32). The
third-party `pragent/pr-agent` container receives `GITHUB__USER_TOKEN:
${{ github.token }}` (line 95) — a token that, in this job, carries `checks:
write`. A compromised reviewer can therefore forge durable check-run receipts
that dispatch deduplication trusts.

The installer-shipped `pr-agent-router.yml` is NOT affected: it grants no
`checks: write`, so its token cannot write receipts. A-004 is specific to the
on-demand durable template.

## Approach — split into three jobs by trust boundary

Receipt-writing and third-party execution move into separate jobs with separate
`github.token` permission scopes. GITHUB_TOKEN permissions are per-job, so the
reviewer job's token simply never has `checks: write`.

### Jobs

1. `review` (receipt authority)
   - permissions: `contents: read`, `issues: write`, `pull-requests: write`,
     `checks: write`.
   - Runs the existing "Route or query the exact-head review" Action step.
   - Declares job `outputs` so downstream jobs can read them:
     `adapter-request`, `backend-id`, `model`, `pull-request-number`.

2. `pr-agent` (reviewer, least privilege)
   - `needs: review`; `if: needs.review.outputs.adapter-request != ''`.
   - permissions: `contents: read`, `pull-requests: write` ONLY — **no
     `checks: write`, no `issues: write`**.
   - Runs "Validate PR-Agent configuration" + "Run PR-Agent review" (the docker
     step). `GITHUB__USER_TOKEN: ${{ github.token }}` here is a token with no
     receipt authority.
   - Cross-job refs change `steps.review.outputs.*` → `needs.review.outputs.*`.

3. `finalize` (receipt authority)
   - `needs: [review, pr-agent]`;
     `if: needs.review.outputs.adapter-request != '' && always()`.
   - permissions: `contents: read`, `issues: write`, `pull-requests: write`,
     `checks: write`.
   - Runs "Build the PR-Agent acknowledgment" + "Finalize the external receipt".
   - `adapter-outcome` changes from `steps.pr-agent.outcome` to
     `needs.pr-agent.result` (both yield success/failure/cancelled/skipped, the
     values `buildAdapterAcknowledgment` already accepts).
   - `adapter-request` comes from `needs.review.outputs.adapter-request`;
     `review-request` stays `inputs.review-request`.

### Workflow-level permissions

Set to `contents: read` only; every job overrides with its own scope. Nothing
inherits `checks: write`.

## Data flow

inputs → review job (route → outputs) → pr-agent job (validate + docker, PR-only
token) → finalize job (acknowledge + finalize, receipt token).

Receipts live in GitHub check-runs, not job-local state, so the finalize job
re-reads the receipt created by the review job by head/logicalDispatchId — the
split does not break receipt continuity.

## Test impact (`test/metadata.test.js`)

The current assertions encode the single-job shape and must move to the isolated
shape:
- `durable.workflow.permissions` deepEqual (was workflow-level `checks: write`)
  → assert workflow-level is `{contents: read}` and assert per-job permissions:
  `review` and `finalize` have `checks: write`; `pr-agent` does **not** and has
  no `issues: write`. This new assertion is the regression lock for A-004.
- `prAgent.env.CONFIG__MODEL` / `REVIEW_PULL_REQUEST_NUMBER` and the preflight
  `REVIEW_MODEL` → `needs.review.outputs.*`.
- Step lookups that assumed `jobs.review.steps` (acknowledge, finalize,
  preflight, pr-agent) → find across `Object.values(jobs).flatMap(steps)`.
- `acknowledge.with["adapter-outcome"]` → `${{ needs.pr-agent.result }}`.
- Steps that flatMap across all jobs (credential leak checks, checkout absence,
  docker shape) already survive the split unchanged.

## Failure modes / edge cases

- `always()` on finalize preserves receipt finalization even when the reviewer
  fails/cancels — same as today, now expressed via `needs.pr-agent.result`.
- If `pr-agent` is skipped (adapter-request empty), finalize's `if` also guards
  on the same emptiness, so no acknowledge runs without a dispatch.
- Fork PRs / token scope: reviewer job cannot escalate to checks even if the
  container is hostile — the token lacks the permission at the GitHub level.

## Compatibility / rollback

- Behavior-equivalent for the happy path; only the trust boundary tightens.
- No Action code change; `buildAdapterAcknowledgment` already accepts
  `needs.*.result` values.
- Rollback: revert the single yml + the metadata.test assertions.

## Scope

- Only `examples/pr-agent-on-demand-review-router.yml` (audit evidence).
- `pr-agent-router.yml` unchanged (no checks:write to leak). Noted, not modified.
- No durable-receipt schema change.
