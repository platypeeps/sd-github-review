# v0.5.0 pilot evidence

Host: `platypeeps/sd-github-review`, installed at v0.5.0, `check` healthy.
Action pinned at `61a4492056cec240b785bdea5ebad574f389bb54`.
Repository `REVIEW_ROUTE_MODE` is `copilot`. Pilot pull request #127.

Heads exercised:

| label | sha |
| --- | --- |
| H1 | `c987e9c480eec3c172c4c7740e3f1dbaf8a5cd35` |
| H2 | `c207bf037bf6af0b600d74eaf73479ff83a77d57` |
| H3 | `af16083f20c911112c883e41404588bbce991e4b` |

## Scope, and what this pilot could not cover

`adapter-request` is emitted only for `backend.kind === "external"`
(`src/operations.js:438`). The `copilot` path dispatches the reviewer inline and
stamps `dispatch.completedAt`, so at this repository's route mode both the
`pr-agent` and `finalize` jobs are skipped by
`if: needs.review.outputs.adapter-request != ''`. Observed on every routed head:
`pr-agent | skipped`, `finalize | skipped`.

Three RELEASE_CHECKLIST section 4 scenarios are therefore unreachable here
without routing to an external backend, which needs the provider credential
that section 2 puts behind separate approval:

- external `finalize` on an exact head
- matching replay emitting no second **adapter** request (the Copilot-side
  no-duplicate property *was* verified; see scenario 3)
- changed-head reconciliation, which needs a receipt still in dispatch phase
  `started`. The copilot path never leaves one there, so the in-flight versus
  stranded split could not be exercised live either.

These are covered by the 713-test suite but have **not** run live at this tag.
Recorded as a known gap, not as a pass.

The 24-hour observation window section 4 requires has **not** elapsed.

## Scenarios

| # | Scenario | Expected | Result | Run |
| --- | --- | --- | --- | --- |
| 1 | `route`, live head H1 | copilot route; Copilot in reviewer or review state | **pass** | 32610929039 |
| 2 | `query`, exact head H1 | receipt found | **pass** | 32611201027 |
| 3 | `route` replay, head H1 | no second Copilot request | **pass** | 32611209289 |
| 4 | `route`, new head H2 | different logical identity | **pass** | 32611236685 |
| 5 | explicit `deep` under `route-policy: copilot` | refused before routing and before any receipt write | **pass** | 32610973276 |
| 6 | lowering local evidence under floor `copilot`, head H3 | evidence cannot lower the automatic route | **pass** | 32611267008 |
| 7 | tracked config scan | no provider credential value | **pass** | n/a |

### 1 — route

Receipt at H1: `selectedRoute: "copilot"`, `backend.id: "github-copilot"`,
`dispatch.status: "requested"`, `dispatch.phase: "observed"`,
`logicalDispatchId: 7ac206eb1c3f…`, reason `routine pull request within
configured risk limits; review floor required copilot`.

`requested_reviewers` was **empty**, which reads as a failure and is not one:
the timeline shows `review_requested Copilot` and
`copilot-pull-request-reviewer[bot]` had already left a `COMMENTED` review. A
fulfilled request leaves the pending list.

### 3 — replay idempotence

After replaying the identical request at H1: exactly one `review_requested`
timeline event, exactly one Copilot review, and the receipt retained its
original `dispatch.startedAt` of `2026-08-23T01:40:31.554Z` rather than
re-stamping. `correlationIds` stayed `["pilot-v0-5-0-s1"]`.

### 4 — logical identity

H1 `logicalDispatchId` `7ac206eb1c3f…` versus H2 `5accb9d4940f…`. Distinct.

### 5 — route policy

```
Error: route "deep" is not permitted by this repository's review policy.
  REVIEW_ROUTE_MODE = copilot
  permitted: auto, copilot
Dispatch --remote auto to take this repository's configured route, or --remote copilot, or change REVIEW_ROUTE_MODE.
```

The receipt at H1 was unchanged afterwards — same `logicalDispatchId`, same
`correlationIds`, still attempt 1 — confirming the refusal preceded any receipt
write.

### 6 — review floor

Dispatched with a `localReview` of `outcome: clean`, `confidence: 90` against a
`local-confidence-threshold` of 80 and a `local-evidence-route` of `cheap`,
under floor `copilot`. Route stayed `copilot`, and the reason names the
evidence rather than ignoring it:

> routine pull request within configured risk limits; **eligible** exact-head
> local evidence did not lower the automatic route; review floor required
> copilot

The counterfactual — floor `none` with the same evidence, which should route
`cheap` — was deliberately **not** run. This repository holds a live
`PR_AGENT_MODEL_API_KEY` (set 2026-08-15), so that dispatch would have reached
the PR-Agent adapter and made a billed provider call. Unit-covered only.

### 7 — credentials

`PR_AGENT_MODEL_API_KEY` exists as a repository secret. No credential *value*
appears in tracked repository or workflow configuration; tracked references are
all `secrets.` bindings, the installer's `SECRET_NAME` constant, and tests. A
scan for `sk-or-v1-`, `sk-proj-`, and `sk-ant-` shapes returned nothing. An
earlier looser scan produced false positives on `risk-to-external-reviewer`,
which contains the literal substring `sk-`.

## Operator friction

- `request.policyVersion` is required, but DESIGN.md's canonical example is the
  only place the full required set appears together. Reading
  `normalizeReviewRequest` top-down and stopping at the obvious fields yields a
  request that fails at dispatch with `request.policyVersion must be a string`.
  Correct and specific error, wasted round trip.
- `.trellis/**` is a configured bookkeeping path, so a pilot pull request whose
  only change is its own evidence file is bookkeeping-only and will not route.
- Verifying the Copilot route via `requested_reviewers` alone yields a false
  negative once Copilot has responded. Check the review state or the timeline.
