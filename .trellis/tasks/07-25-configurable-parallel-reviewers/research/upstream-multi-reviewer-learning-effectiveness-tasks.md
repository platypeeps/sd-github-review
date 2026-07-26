# Upstream Task Tree Proposal: Multi-Reviewer Learning and Effectiveness

No upstream task, branch, commit, or pull request is authorized by this
handoff. The following is a paste-ready Trellis task tree for
`platypeeps/sd-ai-command-pack` after the parallel-review receipt contract is
available from `sd-github-review`.

The upstream checkout inspected while drafting this proposal was clean but on
`codex/implement-unified-routed-sd-review`. Create this work from a fresh
`main` after reconciling that branch; do not stack unrelated implementation on
the inspected checkout.

## Recommendation

Keep `sd-review-learnings` focused on its current purpose: detect recurring
review feedback and promote durable repository guidance. Generalize its input
from Copilot-centric evidence to all configured reviewers.

Create a separate `sd-review-effectiveness` command for comparative questions:
whether parallel reviewers are correct, complementary, reliable, timely, and
worth their incremental cost. This command recommends; it never changes model,
provider, reviewer-set, budget, routing, or branch-protection configuration.

| Surface | Owns | Does not own |
| --- | --- | --- |
| `sd-review-learnings` | Recurring feedback families, actionable current findings, preventive guidance | Reviewer ranking, cost/value analysis, model selection |
| `sd-review-effectiveness` | Same-head reviewer comparison, marginal value, correctness evidence, reliability, latency, cost | Repository guidance curation, automatic configuration changes |

## Parent Task

- Title: Add multi-reviewer learning and effectiveness analysis
- Slug: `multi-reviewer-learning-effectiveness`
- Priority: P2
- Base branch: `main`
- Children:
  - `generalize-review-learnings-reviewers`
  - `add-review-effectiveness-command`
- Depends on:
  - `sd-github-review/07-25-budget-aware-review-degradation`
  - `sd-github-review/07-25-configurable-parallel-reviewers`

### Parent Goal

Publish one privacy-bounded reviewer-evidence contract that lets the command
pack learn from every configured reviewer and independently evaluate the value
of parallel reviewer sets without conflating recurrence with correctness.

### Parent Requirements

- Define shared, versioned normalization for repository, PR, exact head, lane,
  plan/attempt, reviewer slot, candidate, handler, provider/model,
  configuration digest, finding identity/category, completion outcome,
  limitations, and observation time.
- Keep raw prompts, diffs, source content, credentials, unrestricted provider
  output, and unnecessary finding text outside the shared receipt.
- Reuse shared parsing, validation, provenance, bounding, and finding
  fingerprint code. Do not implement two divergent GitHub/receipt collectors.
- Preserve source/generated parity and all existing command-pack installation,
  help, manifest, audit, documentation, and safety contracts.
- Keep both children read-only by default and advisory. Neither may stage,
  commit, push, request reviews, or change reviewer configuration.

### Parent Acceptance Criteria

- [ ] Both children consume the same normalized reviewer-evidence schema and
      report incompatible, stale, truncated, or unavailable evidence visibly.
- [ ] Recurrence output cannot be presented as reviewer quality, and
      effectiveness output cannot mutate the learnings managed block.
- [ ] The implementation supports variable-length cheap and deep reviewer sets
      without hard-coding Copilot, Kimi, Qwen, a provider, a model, or exactly
      two reviewers.
- [ ] Migrated version-2 single-reviewer and Copilot-only configurations remain
      analyzable alongside variable-length plans; legacy receipts are read-only
      historical evidence rather than an active dispatch contract.

## Child 1: Generalize `sd-review-learnings` to All Reviewers

- Title: Generalize review learnings across configured reviewers
- Slug: `generalize-review-learnings-reviewers`
- Priority: P2
- Parent: `multi-reviewer-learning-effectiveness`

### Goal

Retain the skill's current learning workflow while collecting recurring and
currently actionable feedback from every reviewer represented by the routed
review contract, not only Copilot.

### Requirements

- Replace Copilot-specific internal collection/window naming with
  reviewer-neutral types while retaining backward-compatible CLI and JSON
  behavior where fields are still semantically valid.
