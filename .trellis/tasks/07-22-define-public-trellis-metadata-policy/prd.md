# Define public Trellis metadata policy

## Goal

Define and enforce which Trellis workspace, task, and agent metadata may be
published in this public repository without silently exposing local-only
context or requiring an implicit history rewrite.

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

## Acceptance Criteria

- [ ] A documented allow/deny policy covers every tracked metadata family.
- [ ] Validation prevents newly prohibited local/session artifacts from being
  committed while allowing required Trellis project knowledge.
- [ ] Existing public journal exposure is acknowledged and given a deliberate
  retain/remove-history decision.
- [ ] Relevant install, metadata, and repository checks pass.

## Out of Scope

- Rewriting Git history without explicit approval.
- Changing routing behavior.
