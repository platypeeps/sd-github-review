---
title: Reduce the cheap review prompt
status: planning
created: 2026-07-25
---
# Reduce the cheap review prompt

## Goal

Design and validate reusable candidate-bound cheap prompt profiles for routine
reviews without losing actionable findings.

## Background

The event-driven and durable workflows both invoke PR-Agent's `review` command
with the standard review configuration. They do not currently bind each cheap
candidate to an explicit smaller prompt/output profile, and one lane-wide
profile would assume different models behave identically.

## Requirements

- Inventory which PR-Agent review prompt and output controls are stable in the
  pinned container version and can be applied only to the cheap route.
- Define one or more routine-review profiles that prioritize correctness,
  security, regressions, and actionable findings while removing optional
  verbosity and low-value output. Reuse one profile only where candidate/
  profile qualification proves compatibility; create a candidate-specific
  profile when model behavior requires it.
- Keep immutable alias/version/digest metadata and candidate bindings in the
  pinned private catalog and the actual prompt/configuration values in the
  consumer adapter registry keyed by that identity. Do not add those values or
  source content to repository source, router inputs, receipts, summaries, or
  logs.
- Require every cheap external candidate to reference exactly one profile.
  Forbid a lane default, inheritance, merge rules, fallback profile, and manual
  or runtime profile override.
- Build a curated evaluation set of routine PRs with expected findings and
  benign changes that should not produce noise.
- Measure token reduction, actionable-finding recall, and false-positive rate
  for each candidate/profile pair against the existing profile and record
  limitations before changing bindings through a normal reviewed repository
  change.
- Treat those measurements as advisory for version 1; do not require a fixed
  threshold, minimum sample, observation window, or separate pilot approval.
- Preserve deep-review behavior and manual escalation.

## Acceptance Criteria

- [ ] Each cheap external candidate has one explicit immutable profile binding
      used consistently by both event-driven and durable PR-Agent workflows.
- [ ] Fixtures prove compatible candidates may share one profile while a
      candidate-specific profile can be selected without adapter source changes.
- [ ] The evaluation report compares token reduction and review quality,
      records sample limitations, and does not present advisory evidence as a
      formal promotion gate.
- [ ] Tests prove each cheap candidate receives its exact bound profile while
      deep candidates retain their own explicit profiles.
- [ ] Missing, unknown, incompatible, digest-mismatched, substituted, defaulted,
      or independently overridden profiles fail before dispatch.
- [ ] Workflow logs and durable artifacts contain no prompt text or source
      content.
- [ ] Documentation explains the cheap profile's intentional omissions and
      when maintainers should request deep review.

## Dependencies

- `07-25-define-review-candidate-catalog` — immutable profile alias/version/
  digest metadata and candidate bindings live in the pinned private catalog.
- `07-25-compile-routed-review-configuration` — compiles each candidate's exact
  profile binding and rejects defaults/inheritance/overrides.
- `07-25-integrate-pr-agent-review-adapter` — the adapter registry holds actual
  prompt/configuration values keyed by profile identity and applies them in
  both event-driven and durable workflows.

## Out of Scope

- Replacing PR-Agent's review engine or maintaining a forked prompt template
  without a documented upgrade strategy.
- Applying PR-Agent prompt profiles to native Copilot prompting.

## References

Research notes that lived beside this item's Trellis record and were not carried
into docs/work. Recover the bodies from git history under `.trellis/tasks/07-25-reduce-cheap-review-prompt`:

- research/2026-08-20-research.md
