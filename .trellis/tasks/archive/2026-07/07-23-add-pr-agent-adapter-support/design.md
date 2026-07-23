# PR-Agent Adapter Support Design

## Overview

PR-Agent remains a consumer-owned external backend. The router owns selection,
exact-head dispatch authorization, and receipts; a pinned PR-Agent container
owns review execution and writes its normal GitHub conversation comment.

## Standalone Flow

1. The router handles the GitHub event and selects `cheap` or `deep`.
2. The workflow passes the selected PR number and model to the immutable
   PR-Agent CLI container.
3. PR-Agent reads the pull request through GitHub APIs and publishes its review
   without a checkout.

The example uses the CLI instead of the upstream GitHub Action runner. The CLI
accepts an explicit PR URL and therefore behaves consistently for both
`pull_request` and trusted `issue_comment` events. Pinning the released
multi-platform container digest also closes the upstream Action's floating
base-image boundary.

## Durable Flow

```text
route -> canonical adapter request -> PR-Agent CLI -> acknowledge -> finalize
```

- `route` creates or reconciles the exact-head receipt and emits an adapter
  request only for the first authorized external dispatch.
- A workflow preflight requires backend ID `pr-agent` and a nonempty model;
  PR-Agent runs only when the request is nonempty and preflight succeeds.
- `acknowledge` decodes the generic external request, maps the adapter step
  outcome to `acknowledged` or `failed`, and emits canonical acknowledgment
  JSON. A failed preflight leaves the PR-Agent step `skipped`, which produces a
  failed acknowledgment without contacting the provider.
- `finalize` revalidates the live head and advances the same receipt. A failed
  adapter is recorded as failed; no fallback reviewer is dispatched.

## Contract Changes

- Add `acknowledge` to the action operation enum.
- Add inputs `adapter-request` and `adapter-outcome`.
- Add output `adapter-acknowledgment`.
- Add a strict decoder for the existing canonical adapter-request shape.
- Success maps to `status=acknowledged`; failure, cancelled, and skipped map to
  `status=failed` with bounded machine-readable error codes.

The helper does not call GitHub or a model provider and never accepts raw error
text. It copies only the request's logical identity, backend ID, and declared
finding channels into the acknowledgment.

## Security Boundaries

- The provider API key and GitHub token exist only in the PR-Agent container
  step. `PR_AGENT_MODEL_PROVIDER` conditionally maps the generic
  `PR_AGENT_MODEL_API_KEY` secret to one allow-listed single-key PR-Agent
  credential setting; the unselected mappings receive an empty value.
- Dynamic values enter the container as environment variables or action args;
  no pull-request text is interpolated into shell commands.
- Both workflows omit checkout and grant no `contents: write` permission.
- The container is pinned to the PR-Agent `v0.39.0` manifest digest.
- Metadata validation fails floating `docker://` references.

## Compatibility

- Existing standalone and durable callers are unchanged.
- `acknowledge` is additive and is not required for adapters that already emit
  canonical acknowledgment JSON.
- Empty models remain legal in the generic protocol, but the PR-Agent workflow
  preflight rejects them because this adapter needs deterministic
  provider/model configuration.

## Operational Notes

The PR-Agent GitHub Action normally posts as `github-actions[bot]`; descriptors
for this workflow must declare that review author and the
`conversation-comment` finding channel. Repository variables supply one model
provider and separate cheap and deep model IDs. The example explicitly maps
documented single-key provider credentials and disables fallback models to
avoid an unplanned provider/model change. Except for OpenAI, the workflow
requires provider-qualified model IDs.

Rollback is removal or disablement of the PR-Agent workflow. Durable receipts
already started before disablement remain reconciliation-required until an
operator determines whether PR-Agent published a finding; they must not be
reissued through another backend.
