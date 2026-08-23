# v0.5.0 pilot evidence

Host: `platypeeps/sd-github-review`, installed at v0.5.0, `check` healthy.
Action pinned at `61a4492056cec240b785bdea5ebad574f389bb54`.
Repository `REVIEW_ROUTE_MODE` is `copilot`.

## Scope, and what this pilot cannot cover

`adapter-request` is emitted only for `backend.kind === "external"`
(`src/operations.js:438`). The `copilot` path dispatches the reviewer inline and
stamps `completedAt`, so at this repository's route mode both the `pr-agent` and
`finalize` jobs are skipped by `if: needs.review.outputs.adapter-request != ''`.

Three RELEASE_CHECKLIST section 4 scenarios are therefore unreachable here
without a provider credential, which section 2 says requires separate approval:

- external `finalize` on an exact head
- matching replay emitting no second adapter request
- changed-head reconciliation, which needs a receipt still in dispatch phase
  `started`; the copilot path never leaves one in that phase

Those paths are covered by the unit suite (713 tests) but have not run live at
this tag. Recorded as a known gap, not as a pass.

## Scenarios

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 1 | `route`, live head | copilot route; Copilot in requested-reviewer state | |
| 2 | `query`, same exact head | receipt found, same logical identity | |
| 3 | `route` replay, same head | no second Copilot request | |
| 4 | `route`, new head | different logical identity | |
| 5 | explicit `deep` under `route-policy: copilot` | refused before routing and before any receipt write | |
| 6 | `independent-review-floor` | evidence cannot lower the automatic route below the floor | |
| 7 | tracked config scan | no provider credential value present | |

## Observations

### Operator friction

- `request.policyVersion` is required, but DESIGN.md's canonical example is the
  only place the full required set appears together. A caller that reads
  `normalizeReviewRequest` top-down and stops at the obvious fields produces a
  request that fails late, at dispatch, with
  `request.policyVersion must be a string`. Clear error, wasted round trip.
- `.trellis/**` is a configured bookkeeping path, so a pilot whose only change
  is its own evidence file is bookkeeping-only and will not route. The pilot
  branch therefore also carries an inert comment outside that set.
