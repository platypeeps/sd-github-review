# Evaluate cheap provider failover pilot

## Goal

Collect bounded availability, latency, provenance, and cost evidence to inform provider-routing changes during the fast-moving MVP.

## Requirements

- Document the current availability objective, comparison cohorts, observation
  window, and stop conditions when they help interpret the experiment. These
  may change between reports as the MVP evolves.
- Compare primary-only against policy-compliant same-model routing using bounded
  success, eligible/ineligible error, latency, failover, provider-provenance,
  usage, and cost evidence.
- Segment configuration/runtime changes and report missing or biased evidence;
  do not infer model quality from operational availability alone.
- Produce an advisory keep/adjust/disable recommendation without automatically
  changing endpoint policy or chain membership.
- Do not require a formal pilot approver, fixed minimum sample, mandatory
  threshold, signed decision, or decision expiry in version 1. Any policy
  change still uses the normal reviewed repository workflow.

## Acceptance Criteria

- [ ] Each report records the configuration/runtime digests, cohorts,
      exclusions, and any objective/window used so its evidence can be
      interpreted without treating those values as a durable approval gate.
- [ ] Reports distinguish no-failover success, successful failover, exhausted
      providers, policy rejection, and unknown provenance.
- [ ] Evidence contains no prompts, diffs, findings, source, or credentials.
- [ ] Missing or insufficient evidence is stated plainly and does not block an
      MVP change that maintainers choose to make through normal review.
- [ ] No report or runtime path automatically changes endpoint policy or chain
      membership.

## Dependencies
- `07-25-qualify-cheap-review-candidates` — only qualified candidates enter the
  observation cohort.
- `07-25-enforce-same-model-provider-failover` — the enforced policy under
  observation.

## Out of Scope

- Automatic policy mutation or reviewer-effectiveness evaluation.
- Formal pilot-approval governance for version 1.
