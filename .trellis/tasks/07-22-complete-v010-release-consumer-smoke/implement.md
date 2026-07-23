# Implementation Plan: v0.1.0 Release And Consumer Smoke

## Gate 1: Freeze And Verify The Candidate

1. Record the proposed full candidate SHA and its exact successful GitHub
   Actions run.
2. From that checkout run:
   - `npm ci`
   - `npm test`
   - `npm run check`
   - `npm run validate:metadata`
   - `python3 scripts/sd-ai-command-pack-install-audit.py`
   - `git diff --check`
3. Validate the v1 setup descriptor, standalone pilot workflow, durable
   no-checkout workflow, and permissions boundary.
4. If any source behavior changes, select a new candidate and restart this
   gate.

## Gate 2: Authorized Private Pilot

1. Obtain explicit authority for mutations in
   `platypeeps/sd-github-review-pilot`.
2. Update the existing standalone workflow to the frozen candidate and add the
   provider-free durable scenario workflow without provider secrets or PR code
   checkout.
3. Exercise every standalone scenario in `docs/RELEASE_CHECKLIST.md` and record
   sanitized workflow URLs and outcomes.
4. Exercise durable route/query/synthetic-finalize, matching replay, new-head,
   changed-head, and ambiguity scenarios. Assert no duplicate adapter request.
5. Test disable/rollback behavior, then observe for 24 hours after the last
   scenario. Any source change or unresolved failure restarts the window.
6. Store only the public allowlisted evidence under this task's `research/`
   directory and update the checklist without exposing private payloads.

## Gate 3: Explicit Publication Decision

1. Present the exact candidate SHA, source CI, sanitized pilot matrix,
   observation timestamps, limitations, and rollback evidence.
2. Obtain explicit maintainer approval specifically to publish `v0.1.0`.
3. Reconfirm that neither the tag nor release exists, then create an annotated
   tag and GitHub release at the approved SHA. Stop on any identity mismatch.

## Gate 4: Consumer Smoke And Documentation

1. Pin the private pilot workflow to the released full SHA and complete one
   provider-free consumer smoke with recorded route output.
2. Exercise or concretely verify disable/rollback to the prior immutable pin.
3. Update runnable source examples and installation guidance in a post-release
   documentation commit. Keep non-runnable template placeholders explicit.
4. Run the full source validation set, complete review, and archive the task.

## Review Gates

- Private-pilot mutations require explicit authority before Gate 2.
- Publication requires a separate explicit approval after Gate 2 completes.
- Any upstream command-pack work requires its own separately scoped approval.
- Never force a tag, bypass checks, expose private payloads, or add provider
  credentials to the pilot.

## Rollback Points

- Before release: disable the pilot workflow and supersede the candidate with a
  reviewed commit.
- During release: stop on pre-existing or mismatched GitHub state; do not move
  or overwrite it.
- After release: disable consumers and publish a patch from a reviewed commit;
  preserve `v0.1.0` unchanged.
