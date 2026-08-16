# Release and Pilot Checklist

This checklist gates a public release. A green source repository is necessary
but not sufficient: publication remains blocked until the isolated pilot passes
and the maintainer explicitly approves the proposed release.

## 1. Prepare the Candidate

- [ ] Freeze the candidate from current `main`.
- [ ] Run `npm ci`, `npm test`, `npm run check`, and
  `npm run validate:metadata`.
- [ ] Run `python3 ~/.agents/bin/sd-ai-command-pack-install-audit.py` and
  `git diff --check`.
- [ ] Validate the v1 setup descriptor and no-checkout on-demand workflow;
  confirm only the durable example grants `checks: write`.
- [ ] Confirm the GitHub Actions job named `test` is green for the exact
  candidate commit.
- [ ] Record the candidate's full 40-character commit SHA. Never pilot or
  document a floating branch, tag, or major-version reference.

## 2. Configure the Isolated Pilot

Use the private repository `platypeeps/sd-github-review-pilot`. It must not
contain production code or credential values in tracked files or workflow
configuration. A live external-adapter pilot may use a capped credential stored
only as an Actions secret. Copy `examples/pilot-router.yml` for a provider-free
route pilot or the reviewed on-demand workflow for an adapter pilot. Never
enable overlapping event-driven routers for the same trigger family. For a
future candidate pilot, replace the released SHA only with the exact green
candidate SHA. Create these labels:

- `review:cheap`
- `review:deep`
- `review:copilot`
- `review:none`

The workflows deliberately do not check out pull-request code. In the
provider-free pilot, cheap/deep are observed as outputs only;
`run-external-reviewer=true` is evidence that a consumer adapter would run, not
permission to invoke one. A credentialed adapter pilot requires separate
approval and must keep the credential on its adapter step only.

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
state, no provider credential value exists in tracked repository or workflow
configuration, and
there are no unexplained duplicate triggers or unresolved failures during a
24-hour observation window. Record false positives, API errors, and operator
friction in the source task before deciding to release.

Any permission failure, incorrect route, missing output, unexpected paid
reviewer call, or duplicate Copilot request is a release blocker.

For the durable candidate, also exercise `route`, `query`, and external
`finalize` on one exact head. Confirm matching replay emits no second adapter
request, a new head creates a different logical identity, and changed-head or
ambiguous finalization requires reconciliation without fallback.

Leave `rerequest-authorized` disabled for initial requests and replay. Exercise
one attempt greater than one only with the prior receipt/logical identity,
unchanged policy/route/backend, a rerequest-capable backend, and explicit pilot
authority. Exercise `independent-review-floor` separately and confirm local or
bookkeeping evidence cannot lower the automatic route beneath the selected
floor.

## 5. Publish Only After Approval

- [ ] Confirm the candidate SHA and pilot evidence still match.
- [ ] Obtain explicit maintainer approval to publish the proposed version.
- [ ] Create an annotated version tag at the approved candidate SHA and publish
  a GitHub release with routing, permission, and consumer-adapter notes.
- [ ] Update consumer examples to the released full commit SHA. The tag is for
  discovery; the SHA is the immutable installation reference.

## Rollback

If the candidate fails before release, disable the pilot workflow and revert or
supersede the candidate branch; do not move a published tag. If a released
version fails, disable affected consumer workflows, publish a corrected patch
from a reviewed commit, and update consumers to that new full SHA. Never repair
a release by force-moving its published tag.
