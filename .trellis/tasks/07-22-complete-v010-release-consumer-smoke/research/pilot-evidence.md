# v0.1.0 Provider-Free Pilot Evidence

## Scope And Boundary

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

## Standalone Scenario Matrix

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

## Durable Scenario Matrix

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

## Rollback Evidence

Workflow `319050197` (`Durable routed-review pilot`) was changed from `active`
to `disabled_manually` and then restored to `active`. The operation did not
delete workflow history, change the source candidate, or add credentials.

## Observation Window

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

Keep PR `#3` open and the candidate frozen through the window. At or after the
earliest completion time, re-query workflow history, receipt checks, exact-head
Copilot review state, secrets/rulesets, and rollback state. Any unexplained
failure, duplicate trigger, permission error, candidate change, or source
behavior change blocks release and restarts the window.
