# Complete v0.1.0 release and consumer smoke

## Goal

Publish the first immutable semantic release only after the current runtime has
passed a provider-free private pilot, a 24-hour observation window, and a
separate maintainer publication decision. Prove the released commit can be
installed, exercised, and rolled back by a bounded consumer without weakening
the existing release checklist.

## Confirmed Facts

- At candidate selection on 2026-07-23, source `main` was
  `8636a3983d18de17c49907a4c48170a61b1bb713`. GitHub Actions run
  `30036609751` completed successfully for that exact SHA.
- At candidate selection, the source repository had no tag or GitHub release.
  After the completed observation gate and explicit publication approval,
  `v0.1.0` was published at that candidate on 2026-07-24.
- A complete provider-free pilot passed against
  `32fc23d4a59aee4e84d25d44861e7e5e7b8d6483`, but PR-Agent support merged
  afterward in PR `#15`. That source behavior change superseded the candidate
  and invalidated its observation window for release qualification.
- `platypeeps/sd-github-review-pilot` is private, has no Actions secrets or
  repository rulesets, and retains current smoke PR `#3`. Pilot PR `#4` pinned
  both workflows to the replacement candidate; all workflows are active.
- At candidate selection, the runnable examples intentionally contained
  commit-SHA placeholders because a source commit cannot contain its own full
  SHA. The post-release documentation commit now pins those examples to the
  released full SHA; only template-owned consumer adapter placeholders remain
  parameterized.
- On 2026-07-23 the maintainer explicitly authorized updating and exercising
  `platypeeps/sd-github-review-pilot` against the frozen candidate. On
  2026-07-24 the maintainer separately approved publishing `v0.1.0`. Neither
  authorization includes making an upstream command-pack change.

## Requirements

- Freeze one full candidate SHA and record its exact successful source CI run
  before making any pilot mutation.
- Obtain explicit authority for the bounded private-pilot writes. Pilot only in
  `platypeeps/sd-github-review-pilot`; do not use a production repository.
- Re-run the standalone automatic, command, label, Copilot, deduplication,
  `none`, and unrelated-event scenarios against the frozen candidate.
- Exercise provider-free durable `route`, `query`, and synthetic external
  `finalize` behavior on one exact head. Prove replay does not authorize a
  duplicate adapter request, a new head receives a new identity, and ambiguous
  or changed-head finalization fails closed.
- Observe the pilot for 24 hours after its final scenario. Record sanitized run
  URLs, route/receipt identities, failures, false positives, API errors,
  operator friction, and rollback state; never publish raw findings or private
  payloads.
- After the observation gate passes, require a new explicit maintainer approval
  before creating `v0.1.0`. Task selection, planning approval, and private-pilot
  authority are not publication approval.
- Create an annotated `v0.1.0` tag and GitHub release at the approved candidate
  without moving or replacing any existing tag.
- Use the private pilot repository as the bounded provider-free consumer smoke.
  Pin its runnable workflow to the released full SHA and record upgrade and
  disable/rollback evidence.
- Pin runnable consumer examples to the released full SHA in a post-release
  documentation commit. Keep template-only examples visibly parameterized when
  a literal source SHA would make the release commit self-referential.

## Acceptance Criteria

- [x] The candidate SHA and exact successful source CI run are recorded before
  pilot execution.
- [x] Every standalone and durable provider-free scenario has bounded,
  sanitized evidence against the candidate; replay, new-head, and fail-closed
  behavior match `docs/RELEASE_CHECKLIST.md`.
- [x] The final pilot scenario is followed by a completed 24-hour observation
  window with no unresolved release blocker.
- [x] The specific publication approval is recorded after pilot evidence is
  complete.
- [x] `v0.1.0` and its GitHub release point to the approved immutable commit.
- [x] The provider-free consumer smoke completes while pinned to the released
  full SHA, with documented route output and disable/rollback evidence.
- [x] Runnable installation guidance uses the released full SHA; retained
  placeholders are clearly template-only.
- [x] No provider secret, raw private payload, or PR-controlled checkout crosses
  the pilot or public evidence boundary.

## Out of Scope

- Publishing without a separate post-pilot explicit approval.
- Live external-reviewer validation, which belongs to the adapter task.
- Command-pack handoff or any unrelated upstream repository mutation.
