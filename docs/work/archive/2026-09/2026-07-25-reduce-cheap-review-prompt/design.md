# Candidate-Bound Cheap Prompt Profiles Design

## Boundary

This task owns the concrete reduced prompt profiles used by cheap external
candidates and their advisory quality/cost comparison. The candidate catalog
owns immutable profile identity and binding metadata; the PR-Agent adapter owns
the private registry values and exact resolution/application mechanism.

## Profile Model

Each profile has a stable alias, version, digest, and compatible PR-Agent/
runtime capabilities. The private adapter registry is keyed by the same
identity. Each cheap external candidate references exactly one profile.
Compatible candidates may share an entry; models that need different
instructions or output controls use distinct entries. Qualification always
covers the candidate/profile pair.

Version 1 has no lane default, inheritance, merge order, fallback profile,
runtime preset, or comment-command profile selector. Native Copilot prompting
is handler-managed and outside this registry.

## Data Flow And Privacy

The managed compiler receives only safe profile alias/version/digest and
compatibility facts. Authorization and preflight bind that identity to the
candidate and prepared request. The private adapter resolves and verifies the
actual profile before dispatch and acknowledges the applied identity. Prompt
bodies and configuration values never enter source, compiled output, receipts,
options, logs, or evaluation evidence.

## Change, Evaluation, And Rollback

Changing profile values creates a new immutable version/digest and invalidates
each affected candidate/profile qualification. Version-1 comparison evidence
is advisory and does not require formal pilot approval. A normal reviewed
catalog/adapter update changes a binding. Rollback restores the prior catalog
pin and matching private profile registry entry; it never falls back to an
implicit lane profile.

## Validation

- Shared and candidate-specific profile fixtures resolve deterministically.
- Both PR-Agent workflow paths apply the identical bound profile.
- Missing, incompatible, mismatched, substituted, or defaulted profiles fail
  before reviewer invocation.
- Reports compare candidate/profile pairs without retaining prompts, source,
  findings, credentials, or raw model output.
