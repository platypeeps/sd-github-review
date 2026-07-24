# v0.1.0 Provider-Free Pilot Evidence

## Current Candidate Pilot

- Source candidate:
  `8636a3983d18de17c49907a4c48170a61b1bb713`
- Source CI:
  `https://github.com/platypeeps/sd-github-review/actions/runs/30036609751`
- Exact-checkout validation completed at `2026-07-23T19:49:23Z`.
- Restart reason: PR `#15` added runtime PR-Agent support after the previous
  pilot, so the candidate-bound evidence and observation window must restart.
- Private pilot repository: `platypeeps/sd-github-review-pilot`
- Workflow pin PR: `https://github.com/platypeeps/sd-github-review-pilot/pull/4`
- Smoke PR: `https://github.com/platypeeps/sd-github-review-pilot/pull/3`
- Pilot heads:
  - routine: `c2542e32468046c0d401c0c1821fbc9ba507a4b6`
  - sensitive: `085b70f6604b953a26beab6bda879a850cf3dfd4`
  - successor: `bd53cf5c183a8972a19f3c57db025f549806f661`

Pilot PR `#4` merged at `2026-07-23T19:52:38Z` and pins both pilot
workflows to the full candidate SHA. The standalone workflow has only
`contents: read` and `pull-requests: write`; the durable workflow additionally
has `checks: write`. Neither checks out pull-request code or reads a provider
secret.

At the observation checkpoint the private repository had zero Actions
secrets, zero rulesets, no route label on PR `#3`, and all three workflows were
active. Public evidence below contains only immutable identifiers, workflow
URLs, bounded route state, and rollback state.

### Standalone Scenario Matrix

| Scenario | Head | Evidence | Sanitized result |
| --- | --- | --- | --- |
| Automatic cheap | `c2542e3...` | [run 30039872323](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30039872323) | `route=cheap`, `model=pilot-cheap`, external flag true |
| Label cheap | `c2542e3...` | [run 30039925445](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30039925445) | explicit cheap, external flag true |
| Label deep | `c2542e3...` | [run 30039950533](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30039950533) | explicit deep, `model=pilot-deep`, external flag true |
| Label none | `c2542e3...` | [run 30039985903](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30039985903) | explicit none, external flag false |
| Trusted command | `c2542e3...` | [run 30040016187](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040016187) | `/review deep` selected deep |
| Unrelated comment | `c2542e3...` | [run 30040050100](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040050100) | none; no reviewer side effect |
| Automatic Copilot | `085b70f...` | [router 30040166783](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040166783), [Copilot 30040182472](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040182472) | one sensitive file; new exact-head review recorded |
| Copilot deduplication | `085b70f...` | [run 30040412634](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040412634) | explicit Copilot; `copilot-requested=false` |
| New-head Copilot | `bd53cf5...` | [router 30040454008](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040454008), [Copilot 30040470868](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040470868) | successor head received one new exact-head review |

Both current-candidate Copilot reviews are bound to their exact head commits.
No raw review body or pull-request content is copied into this record.

### Durable Scenario Matrix

