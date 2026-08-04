# Implement — Isolate PR-Agent receipt authority (A-004)

## Ordered steps

1. **Restructure the workflow** (`examples/pr-agent-on-demand-review-router.yml`)
   - Workflow-level `permissions:` → `contents: read` only.
   - Job `review`: permissions contents:read/issues:write/pull-requests:write/
     checks:write. Keep the route step. Add job `outputs:` mapping
     `adapter-request`, `backend-id`, `model`, `pull-request-number` from
     `steps.review.outputs.*`.
   - Job `pr-agent`: `needs: review`; `if: needs.review.outputs.adapter-request
     != ''`; permissions contents:read + pull-requests:write ONLY. Move the
     "Validate PR-Agent configuration" and "Run PR-Agent review" steps here.
     Rewrite their `steps.review.outputs.*` refs to `needs.review.outputs.*`.
     Keep `steps.pr-agent-config.outcome` (same job).
   - Job `finalize`: `needs: [review, pr-agent]`; `if:
     needs.review.outputs.adapter-request != '' && always()`; permissions
     contents:read/issues:write/pull-requests:write/checks:write. Move the
     acknowledge + finalize steps here. `adapter-request` from
     `needs.review.outputs.adapter-request`; `adapter-outcome` →
     `${{ needs.pr-agent.result }}`; keep `review-request: inputs.review-request`
     and `adapter-acknowledgment: steps.acknowledge.outputs.adapter-acknowledgment`.

2. **Update `test/metadata.test.js`** to the isolated shape
   - Replace `durable.workflow.permissions` deepEqual with: workflow perms
     `{contents:'read'}`; `durable.workflow.jobs.review.permissions` and
     `.finalize.permissions` include `checks:'write'`; assert
     `durable.workflow.jobs['pr-agent'].permissions` has NO `checks` and NO
     `issues` (regression lock for A-004).
   - `prAgent.env.CONFIG__MODEL` → `${{ needs.review.outputs.model }}`;
     `REVIEW_PULL_REQUEST_NUMBER` → `${{ needs.review.outputs.pull-request-number }}`;
     preflight `REVIEW_MODEL` → `${{ needs.review.outputs.model }}`.
   - Change `durable.workflow.jobs.review.steps` lookups for acknowledge/finalize/
     preflight/pr-agent to search across all jobs' steps (flatMap), or the
     specific job. Keep `durableRoute` in `jobs.review.steps`.
   - `acknowledge.with['adapter-outcome']` → `${{ needs.pr-agent.result }}`.
   - Confirm the flatMap-based assertions (credential leak, checkout absence,
     docker shape, preflight execution) still pass unchanged.

3. **Validate metadata** — `node scripts/validate-action-metadata.mjs` (or
   `npm run validate:metadata`). Confirm the descriptor's expected permissions
   for this template still reconcile (adjust descriptor if it pins the old
   workflow-level permissions).

4. **Run gates**
   - `npm test` → 0 failures.
   - `npm run check:full` → preflight + providers pass.

5. **Verify + ledger**
   - Confirm the pr-agent job has no checks:write and the reviewer token cannot
     write receipts (assertion in step 2 proves it structurally).
   - Set `.trellis/audit/ledger.md` A-004 → fixed with evidence. Only after
     step 4.
   - Tick prd.md acceptance boxes.

## Validation commands

- `npm test`
- `npm run validate:metadata`
- `grep -nE 'checks:|needs:|permissions:' examples/pr-agent-on-demand-review-router.yml`

## Review gates

- metadata.test asserts the reviewer job lacks checks:write (A-004 lock) before
  the ledger is touched.
- Whole suite green before ledger edit.

## Rollback points

- Revert `examples/pr-agent-on-demand-review-router.yml` and
  `test/metadata.test.js`; no Action source changed.
