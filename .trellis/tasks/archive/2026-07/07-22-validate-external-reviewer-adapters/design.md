# External Reviewer Adapter Pilot Design

## Overview

Treat this task as a bounded live validation of the already-delivered PR-Agent
adapter. The router remains provider-neutral; the private consumer workflow
owns the provider selection, credential, execution, and finding publication.

## System Boundary

```text
synthetic private PR event
  -> sd-github-review at an immutable full SHA
  -> selected cheap/deep model output
  -> pinned PR-Agent container
  -> conversation comment on the private PR
```

The router receives GitHub metadata and emits a route/model. It never receives
the OpenRouter key. The workflow maps `PR_AGENT_MODEL_API_KEY` to
`OPENROUTER__KEY` only on the PR-Agent container step. No checkout step is
allowed.

## Pilot Topology

- Source repository: `platypeeps/sd-github-review`.
- Consumer repository: private `platypeeps/sd-github-review-pilot`.
- Provider/model: OpenRouter with
  `openrouter/moonshotai/kimi-k2.6` for both policy tiers.
- Finding surface: GitHub conversation comment from `github-actions[bot]`.
- Installer-managed workflow path: `.github/workflows/ai-review-router.yml`.

The pilot already has an active provider-free `review-router.yml` with the same
event family. Activating both would permit duplicate routing. The private pilot
change therefore disables or replaces the provider-free event workflow before
the installer-managed PR-Agent workflow is landed on the default branch.
Durable provider-free workflow evidence is preserved and is not expanded here.

## Scenario Contract

| Scenario | Trigger | Required bounded evidence |
| --- | --- | --- |
| Readiness | Installer `check`/dry-run plus GitHub metadata discovery | Private target, one intended trigger owner, exact source identity, required variables and secret name present |
| Cheap | Apply `review:cheap` to a same-repository synthetic PR | `cheap`, Kimi model ID, successful PR-Agent step, conversation-comment finding |
| Deep | Apply `review:deep` or trusted `/review deep` | `deep`, same bounded Kimi model ID, successful PR-Agent step, conversation-comment finding |
| Secret boundary | Inspect workflow definition and sanitized run metadata | Secret appears only on the PR-Agent step; logs/evidence contain no value or raw provider output |
| Rollback | Disable/uninstall preview and resource ownership check | Only installer-owned files/variables are selected; historical runs/comments and the secret are preserved by default |

The two tiers intentionally use one model. This validates route-policy identity
and adapter wiring, not comparative model quality or pricing.

## Evidence Record

Each public row contains only:

- scenario ID and timestamp;
- exact source Action SHA and private pilot PR head SHA;
- private workflow run URL and PR number;
- selected route, provider, and model identifiers;
- finding-channel type and pass/fail state;
- bounded limitation and rollback state.

It excludes secret values, raw comments/findings, source content, filenames,
prompts, event payloads, provider transcripts, and pricing.

## Rollout And Rollback

1. Review the installer dry-run and the removal/disablement of the existing
   provider-free event workflow.
2. Provision the capped OpenRouter key directly through GitHub's hidden secret
   input and land the private pilot workflow change.
3. Run the cheap scenario first; stop immediately on unexpected provider use,
   permission failure, checkout behavior, or secret exposure.
4. Run deep only after cheap passes, then capture sanitized evidence.
5. On failure, disable the credentialed workflow. Use the installer uninstall
   preview before removing managed resources; preserve the secret unless the
   maintainer explicitly authorizes its deletion.

## Trade-Offs

- Event-driven PR-Agent provides the smallest proof of live adapter execution;
  the later runtime pilot owns durable replay and new-head matrices.
- Keeping the same model for cheap/deep reduces credential and model variance
  while still proving both routing tiers.
- A private pilot protects synthetic findings and credentials, but public task
  evidence must therefore remain deliberately bounded and sanitized.
