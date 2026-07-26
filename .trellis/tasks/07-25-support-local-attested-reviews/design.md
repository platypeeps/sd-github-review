# Local-Attested Review Design

## Boundary

Control-plane mode and review execution are separate decisions:

```text
version-2 source
      |
      +-- mode: standalone
      |      +-- execution: direct-handler  -> reviewer -> receipt/checks
      |      +-- execution: local-attested  -> attestation -> receipt/checks
      |
      +-- mode: managed -> authorized candidate plan -> reviewer -> receipt/checks
```

The MVP adds `local-attested` only to standalone routes. This is sufficient for
a repository that wants cheap and deep routing semantics but performs every
substantive review locally. It does not introduce another control plane,
provider catalog, budget authority, or hidden fallback.

`review:none` remains outside this branch: it records that review was skipped
and grants no assurance.

## Source Shape

```yaml
version: 2
mode: standalone

localAttestationPolicies:
  workstation-review:
    allowedAssociations: [OWNER, MEMBER, COLLABORATOR]
    allowPullRequestAuthor: true
    maximumAge: 24h

routes:
  cheap:
    execution: local-attested
    policy: workstation-review
  deep:
    execution: local-attested
    policy: workstation-review
```

This all-local example intentionally omits the direct `copilot` route. A mixed
consumer may add an explicit direct-handler route, but a repository that wants
zero GitHub-side reviewers leaves every direct reviewer route disabled.

Every route is a strict discriminated union. `direct-handler` requires a
setup-discovered profile and forbids an attestation policy. `local-attested`
requires a policy and forbids handler, provider, model, candidate, chain,
budget, and adapter fields. Trust fields are required and have no contextual
defaults.

## Data Flow

```text
local sd-review
  -> exact-scope checks and local provider run
  -> bounded local receipt and evidence digest
  -> authenticated GitHub workflow dispatch
  -> decode + authorize actor/policy + re-read live PR head
  -> create/reuse immutable attempt receipt
  -> project sd-review / assurance and sd-review / gate
```

The GitHub workflow is an ingestion and projection boundary, not a reviewer.
It never checks out the PR, calls a model, requests Copilot, runs PR-Agent, or
publishes review/comments. The consumer workflow supplies its authenticated
GitHub actor and the Action derives repository/workflow context instead of
trusting equivalent caller fields.

## Attestation Contract

The bounded envelope includes:

- schema version, repository, PR, full head, lane, and attempt;
- local invocation/receipt identity and canonical content/configuration
  digests;
- local review tool, profile, and version identifiers;
- `clean|findings|failed|cancelled`, stable reason, finding/disposition counts,
  start/finish time, and evidence digest;
- optional bounded provider/model, tokens, latency, currency, and cost marked
  `self_reported_local`; and
- publisher request correlation for diagnostics.

It excludes paths, source, patches, prompts, raw findings, transcripts,
credentials, configuration values, and local artifact paths. The workflow adds
the authenticated GitHub actor, association, workflow/run identity, received
time, policy/configuration digest, and authorization decision.

Authorization proves an allowed actor intentionally published a result for the
exact head. It does not prove the local executable was untampered, the declared
model ran, or the review was correct. Receipts expose
`trustLevel=repository_attested`; they never use `independent`.

## Outcomes

| Local evidence | Review outcome | Assurance | Gate |
| --- | --- | --- | --- |
| Authorized, exact-head, timely `clean` | `completed_local` | `satisfied` | `pass` |
| Authorized `findings` | `completed_local_findings` | `failed` | `block` |
| `failed` or `cancelled` | matching terminal local outcome | `failed` | `block` |
| Not yet submitted | `awaiting_local_attestation` | `deferred` | `block` |
| Wrong/stale head | old attempt retained; new head awaits evidence | `deferred` | `block` |
| Unauthorized, malformed, expired, oversized, or conflicting | bounded failure | `failed` | `block` |
| `review:none` | `skipped` | not satisfied | policy-neutral or block, never local pass |

Local-attested execution never uses `deferred_budget` and cannot receive a
budget-exhaustion merge pass.

## Idempotency And Head Changes

The canonical attempt identity covers repository, PR, head, lane, attempt, and
compiled configuration digest. The attestation fingerprint additionally covers
all normalized evidence. Matching replays return the existing immutable
receipt. A conflicting fingerprint fails without changing Checks.

The runtime re-reads the live PR head before receipt creation and before Check
projection. A changed head preserves the prior receipt as historical evidence,
supersedes its projection, and creates an awaiting-local-attestation projection
for the new head. Late old-head submissions cannot update the new head.

## GitHub Projection

The existing stable Checks retain their meanings:

- `sd-review / assurance` reports whether the exact head has a policy-valid
  local attestation. Awaiting evidence is `action_required`, not success.
- `sd-review / gate` is the only required Check. It succeeds only for a valid
  clean attestation and fails for every other local-attested state.

The Check title states `Local review attested by <actor>` and the output names
the repository-trusted limitation. It does not say “GitHub review passed” or
“independent review completed.”

## Rollout And Rollback

Installation scaffolds local-attested routes only after an explicit operator
choice and writes the full trust policy. Existing routes remain unchanged.
Readiness validates workflow permissions, accepted actor policy, stable Check
publication, and branch protection. Rollback restores the prior explicit
direct-handler configuration; it never infers local evidence from historical
local receipts.
