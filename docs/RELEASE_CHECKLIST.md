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

Before opening the smoke pull request, confirm that no *other* event-driven
lane is still enabled on the default branch. The pilot repository may already
carry an installer-managed router that binds `PR_AGENT_MODEL_API_KEY` and fires
on `pull_request`; it will bill the provider on the smoke pull request even
though nothing in the pilot workflow reaches one. Disabling it is a rename to
`.disabled`, which is reversible and which Actions ignores. Verify afterwards
that the credentialed workflow has no run newer than the pilot's first run —
that is the check that the pilot was actually provider-free, and it is the one
worth quoting in the pilot record.

## 3. Exercise the Routes

Use one open smoke pull request and preserve its Actions logs and review state.
Remove any prior `review:*` label before applying the next one.

| Scenario | Trigger | Required evidence |
| --- | --- | --- |
| Automatic cheap | Change only a routine fixture | `route=cheap`, `model=pilot-cheap`, `run-external-reviewer=true` |
| Automatic high-risk | Change a path under `src/auth/` | `route=deep`, `model=pilot-deep`, `reason` names the sensitive file |
| Trusted command | Comment `/review deep` as a repository member | `route=deep`, `model=pilot-deep`, no file enumeration failure |
| Label cheap/deep | Apply `review:cheap`, then `review:deep` | Matching route/model outputs and `run-external-reviewer=true` |
| Label none | Apply `review:none` | `route=none`, `run-external-reviewer=false` |
| Copilot deduplication | Retrigger the Copilot route | No duplicate reviewer request; `copilot-requested=false` when already requested |
| Unrelated event | Add a non-command comment or unrelated label | `route=none` and no reviewer side effect |

The high-risk row expects `deep`, not `copilot`: since `0.4.0`, `high-risk-route`
defaults to `deep`, and `examples/pilot-router.yml` does not override it. Leave
that default alone during the pilot — routing a sensitive path to `deep` is the
shipped behavior under test. The Copilot request and deduplication paths are
covered by the `review:copilot` row below, which is where they belong.

The Copilot deduplication row is head-scoped, and that distinction decides
whether a rerun is a duplicate. `requestCopilotReviewer` treats Copilot as
already present only when it is a requested reviewer, or when it has a
non-`DISMISSED` review whose `commit_id` equals the *current* head. Re-requesting
after the head moves is therefore correct, not a duplicate. Let the current
head's Copilot review land before retriggering: probing while it is still in
flight reports `copilot-requested=true` and looks like a dedup failure when
nothing is wrong.

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

Three preconditions on that durable pass, each of which otherwise produces a
failure that looks like a product defect but is a setup error:

- `route` binds to the *live* pull request head. Dispatching it with a
  superseded `headSha` fails with `live pull request head must match
  review-request.headSha`. Only `finalize` accepts a superseded head, which is
  what makes changed-head reconciliation expressible at all.
- Changed-head reconciliation needs a receipt still in dispatch phase
  `started` — routed but never finalized. `reconciliationRequired` is derived
  from that phase *and its age*, so finalizing an already-`observed` receipt
  correctly returns `false` and is idempotent, not a reconciliation case. A
  `started` receipt younger than `stranded-receipt-minutes` reports `in-flight`
  and `reconciliationRequired: false`; exercising this case in a pilot means
  either waiting out the window or lowering the input for the run.
- A mismatched `acknowledgment.logicalDispatchId` throws rather than reporting
  reconciliation. That *is* the no-fallback behavior; `reconciliation-required`
  is reserved for concurrent duplicate receipts. Derive the prior identity from
  the repository, pull request number, and head rather than inventing a digest.

Leave `rerequest-authorized` disabled for initial requests and replay. Exercise
one attempt greater than one only with the prior receipt/logical identity,
unchanged policy/route/backend, a rerequest-capable backend, and explicit pilot
authority. Exercise `independent-review-floor` separately and confirm local or
bookkeeping evidence cannot lower the automatic route beneath the selected
floor.

## 5. Publish Only After Approval

- [ ] Confirm the candidate SHA and pilot evidence still match.
- [ ] Obtain explicit maintainer approval to publish the proposed version.
- [ ] Advance every first-party pin to the approved candidate SHA, in one commit
  so mutual consistency is never observed split, and merge it. That commit must
  touch neither `src/` nor `action.yml`.
- [ ] Create the annotated version tag **on the pin-advance commit**, not on the
  candidate, and publish a GitHub release with routing, permission, and
  consumer-adapter notes. The tag is for discovery; the SHA is the immutable
  installation reference.
- [ ] Run `node scripts/validate-action-metadata.mjs` against a checkout of the
  new tag. It must exit 0.

Pins are advanced **before** the tag, and the tag sits on the pin advance. The
reverse order — tag the candidate, then advance pins onto it — is what shipped
`v0.3.0` and `v0.4.0` with tagged trees pinning the *previous* release, so every
consumer installing from a tag ran a release behind. The order cannot be fixed by
pinning the tagged commit itself: a commit cannot contain its own SHA. It works
because `assertPinFreshness` compares the action code at the pin against the
action code at the release, and a pin-advance commit that leaves `src/` and
`action.yml` alone pins a parent whose action code is byte-identical. Touching
either of those in the pin advance breaks that and the tag will fail its own
gate.

## Rollback

If the candidate fails before release, disable the pilot workflow and revert or
supersede the candidate branch; do not move a published tag. If a released
version fails, disable affected consumer workflows, publish a corrected patch
from a reviewed commit, and update consumers to that new full SHA. Never repair
a release by force-moving its published tag.
