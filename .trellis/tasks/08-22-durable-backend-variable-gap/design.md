# Design

## Decision

**The installer provisions both backend variables, synthesizing their values
from configuration it already records. Manifest schema goes 4 → 5.**

The two variables join the managed-resource table, which is what buys `check`
drift detection and `uninstall` cleanup — the two properties the requirements
actually turn on. Synthesizing rather than storing keeps provider and model as
the single source of truth.

## Alternatives considered and rejected

### B — inline the descriptors into the workflow at install time

Stop reading `vars.*`; write the JSON directly into each consumer's
`sd-review.yml`.

Rejected, and more firmly than "it weakens drift detection". The manifest
decoder *requires* the two hashes to be equal (`codecs.mjs:360`):

```js
if (value.source.sha256 !== value.workflow.sha256) {
```

A workflow whose content is a function of per-consumer configuration can never
satisfy that, so option B is not a trade-off — it breaks a decoder invariant
and would require dismantling it first. It also makes changing a model a
workflow rewrite rather than a variable edit.

### C — have the action synthesize a default backend when the input is empty

Rejected on safety, not convenience. A backend descriptor declares
`reviewAuthors`, and `reviewAuthors` feeds receipt authority — it is how the
system decides which review comments count as that backend's findings. An
action that invents review authors misattributes review provenance. Failing
closed on a missing backend is correct behavior; the defect is that nothing
provisions the input, not that the action refuses an empty one.

This one is worth stating plainly because C is the smallest diff and the most
tempting. It trades a loud, correct failure for a quiet, wrong success.

## Why synthesized, not stored

The descriptors are wholly determined by `configuration.provider`,
`configuration.cheapModel`, and `configuration.deepModel`, all already in the
manifest. Recording the rendered JSON as well would create two representations
of one fact, free to disagree — and a manifest that disagrees with itself is
worse than one that is merely incomplete.

So `CONFIG_VARIABLES` gains two entries whose values are *derived*, not
config-field references. The table's current shape maps a variable name to a
configuration field name; it needs a second kind of entry — a name plus a
function of the configuration. That is the main structural change, and it must
stay in the one table, because every downstream behavior (`install`, `update`,
`check` drift, `uninstall`) reads from it. Adding a parallel list beside the
table is the failure mode to avoid.

## Provision unconditionally, including for `copilot` and `none`

`DEFAULT_CONFIG` always supplies a provider and both models, so synthesis is
always possible regardless of route mode.

More importantly it is not optional in practice. Neither `REVIEW_ROUTE_MODE`
nor the review floor is a durable constraint on which route a dispatch may
select:

- the lane takes its route from the dispatched request, not from
  `REVIEW_ROUTE_MODE`, so a `copilot`-mode consumer can still be dispatched
  `--remote cheap`;
- `independent-review-floor` is a `workflow_dispatch` input any operator can
  lower, so the `copilot` floor that currently masks the gap is a default, not
  a guarantee.

Conditional provisioning would leave both holes open and add a mode-dependent
migration for no benefit.

Provisioning a descriptor is not provisioning a credential. The PR-Agent step
still binds `PR_AGENT_MODEL_API_KEY` inside a provider guard that falls through
to `''`. A `copilot`/`none` consumer gains a descriptor it does not exercise
and still installs with no secret.

## The `REVIEW_ROUTE_MODE` finding is split, not folded in

That the durable lane ignores the repository's managed route policy is a real
defect, but fixing it changes *which routes a consumer may be dispatched to* —
a contract change touching the lane, the pack's `--remote` handling, and the
meaning of a schema-4 field. This task changes what is provisioned, not what is
permitted.

Folding them together would also make the acceptance criteria untestable
independently: "the lane routes cheap successfully" and "the lane refuses to
route cheap under copilot mode" are contradictory tests unless the two changes
are separated in time.

Recorded as a follow-up task to be created, not silently dropped.

## Schema 4 → 5 and migration

The managed variable set is deliberately version-scoped —
`configVariablesForSchema` exists so that a manifest written before a variable
joined still decodes. Two names joining is the same event as
`REVIEW_ROUTE_MODE` joining at 4, and gets the same treatment:

- `ROUTE_MODE_MIN_SCHEMA_VERSION` gains a sibling, `BACKEND_MIN_SCHEMA_VERSION = 5`.
- `configVariablesForSchema(v)` returns the six-name set at `v >= 5`, the
  five-name set at `4`, and the legacy three below that.
- Gate on the version each requirement was introduced at, never on equality
  with `MANIFEST_SCHEMA_VERSION`. The existing comment says why: equality
  narrows an existing tier instead of adding one.
- `update` rewrites a schema 1–4 manifest to 5 and provisions the variables.

## Adoption of hand-set variables — narrower than expected

Verified during step 0. `sd-github-review` itself has **only** the four managed
variables:

```
$ gh api repos/platypeeps/sd-github-review/actions/variables --jq '.variables[].name'
CHEAP_REVIEW_MODEL
DEEP_REVIEW_MODEL
PR_AGENT_MODEL_PROVIDER
REVIEW_ROUTE_MODE
```

So the only repository with hand-set backend variables is
`sd-github-review-pilot`, which is **not one of the nine fleet consumers**.
Every rollout target — `sd-github-review` included, at manifest schema 4 with
its durable workflow already installed — needs plain provisioning, not
adoption.

That removes the conflict case from the fleet path entirely. `update` writes
the synthesized value; nothing in the fleet has a competing value to overwrite.

The pilot is still worth handling correctly, because its hand-set values are
already mutually drifted: its manifest records
`cheapModel: openrouter/moonshotai/kimi-k2.6` while `CHEAP_REVIEW_MODEL` holds
`openrouter/qwen/qwen3-coder-30b-a3b-instruct` and
`SD_REVIEW_CHEAP_BACKEND_V1` embeds a third value. `check` should report that
drift rather than silently correcting it. But this is a pilot-hygiene concern,
not a rollout risk.

## Descriptor shape

Must satisfy `decodeBackend` and be `kind: external`. Non-`check` finding
channels require non-empty `reviewAuthors`. The working shape is the one the
pilot already runs:

```json
{
  "id": "pr-agent",
  "label": "PR-Agent",
  "kind": "external",
  "model": "<provider>/<model>",
  "costTier": "low",
  "qualityTier": "standard",
  "capabilities": ["review", "conversation-comments"],
  "reviewAuthors": ["github-actions[bot]"],
  "checkNames": [],
  "findingChannels": ["conversation-comment"],
  "supportsRerequest": true,
  "limitations": ["Inline comments depend on adapter configuration"]
}
```

Cheap and deep differ in `model`, `costTier` (`low` / `medium`), and
`qualityTier` (`standard` / `advanced`).

`reviewAuthors: ["github-actions[bot]"]` is load-bearing and must be verified
against what the PR-Agent step actually posts as, not assumed — a wrong value
here silently breaks finding attribution rather than failing.

## Rollout and rollback

Ships in the source repository only; no consumer is touched until
`08-08-fleet-rollout-smoke` runs. Rollback is reverting the commit while no
consumer state exists; once consumers are installed it becomes an `update` from
a reverted version.

This does **not** gate canary 1. The review floor keeps pack-dispatched reviews
on the `copilot` route, so the rollout succeeds either way. Landing it first is
preferable — it avoids installing nine consumers and immediately updating them —
but it is a sequencing preference, not a blocker, and it must not be presented
as one.

## Compatibility

`install` and `update` gain two variables. `check` gains two drift conditions
and will newly report existing hand-configured repositories as drifted, which
is correct and should be surfaced in the change notes rather than suppressed.
