# Release and Pilot Checklist

This checklist gates the first public release. A green source repository is
necessary but not sufficient: `v0.1.0` remains blocked until the isolated pilot
passes and the maintainer explicitly approves publication.

## 1. Prepare the Candidate

- [ ] Work from a focused candidate branch based on current `main`.
- [ ] Run `npm ci`, `npm test`, `npm run check`, and
  `npm run validate:metadata`.
- [ ] Run `python3 scripts/sd-ai-command-pack-install-audit.py` and
  `git diff --check`.
- [ ] Confirm the GitHub Actions job named `test` is green for the exact
  candidate commit.
- [ ] Record the candidate's full 40-character commit SHA. Never pilot or
  document a floating branch, tag, or major-version reference.

## 2. Configure the Isolated Pilot

Use the private repository `platypeeps/sd-github-review-pilot`. It must not
contain production code, provider credentials, or an automatic Copilot review
ruleset. Copy `examples/pilot-router.yml` into the pilot repository's workflow
directory as `review-router.yml`, replace `<commit-sha>`, and create these
labels:

- `review:cheap`
- `review:deep`
- `review:copilot`
- `review:none`

The workflow deliberately does not check out pull-request code. Cheap/deep are
observed as outputs only; `run-external-reviewer=true` is evidence that a
consumer adapter would run, not permission to invoke one during this pilot.

## 3. Exercise the Routes

Use one open smoke pull request and preserve its Actions logs and review state.
Remove any prior `review:*` label before applying the next one.

| Scenario | Trigger | Required evidence |
| --- | --- | --- |
| Automatic cheap | Change only a routine fixture | `route=cheap`, `model=pilot-cheap`, `run-external-reviewer=true` |
| Automatic Copilot | Change a path under `src/auth/` | `route=copilot` and the Copilot reviewer is newly requested or already present |
| Trusted command | Comment `/review deep` as a repository member | `route=deep`, `model=pilot-deep`, no file enumeration failure |
| Label cheap/deep | Apply `review:cheap`, then `review:deep` | Matching route/model outputs and `run-external-reviewer=true` |
| Label none | Apply `review:none` | `route=none`, `run-external-reviewer=false` |
| Copilot deduplication | Retrigger the Copilot route | No duplicate reviewer request; `copilot-requested=false` when already requested |
| Unrelated event | Add a non-command comment or unrelated label | `route=none` and no reviewer side effect |

## 4. Pilot Exit Criteria

The pilot passes when every scenario has one completed workflow run, the live
Copilot route is visible in the pull request's requested-reviewer or review
state, no provider secrets exist in repository or workflow configuration, and
there are no unexplained duplicate triggers or unresolved failures during a
24-hour observation window. Record false positives, API errors, and operator
friction in the source task before deciding to release.

Any permission failure, incorrect route, missing output, unexpected paid
reviewer call, or duplicate Copilot request is a release blocker.

## 5. Publish Only After Approval

- [ ] Confirm the candidate SHA and pilot evidence still match.
- [ ] Obtain explicit maintainer approval to publish `v0.1.0`.
- [ ] Create annotated tag `v0.1.0` at the approved candidate SHA and publish a
  GitHub release with routing, permission, and consumer-adapter notes.
- [ ] Update consumer examples to the released full commit SHA. The tag is for
  discovery; the SHA is the immutable installation reference.

## Rollback

If the candidate fails before release, disable the pilot workflow and revert or
supersede the candidate branch; do not move a published tag. If a released
version fails, disable affected consumer workflows, publish a corrected patch
from a reviewed commit, and update consumers to that new full SHA. Never repair
a release by force-moving `v0.1.0`.