| Scenario | Request head | Evidence | Sanitized result |
| --- | --- | --- | --- |
| Route, replay, synthetic finalize, query | `c2542e3...` | [run 30040088747](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040088747), [check 89317632636](https://github.com/platypeeps/sd-github-review-pilot/runs/89317632636) | replay emitted no adapter request; receipt `receipt-v1-3ec4964...` observed |
| Route only for changed-head setup | `085b70f...` | [run 30040360073](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040360073), [check 89318547367](https://github.com/platypeeps/sd-github-review-pilot/runs/89318547367) | one started receipt and one adapter request; logical dispatch `7ff3e52f...` |
| Changed-head finalize | `085b70f...` after live head became `bd53cf5...` | [run 30040469229](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040469229) | reconciliation required; dispatch forbidden; stale receipt unchanged |
| Successor lifecycle | `bd53cf5...` | [run 30040512477](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30040512477), [check 89319024456](https://github.com/platypeeps/sd-github-review-pilot/runs/89319024456) | distinct receipt `receipt-v1-987d920...`; replay suppressed and receipt observed |

The synthetic acknowledgment proves protocol finalization and idempotency; it
does not invoke a provider or claim a real finding. Ambiguous transport
mutation remains covered by the candidate's exact-checkout unit suite, while
the live pilot exercised changed-head reconciliation.

### Rollback Evidence

Workflow `319050197` (`Durable routed-review pilot`) was changed from `active`
to `disabled_manually` and restored to `active`. No workflow history, candidate
pin, or credential changed.

### Observation Window

- Start: `2026-07-23T20:05:58Z`
- Earliest completion: `2026-07-24T20:05:58Z`
- Baseline: 15 candidate-bound runs completed successfully after the workflow
  pin merged: 9 standalone/router runs, 4 durable runs, and 2 GitHub-managed
  Copilot runs.
- Initial failures, false positives, API errors, unexplained duplicates, or
  credential leaks: none observed.
- Operator friction: the local sandbox blocked GitHub CLI's default run-log
  cache, so evidence collection used the direct job-log API. Pilot behavior
  was unaffected.

### Final Observation Checkpoint

- Checkpoint: `2026-07-24T22:42:36Z`, after the earliest completion time.
- Source `main` remained
  `8636a3983d18de17c49907a4c48170a61b1bb713`; source CI run
  `30036609751` remained completed successfully for that exact SHA.
- The candidate-bound run set remained the same 15 successful runs. No run
  started after the observation window began, and no candidate-bound run was
  pending or unsuccessful.
- Pilot PR `#3` remained open at
  `bd53cf5c183a8972a19f3c57db025f549806f661` with no route label. Its
  current-head route and receipt checks remained successful, and its exact-head
  Copilot review reported no new comments.
- Both pilot workflows remained pinned to the full candidate SHA, contained no
  checkout or secret reference, and all three repository workflows remained
  active. The repository still had zero Actions secrets and zero rulesets.
- The older-head receipt intentionally remained in `started` state after the
  changed-head finalization test failed closed. It did not authorize fallback
  dispatch and is retained as expected historical evidence.
- The one outdated Copilot fixture-location advisory was dispositioned as an
  intentional `src/auth/` release-checklist stimulus and resolved without a
  code or pilot-head change. No review thread remains unresolved.
- Result: the 24-hour observation gate passed with no unresolved release
  blocker, unexplained duplicate, permission error, candidate change, source
  behavior change, or credential-boundary violation. The window does not need
  to restart.

PR `#3` remained open and the candidate remained frozen through the window.
The final checkpoint re-queried workflow history, receipt checks, exact-head
Copilot review state, secrets/rulesets, source `main`, and rollback state. Any
later source behavior change before publication still invalidates this
candidate and requires a new pilot window.

## Superseded Candidate Baseline

The remaining evidence in this document is retained as a historical baseline
for candidate `32fc23d4a59aee4e84d25d44861e7e5e7b8d6483`. It was successful but
does not qualify candidate `8636a3983d18de17c49907a4c48170a61b1bb713`.

### Scope And Boundary

- Source candidate:
  `32fc23d4a59aee4e84d25d44861e7e5e7b8d6483`
- Private pilot repository: `platypeeps/sd-github-review-pilot`
- Workflow setup PR: `https://github.com/platypeeps/sd-github-review-pilot/pull/2`
- Current smoke PR: `https://github.com/platypeeps/sd-github-review-pilot/pull/3`
- Pilot heads:
  - routine: `8ab827631c83eb98f674a145de6fa9662fdb309a`
  - sensitive: `d0262c943612399ca715b26f6cb5c4518ad59adb`
  - successor: `ef758d82a872d0e0d3e2a7d8a5bf27494899d2fe`

The setup PR merged at `2026-07-23T16:35:17Z`. It pins both pilot
workflows to the candidate. The standalone workflow has only `contents: read`
and `pull-requests: write`; the durable workflow additionally has
`checks: write`. Neither workflow checks out pull-request code or reads a
provider secret.

At the observation checkpoint the repository had zero Actions secrets, zero
rulesets, and the durable workflow was active. Public evidence below contains
only route results, immutable identities, run/check URLs, and bounded state.

### Standalone Scenario Matrix

| Scenario | Head | Evidence | Sanitized result |
| --- | --- | --- | --- |
| Automatic cheap | `8ab8276...` | [run 30025804039](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30025804039) | `route=cheap`, `model=pilot-cheap`, external flag true |
| Label cheap | `8ab8276...` | [run 30025930252](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30025930252) | explicit cheap, external flag true |
| Label deep | `8ab8276...` | [run 30025958695](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30025958695) | explicit deep, `model=pilot-deep`, external flag true |
| Label none | `8ab8276...` | [run 30025986076](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30025986076) | explicit none, external flag false |
| Trusted command | `8ab8276...` | [run 30026013633](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026013633) | `/review deep` selected deep |
| Unrelated comment | `8ab8276...` | [run 30026034026](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026034026) | none; no reviewer side effect |
| Automatic Copilot | `d0262c9...` | [router 30026063123](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026063123), [Copilot 30026082412](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026082412) | one sensitive file, newly requested, review recorded on exact head |
| Copilot deduplication | `d0262c9...` | [run 30026296772](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026296772) | explicit Copilot, `copilot-requested=false` |
| New-head Copilot | `ef758d8...` | [router 30026343928](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026343928), [Copilot 30026363753](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026363753) | new exact head received one new review |
| New-head deduplication | `ef758d8...` | [run 30026571512](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026571512) | same-head retrigger did not request another review |

The two Copilot reviews are bound to different exact head commits. No raw
review body or pull-request content is copied into this evidence record.

### Durable Scenario Matrix

| Scenario | Request head | Evidence | Sanitized result |
| --- | --- | --- | --- |
| Route, replay, synthetic finalize, query | `8ab8276...` | [run 30025854215](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30025854215), [check 89270041123](https://github.com/platypeeps/sd-github-review-pilot/runs/89270041123) | replay emitted no adapter request; receipt observed |
| Route only for stale-finalize setup | `d0262c9...` | [run 30026246432](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026246432), [check 89271373729](https://github.com/platypeeps/sd-github-review-pilot/runs/89271373729) | one started receipt; one adapter request |
| Changed-head finalize | `d0262c9...` after live head became `ef758d8...` | [run 30026359717](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026359717) | reconciliation required; dispatch forbidden |
| New-head lifecycle | `ef758d8...` | [run 30026407645](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30026407645), [check 89271911377](https://github.com/platypeeps/sd-github-review-pilot/runs/89271911377) | replay emitted no adapter request; receipt observed |

Receipt identities changed with the head:

- `8ab8276...`: `95f0200ad4b786d02d37a309fb852347f82ec21d2b753961c2d831407de529b1`
- `d0262c9...`: `9eb23715f8da5ad9ac62469f3bb698d992c493e6fac961c6ca88f8e7810de08b`
- `ef758d8...`: `75796030f75f4fa238260b461be88856c955d703f4e10853b3438e4b77eb22d8`

The acknowledgment is deterministic pilot workflow data. It proves protocol
finalization and idempotency but does not invoke a provider or claim a real
finding. Ambiguous transport mutation remains covered by the source candidate's
unit suite; the live pilot exercised the changed-head reconciliation branch.

### Rollback Evidence

Workflow `319050197` (`Durable routed-review pilot`) was changed from `active`
to `disabled_manually` and then restored to `active`. The operation did not
delete workflow history, change the source candidate, or add credentials.

### Superseded Observation Window

- Start: `2026-07-23T16:47:46Z`
- Earliest completion: `2026-07-24T16:47:46Z`
- Baseline: 17 candidate-bound pilot runs since workflow setup; all completed
  successfully. The count includes 11 standalone/router runs, 4 durable runs,
  and 2 expected GitHub-managed Copilot runs.
- Initial failures, false positives, API errors, unexplained duplicates, or
  credential leaks: none observed.
- Operator friction: GitHub CLI `workflow view` on the installed version did
  not support `--json`; the rollback state was verified through the GitHub API
  instead. No pilot behavior was affected.

PR `#15` changed source behavior before this window completed. The window is
therefore closed as superseded evidence rather than carried forward. PR `#3`
remains the replacement-candidate scenario target.
