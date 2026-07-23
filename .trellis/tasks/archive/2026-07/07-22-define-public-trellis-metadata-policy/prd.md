# Define public Trellis metadata policy

## Goal

Define and enforce which Trellis workspace, task, and agent metadata may be
published in this public repository without silently exposing local-only
context or requiring an implicit history rewrite.

## Background

- The public repository intentionally tracks Trellis workflow, specs, tasks,
  shared platform adapters, command-pack installation receipts, and three
  Trellis workspace Markdown files.
- `.trellis/.gitignore` and the command-pack-managed root `.gitignore` already
  exclude most runtime and local platform state, but CI does not currently
  reject a prohibited path that was force-added or tracked before an ignore
  rule existed.
- Existing workspace journals are already in public history. They contain
  project delivery evidence and no detected absolute local paths or credential
  values, so this task retains them as public project records. Removing them
  from history remains a separate destructive decision.

## Requirements

- Inventory tracked and ignored `.trellis`, `.agents`, and platform-adapter
  metadata, including the workspace journals already present in public history.
- Classify each surface as public project knowledge, generated distribution,
  or local/session-only state.
- Align `.gitignore`, documentation, pack installation behavior, and validation
  with one explicit forward-looking policy.
- Treat removal from existing public Git history as a separate destructive
  decision requiring explicit maintainer approval.
- Preserve task/spec information required for reproducible AI development.
- Treat tracked Trellis workspace Markdown as public project records: keep
  indexes and journals reviewable, secret-free, and limited to delivery facts.
- Extend the existing metadata validation gate so prohibited tracked paths fail
  locally and in CI even when Git ignore rules were bypassed.

## Acceptance Criteria

- [x] A documented allow/deny policy covers every tracked metadata family.
- [x] Validation prevents newly prohibited local/session artifacts from being
  committed while allowing required Trellis project knowledge.
- [x] Existing public journal exposure is acknowledged and given a deliberate
  retain/remove-history decision.
- [x] Relevant install, metadata, and repository checks pass.
- [x] Tests prove prohibited runtime/session paths fail while current shared
  Trellis, workspace, agent, and platform-adapter paths remain allowed.

## Out of Scope

- Rewriting Git history without explicit approval.
- Removing the existing workspace journals from the repository tip.
- Changing routing behavior.
