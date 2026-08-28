# Evidence: stalled review lane on PR #156

Captured 2026-08-27T20:50:14Z from a live reproduction. All commands read-only.

## Receipt returned by the coordinator (attempt 2 request)
```json
{
  "attempt": 1,
  "headSha": "de440b6818cdf889fa828226b6bc4ca3a64e136e",
  "logicalDispatchId": "f8a606560dfd493c2bd3dc1416359233051dc7f05ada83d2befa93d6b35bcd6c",
  "requestFingerprint": "58f0419e90034c1fe2c507689a01c094eaa5a047c86b426524970f75b8a1d808",
  "selectedRoute": "copilot",
  "receiptId": "receipt-v1-f8a606560dfd493c2bd3dc1416359233051dc7f05ada83d2befa93d6b35bcd6c",
  "dispatch": {
    "completedAt": "2026-08-27T18:02:19.492Z",
    "idempotencyKey": "f8a606560dfd493c2bd3dc1416359233051dc7f05ada83d2befa93d6b35bcd6c",
    "phase": "observed",
    "startedAt": "2026-08-27T18:02:15.192Z",
    "status": "requested",
    "workflowUrl": "https://github.com/platypeeps/sd-github-review/actions/runs/33101443657"
  },
  "policyVersion": "sd-review-v1",
  "reason": "routine pull request within configured risk limits; review floor required copilot"
}
```

## GitHub's view of the same PR at the same moment
```json
{"comments":[],"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","reviewRequests":[],"reviews":[],"state":"OPEN"}
```

## Workflow runs on the branch (no run created after 18:02)
```
33101406895  2026-08-27T18:01:38Z  CI  completed/success
33101406916  2026-08-27T18:01:38Z  AI review router with PR-Agent  completed/success
33098808526  2026-08-27T17:31:06Z  CI  completed/success
33098808513  2026-08-27T17:31:06Z  AI review router with PR-Agent  completed/success
```

## Route step inputs (run 33101443657, job 'review', conclusion success)
```
rerequest-authorized: false
allow-bookkeeping-none: false
independent-review-floor: copilot
route-policy: copilot
mode: auto
confidence: unknown
request-copilot: true
copilot-reviewer: copilot-pull-request-reviewer[bot]
Durable route observed for PR #156 at de440b6818cdf889fa828226b6bc4ca3a64e136e
```

## Copilot works normally on neighbouring PRs
```
PR #148 reviewers: copilot-pull-request-reviewer
PR #149 reviewers: copilot-pull-request-reviewer
PR #150 reviewers: copilot-pull-request-reviewer,copilot-pull-request-reviewer
PR #151 reviewers: copilot-pull-request-reviewer
PR #152 reviewers: copilot-pull-request-reviewer
PR #153 reviewers: copilot-pull-request-reviewer
```