- Collect configured native, external, and future reviewer findings through
  the shared receipt/provenance contract. Use GitHub comment/review APIs only as
  bounded evidence sources; use receipts to identify the responsible reviewer
  when a shared bot account publishes several candidates' findings.
- Preserve reviewer, candidate, provider/model, lane, plan, exact-head, and
  configuration provenance in bounded structured output so maintainers can
  trace a learning without embedding secrets or raw provider output.
- Keep current unresolved, non-outdated findings individually actionable.
  Deduplicate historical findings across reviewers before clustering so the
  same repeated observation is not inflated merely because several reviewers
  emitted it on one parallel plan.
- Continue producing the existing recurring task-metadata,
  boundary-validation, contract/documentation, generated-surface,
  reviewer/test-harness, and fallback families. Add a new family only when
  evidence proves the current taxonomy cannot represent a recurring lesson.
- Report reviewer-source coverage, missing sources, truncation, mixed-head
  exclusions, and unidentified publishers. Do not silently label an unknown
  bot comment as Copilot or a configured model.
- Keep preventive actions category-specific and evidence-thresholded. A
  pattern may cite contributing reviewer sources, but the skill must not rank
  their correctness, cost, or value.
- Preserve scan, update, external-update, dry-run, allow, planning-attempt,
  private-receipt, target-containment, and atomic managed-block behavior.
- Update the authoritative skill/script templates, generated copies, schemas,
  help, tests, README, command-pack documentation, changelog, manifest, and
  installer audit through the normal generation path.

### Acceptance Criteria

- [ ] Copilot, PR-Agent, and a third generic reviewer fixture contribute to one
      reviewer-neutral scan with correct provenance.
- [ ] Identical findings from multiple reviewers in one parallel plan count as
      one historical observation for recurrence while retaining all bounded
      contributing sources.
- [ ] Distinct recurring findings from different reviewers cluster normally
      and can produce the same preventive guidance as existing Copilot data.
- [ ] Unknown, missing, stale, mixed-head, and truncated sources remain visible
      and cannot be misattributed.
- [ ] No learning output ranks models or treats agreement, comment count, or
      thread resolution as evidence that a reviewer is correct.
- [ ] Existing Copilot-only fixtures and ordinary scan/update/planning behavior
      remain backward compatible.

## Child 2: Add `sd-review-effectiveness`

- Title: Add parallel reviewer effectiveness reporting
- Slug: `add-review-effectiveness-command`
- Priority: P2
- Parent: `multi-reviewer-learning-effectiveness`

### Goal

Add a separate read-only command and skill that evaluates the correctness,
marginal value, reliability, latency, and cost of parallel reviewers so users
can decide whether fan-out is worthwhile and whether the configured candidates
belong in cheap and deep reviewer sets.

### Evidence Requirements

- Consume the shared parent-plan/child receipt contract plus explicit finding
  dispositions: `accepted`, `rejected`, `duplicate`, `superseded`, or
  `unresolved`.
- Do not infer correctness from thread resolution, comment deletion, author
  identity, reviewer agreement, or a later code change alone. Preserve
  `unresolved` unless trusted adjudication evidence exists.
- Restrict direct quality comparisons to reviewers dispatched from the same
  parent plan against the same repository, PR, exact head, lane, and relevant
  configuration period. Report unpaired operational evidence separately.
- Reject or limit corrupt, incompatible, stale, truncated, mixed-head, or
  identity-inconsistent evidence visibly.

### Evaluation Requirements

- Compute deterministic metrics per lane, candidate, handler,
  provider/model, reviewer pair, and observed reviewer set:
  - completion, failure, timeout, ambiguity, skip, and deferral counts;
  - adjudication coverage and unresolved rate;
  - accepted, rejected, duplicate, and superseded finding counts;
  - precision over adjudicated non-duplicate findings, labeled as conditional
    on the available dispositions rather than global truth;
  - finding overlap and unique-finding counts;
  - marginal unique accepted findings contributed beyond peers in the same
    plan;
  - cost and latency per completed review, adjudicated finding, accepted
    finding, and unique accepted finding when available;
  - budget availability/recovery and provider-diversity resilience; and
  - plans in which each reviewer changed the actionable outcome.
- Do not claim recall without an independent ground-truth defect set.
  Peer-discovered misses are a bounded comparative signal, not complete recall.
