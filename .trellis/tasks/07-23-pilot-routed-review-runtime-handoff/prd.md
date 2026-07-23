# Pilot routed-review runtime and handoff

## Goal

Prove the assembled routed-review runtime in the isolated private pilot and
publish an immutable, evidence-backed setup/receipt handoff for the command-pack
consumer without broadening repo-local implementation authority.

## Entry Gates

- Protocol core, durable receipts, and on-demand dispatch tasks are merged.
- `07-22-validate-external-reviewer-adapters` has produced acceptable live
  evidence for at least one external adapter.
- The maintainer has authorized the specific private-pilot mutations and any
  command-pack handoff PR; ordinary repo-local work-loop authority is not
  sufficient for those external writes.

## Requirements

- Run provider-safe pilot scenarios for automatic routing, every explicit
  intent, Copilot, one validated external adapter, `none`, and observable
  review/comment/check finding channels.
- Prove exact-head same-request replay, correlation alias replay, explicit
  same-head rerequest policy, conflicting request rejection, new-head
  invalidation, and interrupted dispatch reconciliation without duplicates.
- Prove clean/fully-dispositioned local evidence tier reduction, missing/failed
  evidence neutrality, sensitive/large-change floors, and skipped-evidence zero
  confidence.
- Prove a finish-work/bookkeeping-only successor creates a distinct current-head
  receipt and may select `none` only under `auto`/policy; mixed changes,
  explicit remote intent, and required floors cannot use that path.
- Validate read-only setup discovery for ready, truly absent,
  declared-invalid/disabled/incompatible, and metadata-unavailable states.
- Record candidate/action full SHA, workflow/run/PR evidence, receipt IDs,
  rollback steps, and sanitized results without secrets, raw findings, source,
  paths, prompts, or transcripts.
- Publish or prepare the versioned descriptor/schema/fixture and immutable
  commit identity handoff for the command-pack consumer under separate explicit
  upstream authority.

## Acceptance Criteria

- [ ] Copilot and one external adapter complete selection, dispatch,
  acknowledgment, durable receipt, observable finding, and new-head
  invalidation scenarios.
- [ ] Replay, rerequest, conflict, ambiguity, local evidence, review-floor, and
  successor matrices pass with no duplicate reviewer request.
- [ ] Setup discovery produces the documented state taxonomy without dispatch
  or provider secrets.
- [ ] The isolated pilot executes no PR-controlled code with credentials.
- [ ] Candidate SHA, source CI, pilot evidence, limitations, rollback, and
  maintainer approvals are recorded.
- [ ] A command-pack handoff names the immutable router identity and exact
  versioned contract; any upstream PR has separate explicit approval.
- [ ] Repository checks and post-pilot source task records are green.

## Dependencies

Depends on the three ordered runtime children and
`07-22-validate-external-reviewer-adapters`.

## Out Of Scope

- Implementing command-pack consumer code inside this repository, storing
  provider credentials, using production source, moving/replacing a published
  tag, or inferring external-write approval from this task's existence.
