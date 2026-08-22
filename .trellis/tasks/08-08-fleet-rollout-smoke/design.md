# Design — fleet rollout smoke

## Boundaries

Three systems participate, and conflating them is what produced the prior revision's wrong
mechanism claim:

| System | Owns | Not responsible for |
| --- | --- | --- |
| `sd-ai-command-pack` fleet refresh | installing/updating the pack in consumers; cohort order and concurrency policy in its own docs/fleet/consumers.json | the review lane |
| `sd-github-review` consumer installer (`scripts/install-consumer.mjs`) | descriptor + durable workflow + GitHub variable/label/secret setup in one consumer | cohort sequencing; cross-repo orchestration |
| this task | driving the installer across consumers in manifest order, and proving each with a smoke PR | changing either tool |

The manifest is read as the **source of cohort order only**. The rollout does not modify it.

## Contract being installed

Two files per consumer, both installer-produced from sources in this repository:

```
contract/routed-review-setup-v1.json  ->  config/routed-review-setup-v1.json
examples/sd-review.yml                ->  .github/workflows/sd-review.yml
```

Mapping is declared in `scripts/consumer-installer/codecs.mjs` (`DESCRIPTOR_SOURCE_PATH` /
`DESCRIPTOR_PATH`, `DURABLE_TEMPLATE_PATH` / `DURABLE_WORKFLOW_PATH`). A local manifest records
the installed state, including `routeMode`.

`sd-review.yml` is a `workflow_dispatch` lane. The receipt Check Run `sd-github-review/receipt`
is published against the smoke PR head.

## Data flow per consumer

```
read manifest cohort order
  -> resolve consumer checkout from pathHint
  -> check            (read-only; establishes prior state)
  -> install|update   (writes descriptor + workflow + local manifest; sets GitHub var/label/secret)
  -> open smoke PR
  -> await sd-github-review/receipt Check Run on the PR head
  -> record run URL + descriptor SHA
```

`check` before every write is what distinguishes install from update and makes a re-run of the
rollout safe. `sd-github-review` is already installed, so its path is `check` → smoke PR,
never `install`.

## Route mode

`--route-mode` is required with no default; valid values are `auto`, `cheap`, `deep`,
`copilot`, `none`. The installer resolves it via a documented cascade: CLI flag, then the
recorded manifest value, then the observed `REVIEW_ROUTE_MODE` repository variable, then
refusal. The rollout passes the flag explicitly for every consumer rather than relying on
ambient repository state, so the chosen mode is recorded in the run log and in the local
manifest.

This is a per-consumer decision and an input to the task, not something the design picks.

## Thin mode

Every consumer is `mode: thin`. Thin describes whether the consumer vendors the pack tree. The
consumer installer has no thin/fat awareness — the concept does not appear in its source — so
the lane install is orthogonal to it by construction. `sd-github-review` is thin and fully
deployed, which is consistent but not general proof. The first canary is the experiment that
settles it; if the canary install fails in a way attributable to thin mode, the rollout stops
there and the finding is recorded before anything else is touched.

## Failure and rollback

- **Canary failure**: stop immediately. Record the consumer, the command, and the failure. Do
  not proceed to the next cohort.
- **Post-canary failure**: the failing consumer stops; its cohort peers already in flight are
  allowed to finish, and the next cohort does not start.
- **Per-consumer rollback**: `uninstall` removes the descriptor, the durable workflow, and the
  local manifest, and reverses the remote actions. The smoke PR is closed unmerged.
- **Blast radius**: each consumer is independent. There is no shared state to unwind beyond
  the per-repo artifacts and the per-repo GitHub variable/label/secret.

Smoke PRs are proof-of-receipt artifacts. They are not merged by this task.

## Tradeoffs

- **Explicit `--route-mode` per consumer over reading `REVIEW_ROUTE_MODE`.** More input
  required up front, but the alternative silently inherits whatever a repository happens to
  carry, which is the same class of invisible drift the task exists to close.
- **`check` before every write.** One extra call per consumer; buys idempotence and makes a
  partial rollout resumable rather than requiring a clean start.
- **Sequential canaries despite nine consumers.** Slower, but a systemic defect surfaces on
  repository one instead of repository nine.

## Compatibility

Descriptor schema is `routed-review-setup-v1`. The local manifest is at schema 4; the installer
recognizes schema 2 as pre-durable and schema 3 as pre-route-mode and migrates them. No
consumer here carries a prior installation except `sd-github-review`, so migration paths are
not exercised by this rollout.
