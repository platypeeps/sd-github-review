# Validate external reviewer adapters

## Goal

Validate the documented PR-Agent consumer path with one bounded, credentialed
private pilot while keeping reviewer execution and provider credentials outside
the router.

## Confirmed Baseline

- Child task `07-23-add-pr-agent-adapter-support` delivered the executable
  standalone and durable PR-Agent workflows, canonical acknowledgment support,
  provider/model validation, immutable container pinning, and contract tests.
- The private pilot target is `platypeeps/sd-github-review-pilot`. It is private,
  contains only synthetic smoke content, and currently runs provider-free router
  workflows pinned to the v0.1.0 release commit.
- The pilot now has the three approved OpenRouter/Kimi Actions variables and a
  repository-scoped `PR_AGENT_MODEL_API_KEY` secret. Only the secret name and
  presence were inspected; its value was never printed or recorded.
- Source commit `694f53f5df937b07e7ab7ae037e862a9bb84b1b1` passed source CI in
  GitHub Actions run `30138887176`; the pilot workflow must still use an
  explicitly reviewed immutable source identity.
- The first credentialed cheap run reached the pinned container with the
  correct provider/model and masked secret, then failed before provider
  execution because `uses: docker://` changed the CLI image working directory.
  The source workflow must use the reviewed direct CLI-container invocation
  before the pilot resumes; no retry or fallback is allowed on the broken pin.

## Approved Pilot Boundary

- Use Kimi K2.6 through the existing OpenRouter adapter mapping, not Gemini or
  a new direct-provider credential shape.
- Set `PR_AGENT_MODEL_PROVIDER=openrouter` and use
  `openrouter/moonshotai/kimi-k2.6` for both `CHEAP_REVIEW_MODEL` and
  `DEEP_REVIEW_MODEL`.
- Store the capped key only as the private pilot repository's
  `PR_AGENT_MODEL_API_KEY` Actions secret. Never place it in this repository,
  task artifacts, workflow inputs, command arguments, summaries, receipts, or
  provider transcripts.
- Run only one event-driven review workflow for a trigger path. The existing
  provider-free workflow must be disabled or replaced before the PR-Agent
  workflow becomes active.

## Requirements

- Use the repository-owned consumer installer to preview and provision the
  event-driven PR-Agent workflow, variables, labels, manifest, and secret
  presence in the isolated pilot checkout. Review and commit the resulting
  private-repository diff separately; the installer must not commit or push it.
- Exercise same-repository `cheap` and `deep` routes against synthetic smoke
  content and confirm the selected tier/model, successful PR-Agent execution,
  and an observable conversation-comment finding surface.
- Confirm the workflow does not check out pull-request code, passes the
  provider key only to the PR-Agent container step, keeps fallback models
  disabled, keeps restricted mode enabled, mounts no repository workspace, and
  preserves the CLI image's required `/app` working directory.
- Record only sanitized evidence: exact source and pilot head SHAs, scenario
  ID, workflow run URL, selected route, provider/model identifiers, finding
  channel type, result, limitation, and rollback state. Do not record secret
  values, raw findings, source text, paths, prompts, transcripts, or pricing.
- Exercise or concretely verify rollback: disable the credentialed workflow,
  preserve historical evidence, and remove only installer-owned resources.
- Keep the generic internal adapter request/acknowledgment contract aligned
  with the durable receipt contract; do not introduce a provider-specific
  receipt or fallback dispatch path.

## Acceptance Criteria

- [x] Contract tests cover standalone and durable PR-Agent workflow shape,
  fixed provider mappings, immutable container digest, and canonical
  acknowledgment behavior.
- [x] The internal adapter contract defines request, acknowledgment, failure,
  timeout, observability, secret, and no-fallback boundaries.
- [x] Production-oriented examples are executable after documented secret and
  immutable-SHA substitution; templates cannot be mistaken for runnable code.
- [x] Empty models remain valid at the generic router boundary and fail before
  PR-Agent starts at the adapter boundary.
- [x] Neither PR-Agent example checks out or executes untrusted pull-request
  code with provider credentials.
- [ ] Bounded live evidence identifies OpenRouter and Kimi K2.6 without
  recording credentials, raw provider output, source content, or pricing.
- [ ] `cheap` and `deep` scenarios each complete selection, PR-Agent execution,
  and an observable conversation-comment finding in the private pilot.
- [ ] Sanitized evidence records the exact immutable identities, limitations,
  and verified rollback state, and repository checks remain green.

## Dependencies

Executable PR-Agent support is complete in child task
`07-23-add-pr-agent-adapter-support`. Full durable replay, rerequest,
new-head, and successor matrices remain owned by
`07-23-pilot-routed-review-runtime-handoff`; this task supplies its required
live external-adapter evidence.

## Out Of Scope

- Production repositories or credentials, provider pricing evaluation,
  Gemini fallback, a direct Kimi credential mapping, raw reviewer-output
  publication, broad runtime changes, or the full durable routed-review pilot.
