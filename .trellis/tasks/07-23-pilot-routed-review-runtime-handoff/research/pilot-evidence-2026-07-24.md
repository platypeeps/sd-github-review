# Routed-Review Runtime Pilot Evidence

Recorded 2026-07-24 from bounded source and private-pilot queries. This record
contains no request payload, review body, source content, file name, prompt,
provider transcript, secret value, or provider configuration value.

## Immutable Scope And Authority

- Runtime Action: `8636a3983d18de17c49907a4c48170a61b1bb713`
- Runtime source CI: [run 30036609751](https://github.com/platypeeps/sd-github-review/actions/runs/30036609751), successful for that exact Action commit
- Source baseline: `195faec46fa62341a43e0867c04d2ef188536cc4`
- Setup contract: `sd-github-review/setup@1`
- Private setup PR: [#6](https://github.com/platypeeps/sd-github-review-pilot/pull/6), merged as
  `da9327d0b80932638dc2dffcc57ed5bb30deebc9`
- Private smoke PR: [#7](https://github.com/platypeeps/sd-github-review-pilot/pull/7)
- Private-pilot writes were approved for this task. No command-pack PR is
  authorized.

The setup PR installed the reviewed no-checkout durable workflow. Its exact
head check passed and it had no review threads. The event-driven router was
temporarily disabled before smoke PR creation and restored to `active` after
the bounded matrix so no overlapping trigger could double-dispatch.

## Credentialed External Lifecycle

| Scenario | PR/head | Route/backend | Receipt | Evidence | Sanitized result |
| --- | --- | --- | --- | --- | --- |
| External attempt 1 | #7 / `b9a6f3d6c2fb04b0c668583a61b927981124843a` | cheap / `pr-agent` | `receipt-v1-7119889c8e0115149718eac05f9edc9868bcadc37882e62009067cddb9e04d9e` | [run 30142938703](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30142938703), [check 89639490862](https://github.com/platypeeps/sd-github-review-pilot/runs/89639490862) | selected, dispatched, acknowledged, observed; one conversation-comment finding |
| Exact replay | #7 / `b9a6f3d6c2fb04b0c668583a61b927981124843a` | cheap / `pr-agent` | same attempt-1 receipt | [run 30142978456](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30142978456) | adapter, acknowledgment, and finalization steps skipped; receipt/finding counts unchanged |
| Correlation-alias replay | #7 / `b9a6f3d6c2fb04b0c668583a61b927981124843a` | cheap / `pr-agent` | same attempt-1 receipt | [run 30143002642](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30143002642) | alias added to the existing receipt; all adapter steps skipped; counts unchanged |
| Conflicting retry | #7 / `b9a6f3d6c2fb04b0c668583a61b927981124843a` | cheap / `pr-agent` | same attempt-1 identity | [run 30143028927](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30143028927) | expected fail-closed fingerprint rejection; all adapter steps skipped; counts unchanged |
| Authorized rerequest | #7 / `b9a6f3d6c2fb04b0c668583a61b927981124843a` | cheap / `pr-agent` | `receipt-v1-c3561b3d2119c53f86105101a75ad8d15840c19fb5707eef1071e058d361a3d7` | [run 30143055737](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30143055737), [check 89639812091](https://github.com/platypeeps/sd-github-review-pilot/runs/89639812091) | attempt 2 used a distinct identity, completed once, and produced the second authorized conversation-comment finding |
| Successor head | #7 / `1d9d6c440b51c7b9eb08c57b63861024523fd5a3` | none / no backend | `receipt-v1-37ef9099edab252279fc28bab731d0bd1279cfa6b8f1113542cb907fc72382ff` | [run 30143127719](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30143127719), [check 89640003885](https://github.com/platypeeps/sd-github-review-pilot/runs/89640003885) | new head received a distinct skipped receipt; the two old-head receipts remained historical and no third finding appeared |

Attempt 1 and attempt 2 produced exactly two receipt checks and two bot
findings on the reviewed head. Replays and the rejected conflict left both
counts unchanged. The successor head produced one different receipt and no
provider call.

## Copilot Lifecycle

PR [#1](https://github.com/platypeeps/sd-github-review-pilot/pull/1) already had
one Copilot review bound to current head
`1b59aad0090bbd67dbe92bfa4a0e430eb47aa62a` and three reviews bound to prior
heads. [Run 30143163337](https://github.com/platypeeps/sd-github-review-pilot/actions/runs/30143163337)
selected `copilot` and wrote observed receipt
`receipt-v1-3e84c9cb58b1488281c6bdd2017971293e78a11d46145dbaa983fc6c3f3e0391`
([check 89640099878](https://github.com/platypeeps/sd-github-review-pilot/runs/89640099878)).
The receipt recorded `github-copilot` as already present, the completed-review
count stayed four, and no reviewer remained pending. The prior-head reviews
plus the current-head deduplication prove new-head selection and same-head
suppression without requesting a duplicate.

## Provider-Free And Policy Matrices

The immutable candidate's prior pilot already covers automatic and explicit
cheap/deep/Copilot/none routes, trusted commands, unrelated events, Copilot
deduplication, a new Copilot head, exact-head replay/finalize/query, changed-head
reconciliation, and a distinct successor receipt. The canonical evidence is
[`pilot-evidence.md`](../../archive/2026-07/07-22-complete-v010-release-consumer-smoke/research/pilot-evidence.md).

The current 130-test source suite additionally passed the exact request,
correlation alias, conflicting fingerprint, authorized rerequest, ambiguous
mutation, local clean/fully-dispositioned evidence, missing/failed evidence,
sensitive and large-change floors, independent-review floor, bookkeeping-only
successor, mixed successor, explicit override, and required-floor cases. These
policy cases are deterministic and provider-free; they were not repeated as
paid adapter calls.

Setup discovery passed its parsed descriptor/fixture test for `ready`,
`absent`, declared invalid or disabled, incompatible, and metadata unavailable
states. The test performs no dispatch and reads no provider secret.

## Security, Limitations, And Rollback

- Both credentialed runs used the immutable direct-container adapter step. The
  workflow has no checkout and no workspace mount; the credential reference is
  present only on the container step.
- Repository variables contain backend descriptors only. The capped provider
  credential remains an Actions secret whose value was not read or copied.
- A bounded checkout scan found no high-entropy provider key pattern. Bounded
  scans of both credentialed run logs found no changed-file name, diff header,
  patch hunk, provider-secret assignment, authorization header, or prompt
  marker. Raw logs were not copied and their temporary cache was deleted.
- PR-Agent exposes findings through a conversation comment. Comment bodies
  were not read or copied into public evidence.
- Smoke PR #7 remains open as durable evidence. The event-driven router is
  restored to `active`; the durable workflow and its backend variables remain
  provisioned.
- Rollback is to disable the durable workflow, remove its two backend
  variables, revoke the pilot-only secret, and retain historical Check Runs and
  comments for reconciliation. Never move the released tag or issue a fallback
  review after an ambiguous result.