- Separate redundancy from resilience. A reviewer with few unique findings may
  still add availability or provider-diversity value; report this independently
  from correctness and marginal finding value.
- Segment results by cheap/deep lane, relevant risk/path family, configuration
  digest, and time window. Do not blend materially different model versions,
  prompts, or policies into one score.
- Require configurable minimum paired-sample and adjudication-coverage
  thresholds before recommending model/reviewer changes. Below either
  threshold, report `insufficient-evidence` and name the missing evidence.
- Accompany every rate with its numerator/denominator and a deterministic
  uncertainty range or similarly bounded evidence-strength representation.
- Never use raw comment volume, reviewer-asserted severity, or agreement alone
  as a quality score.

### Report Requirements

- Add `sd-review-effectiveness` as a new command/skill with schema-versioned
  JSON and concise human/Markdown output. Keep the initial command read-only;
  callers may capture stdout as a report artifact.
- Support bounded time windows and explicit repository, PR, and plan scopes.
  Name exact input freshness, coverage, exclusions, and truncation.
- For each lane and candidate, emit one advisory disposition such as:
  - `insufficient-evidence`;
  - `retain-for-unique-value`;
  - `retain-for-resilience`;
  - `mostly-redundant`;
  - `cost-ineffective`; or
  - `correctness-concern`.
- Every disposition must include the paired sample, adjudication coverage,
  time/configuration range, metrics, limitations, and evidence needed to revisit
  it.
- Compare observed variable-length sets and report the marginal cost and
  marginal accepted findings associated with each reviewer. Do not assume a
  two-reviewer Copilot-plus-model topology.
- Keep the final decision human-owned. Paste-ready candidate/reviewer-set
  examples are allowed after sufficient evidence, but the command never applies
  them.

### Acceptance Criteria

- [ ] Same-head paired fixtures distinguish overlap, unique findings,
      accepted/rejected dispositions, duplicates, and unresolved evidence
      without treating thread resolution as correctness.
- [ ] A noisy reviewer with many rejected findings cannot outrank a quieter
      reviewer with accepted findings because of raw volume.
- [ ] Reviewers repeating the same accepted finding receive overlap credit but
      no duplicate marginal-value credit.
- [ ] Unique accepted findings deterministically change reviewer and set-level
      marginal-value output.
- [ ] Mixed-head, unpaired, stale, corrupt, truncated, unavailable, and
      configuration-drift fixtures cannot produce a confident recommendation.
- [ ] Missing cost, latency, or adjudication evidence is unavailable, never
      zero-filled or fabricated.
- [ ] Reports separately evaluate cheap, deep, one-reviewer, and
      variable-length parallel configurations with generic candidates.
- [ ] Minimum evidence thresholds produce `insufficient-evidence` until both
      paired sample and adjudication coverage are adequate.
- [ ] Reliability/resilience remains separate from correctness,
      complementarity, and cost-effectiveness.
- [ ] JSON and Markdown output is deterministic, schema-versioned,
      privacy-bounded, and stable across input ordering.
- [ ] The new command performs no learning-file update, configuration mutation,
      staging, commit, push, or review request.

## Shared Risks and Potential Issues

- Correctness requires trusted finding adjudication. Without it, effectiveness
  can report overlap and operations but must not rank reviewer quality.
- Parallel selection may be biased toward unusually risky PRs. Same-plan
  exact-head pairing reduces but does not eliminate that limitation.
- Provider/model aliases and prompts may change over time. Configuration
  digests and bounded time windows are required.
- Copilot completion and billing evidence may arrive on a different schedule
  from external adapters. Freshness and unavailable states must remain visible.
- Small samples can make cost-per-finding and correctness rates unstable.
  Thresholds, raw counts, and uncertainty are mandatory.

## Suggested Validation Fixtures

1. Copilot plus Kimi on one deep exact-head plan, with one overlapping accepted
   finding and one unique accepted finding.
2. A three-reviewer deep plan with a redundant third reviewer and measurable
   incremental cost.
3. An independent cheap plan using different candidates/providers.
4. An explicit-candidate override targeting one named overridable chain slot
   while fixed parallel reviewers remain.
5. Timeout, deferred budget, provider failure, ambiguous dispatch, and later
   recovery.
6. Unresolved and rejected findings, duplicates, changed heads/configuration
   digests, unknown publishers, and incomplete cost data.
