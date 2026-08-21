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

Each local-attested route carries its trust policy inline; there is no
top-level policy map and no named policy reference:

```yaml
version: 2
mode: standalone

routes:
  cheap:
    execution: local-attested
    attestation:
      trustPolicyRef: workstation-review
      allowedAssociations: [OWNER, MEMBER, COLLABORATOR]
      allowPrAuthor: true
      maxAgeSeconds: 86400
  deep:
    execution: local-attested
    attestation:
      trustPolicyRef: workstation-review
      allowedAssociations: [OWNER, MEMBER, COLLABORATOR]
      allowPrAuthor: true
      maxAgeSeconds: 86400
```

`trustPolicyRef` names the policy for audit and diagnostics; it does not
dereference a stored definition. This all-local example intentionally omits the
direct `copilot` route. A mixed consumer may add an explicit direct-handler
route, but a repository that wants zero GitHub-side reviewers leaves every
direct reviewer route disabled.

Every route is a strict discriminated union, decoded by `decodeStandaloneRoute`
in `src/protocol-v2.js`. `direct-handler` requires a setup-discovered profile
and forbids `trustPolicyRef`, `attestation`, and `slot`. `local-attested`
requires an `attestation` policy and forbids `handler`, `provider`,
`promptProfile`, and `slot`. Trust fields are required and have no contextual
defaults. `src/routed-review-compiler.js` freezes the decoded policy onto the
compiled route.

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
- local receipt, content, and configuration digests;
- the raw review result `clean|findings|error` and its production timestamp;
- the evidence digest binding the normalized local result; and
- optional bounded tokens and cost tier marked `self_reported_local`.

`decodeLocalAttestationRequest` in `src/protocol-v2.js` is the shipped shape and
is narrower than the bullets the PRD asks for: it carries no review tool,
profile, or version identifier, no finding/disposition counts, no start/finish
pair, and no stable reason code. Reconciling that gap — widening the envelope or
narrowing the PRD — is a prerequisite for both children, since both consume this
decoder. A cancelled local run reports `error`; there is no separate
`cancelled` result. The publisher-facing `awaiting` state is never reported by
the publisher, only derived by the ingestion boundary.

It excludes paths, source, patches, prompts, raw findings, transcripts,
credentials, configuration values, and local artifact paths. The workflow adds
the authenticated GitHub actor, association, workflow/run identity, received
time, policy/configuration digest, and authorization decision.

Authorization proves an allowed actor intentionally published a result for the
exact head. It does not prove the local executable was untampered, the declared
model ran, or the review was correct. Receipts expose
`trustLevel=repository_attested`; they never use `independent`.

## Outcomes

Review states are the four `LOCAL_REVIEW_OUTCOME_STATES`; assurance and gate
states are the shipped `ASSURANCE_OUTCOME_STATES` and `GATE_OUTCOME_STATES`.

| Local evidence | Review outcome | Assurance | Gate |
| --- | --- | --- | --- |
| Authorized, exact-head, timely `clean` | `completed_local` | `pass` | `pass` |
| Authorized `findings` | `completed_local_findings` | `fail` | `block` |
| Terminal `error` (failure or cancellation) | `failed_local` | `fail` | `block` |
| Not yet submitted | `awaiting_local_attestation` | `deferred` | `block` |
| Wrong/stale head | old attempt retained; new head awaits evidence | `deferred` | `block` |
| Unauthorized, malformed, expired, oversized, or conflicting | `failed_local` | `fail` | `block` |
| `review:none` | `skipped` with reason `review_none` | never `pass` | `block` |

`decodeReviewOutcomes` in `src/protocol-v2.js` already enforces the load-bearing half
of this table: it rejects a passing assurance under any of the three blocking
local states, rejects a passing assurance when the review reason is
`review_none`, and forces the gate to block on any non-budget failure. Both
children should route their outcomes through that decoder rather than asserting
the invariants separately.

The `deferred` assurance state carries one caveat the decoder makes explicit:
`deferred` is only legal with reason `budget_exhausted_deferred`, which
local-attested execution never uses. The awaiting and stale-head rows therefore
need either a local deferral reason admitted into that guard or a mapping onto
`fail`; this is an open contract question, not a settled one. Either way,
local-attested execution cannot receive a budget-exhaustion merge pass.

## Idempotency And Head Changes

The shared evidence binding covers repository, PR, head, lane, attempt,
configuration digest, local receipt digest, content digest, and evidence
digest. `decodeLocalReviewAuthorization` derives an `attemptToken` over that
binding plus the attestation digest, trust level, policy digest, and
authenticated publication context; `authorizeProjectionWrite` consumes the same
token as its compare-and-swap key. Matching replays return the existing
immutable receipt. A conflicting fingerprint fails without changing Checks.

The runtime re-reads the live PR head before receipt creation and before Check
projection. A changed head preserves the prior receipt as historical evidence,
supersedes its projection, and creates an awaiting-local-attestation projection
for the new head. Late old-head submissions cannot update the new head.

## GitHub Projection

The `sd-review / assurance` and `sd-review / gate` names, the projection codec,
and the compare-and-swap authorizer are declared in `src/protocol-v2.js`, but
nothing in `src/` writes either Check yet. The only Check the shipped runtime
publishes is the v1 receipt Check `sd-github-review/receipt` from
`src/receipt.js`, which carries none of the v2 trust, outcome-class, or attempt
fields. Delivering these two Checks is net-new work, not a reuse of an existing
writer.

Their intended meanings:

- `sd-review / assurance` reports whether the exact head has a policy-valid
  local attestation. Awaiting evidence is `action_required`, not success.
- `sd-review / gate` is the only required Check. It succeeds only for a valid
  clean attestation and fails for every other local-attested state.

The Check title states `Local review attested by <actor>` and the output names
the repository-trusted limitation. It does not say “GitHub review passed” or
“independent review completed.”

## Rollout And Rollback

The consumer installer manages route mode at manifest schema 4 through the
`REVIEW_ROUTE_MODE` variable, whose accepted values are `auto`, `cheap`,
`deep`, `copilot`, and `none`. None of them selects local-attested execution,
and the manifest models no attestation policy — so installer support is net-new
and depends on first deciding whether local-attested is a route mode or, per the
source shape above, a per-lane execution kind orthogonal to route mode.

Once that is settled: installation scaffolds local-attested routes only after an
explicit operator choice and writes the full trust policy. Existing routes remain
unchanged. Readiness validates workflow permissions, accepted actor policy,
stable Check publication, and branch protection. Rollback restores the prior
explicit direct-handler configuration; it never infers local evidence from
historical local receipts, and in particular never promotes the v1 routing
`localEvidence` signal in `src/router.js` into a v2 attestation.
