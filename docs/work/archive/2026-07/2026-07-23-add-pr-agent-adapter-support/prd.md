---
title: Add PR-Agent adapter support
status: done
created: 2026-07-23
branch: codex/add-pr-agent-support
---
# Add PR-Agent adapter support

## Goal

Make PR-Agent an executable, documented external-reviewer option for both
standalone event routing and durable on-demand routing without adding provider
credentials or a reviewer runtime to the router itself.

## Background

- The router already selects `cheap` or `deep`, emits a model, and exposes a
  generic external-adapter contract.
- `examples/pr-agent-router.yml` invokes PR-Agent, but its upstream Action
  reference is a placeholder and the upstream Action delegates to a floating
  container tag.
- The generic durable workflow still contains a non-runnable adapter
  placeholder and requires the consumer to construct an acknowledgment.
- PR-Agent's GitHub Action runner depends on pull-request or issue-comment
  event payloads. Its official CLI accepts an explicit PR URL, so an immutable
  CLI container is the compatible boundary for `workflow_dispatch`.
- The upstream `v0.39.0` multi-platform image is published as
  `pragent/pr-agent@sha256:cae31b51b65b5c978a3b2a978d96e89e6a4c5bcd81cb2553fd8dad0251c3a23e`.

## Requirements

- Preserve `cheap`, `deep`, `copilot`, and `none` as the public route names;
  PR-Agent remains an external backend selected for `cheap` and/or `deep`.
- Replace the standalone PR-Agent example with a no-checkout invocation pinned
  to an immutable PR-Agent container digest.
- Add a durable PR-Agent example that consumes the canonical adapter request,
  runs only for a newly authorized external dispatch, records success or
  failure as a canonical v1 acknowledgment, and finalizes the same receipt.
- Add a bounded `acknowledge` operation that validates the adapter request and
  converts a GitHub step outcome into a canonical acknowledgment without
  reading provider secrets, findings, source, prompts, or transcripts.
- Require explicit nonempty model identifiers at the PR-Agent adapter boundary;
  the generic router continues to allow empty model values for other adapters.
- Select the PR-Agent model provider independently from the cheap/deep model
  IDs, use one provider-neutral API-key secret, and ship the documented OpenAI,
  Gemini, OpenRouter, Anthropic, Cohere, Replicate, Groq, SambaNova, xAI,
  DeepSeek, DeepInfra, Mistral, and Codestral credential mappings without
  passing either value through the router.
- Pin every published Docker adapter reference by digest and reject floating
  `docker://` references in metadata validation.
- Keep provider credentials exclusively on the PR-Agent step. Neither example
  may check out or execute pull-request-authored code.
- Update README and DESIGN guidance once, removing stale PR-Agent licensing and
  supply-chain statements rather than duplicating setup instructions.
- Move backend-specific GitHub provisioning into dedicated Copilot and
  PR-Agent setup guides, and keep the README installation section as the
  shared entry point.

## Acceptance Criteria

- [x] Standalone `cheap` and `deep` routes invoke the pinned PR-Agent CLI image
  against the router-selected PR and require configured model variables.
- [x] The durable example performs route, PR-Agent dispatch, canonical
  acknowledgment, and receipt finalization with no checkout.
- [x] Successful and failed adapter outcomes produce validated acknowledgments;
  malformed requests and unsupported outcomes fail before acknowledgment,
  while missing PR-Agent configuration prevents provider execution and
  finalizes the receipt as failed.
- [x] Tests parse both PR-Agent examples, assert exact digest pinning,
  permissions, conditions, model/secret boundaries, and no checkout.
- [x] Metadata validation rejects floating Docker image references.
- [x] README, DESIGN, action metadata, fixtures, and tests agree on the
  `acknowledge` operation and PR-Agent finding identity.
- [x] Dedicated Copilot and PR-Agent setup guides describe GitHub-owned versus
  workflow-automated configuration, and README links to both without repeating
  their backend-specific instructions.
- [x] Both PR-Agent examples accept a generic provider selector and API-key
  secret, map the documented OpenAI, Gemini, OpenRouter, Anthropic, Cohere,
  Replicate, Groq, SambaNova, xAI, DeepSeek, DeepInfra, Mistral, and Codestral
  credentials only on the PR-Agent step, and reject missing or unknown provider
  selections and incompatible provider-qualified model identifiers before
  provider execution.
- [x] `npm test`, `npm run check`, `npm run validate:metadata`, and
  `git diff --check` pass.

## Out of Scope

- Changing the route taxonomy or making PR-Agent a native router-side reviewer.
- Storing provider credentials, proxying model traffic, or publishing raw
  reviewer findings in receipts.
- Live credentialed pilot execution; that remains a gated follow-up in the
  parent adapter-validation and private-pilot tasks after a test provider key
  is provisioned.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/archive/2026-07/07-23-add-pr-agent-adapter-support`:

- research/upstream-pr-agent.md
