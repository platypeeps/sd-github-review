# Ordered Budget-Aware Review Chains Design

## Overview

Introduce a versioned, provider-neutral planning contract that selects exactly
one funded candidate from an explicit named chain in a logical `cheap` or
`deep` lane. The public Action
owns deterministic planning, validation, receipt correlation, and GitHub
status. A consumer-operated private control plane owns every authoritative
budget mutation and provider/billing credential. The command pack owns the
human-facing status and recovery commands.

The selected named candidate chain is the sole cross-model fallback mechanism. An
adapter may fail over between compliant endpoints serving the same model, but
it may not substitute a different model after dispatch.

## Design Goals And Invariants

- Preserve `cheap` and `deep` as logical policy lanes independently of the
  selected handler, provider, or model.
- Select at most one candidate for a non-parallel review attempt.
- Reserve enough authoritative capacity before any reviewer side effect.
- Never continue after a dispatch may have started.
- Keep provider, management, and reviewer credentials out of public config,
  Action inputs/outputs, receipts, summaries, and command output.
- Make every decision reproducible from an exact head, configuration digest,
  request identity, bounded control-plane response, and receipt.
- Keep Kimi, Qwen, Copilot, PR-Agent, and OpenRouter as replaceable consumer
  choices rather than protocol constants.

## MVP Evaluation Governance

Version 1 intentionally has no separate formal pilot-approval process. Pilot
and comparative evidence is advisory: the MVP does not require a fixed sample
size, observation window, decision threshold, named pilot approver, signed
decision record, or decision expiry before maintainers change a prompt,
candidate, or same-model provider policy.

Those changes use the repository's normal reviewed configuration or code-change
workflow. This simplification does not weaken hard runtime qualification,
budget, provenance, data, region, credential, or security-policy enforcement,
and reports must never mutate active policy automatically. Formal evaluation
governance can be reconsidered after the contracts and operating experience
stabilize; it is not an MVP dependency.

## Component Ownership

| Component | Child task | Owns | Must not own |
| --- | --- | --- | --- |
| Consumer repository lifecycle | `07-25-deliver-routed-review-configuration` | One human source file with pinned catalog reference, named chains, reviewer slots, assurance policy, explicit budget-exhaustion merge policy, migration, and managed promotion | Provider/model parameters, credential bindings, authoritative balances, shared ledger state |
| `sd-github-review` engine | `07-25-compile-and-execute-budget-aware-review-plans` | Human/compiled schemas, deterministic compiler/normalizer, manifest digest, candidate semantics, control-plane exchange, dispatch authorization, receipts, checks, setup discovery | Provider billing integrations, central durable ledger, management credentials |
| Consumer private control plane | `07-25-define-consumer-review-control-plane` | Pinned versioned candidate catalog, prompt-profile identities/digests and candidate bindings, provider/model/credential/policy bindings, provider/billing adapters, authoritative observations, shared-pool accounting, reservations, reconciliation, deferred records, retention and access policy | Prompt-profile bodies, rendered prompts, diffs, findings, GitHub review publication |
| Consumer workflow adapter | `07-25-integrate-authorized-review-adapters` | Secret-scoped control-plane/reviewer calls, private prompt-profile registry values, exact profile resolution/application, and bounded acknowledgment | Candidate or profile selection outside the published contract, durable policy state |
| `sd-ai-command-pack` | `platypeeps/sd-ai-command-pack:07-25-add-routed-review-operator-ux` | `sd-review config` and `sd-review budget` UX over published contracts | Schema/compiler authority, ledger authority, provider credentials, implicit recovery or configuration mutation |

The control-plane implementation may be repository-specific or shared across
an organization. Its deployment technology is intentionally outside this
repository. Conformance is defined by the versioned exchange below.

## Architecture And Data Flow

```text
trusted command / PR event
          |
          v
sd-github-review prepare
  validate exact head + lane + candidate config
  derive request/configuration fingerprints
  run side-effect-free candidate request preflight
  bind input/output/cost limits + prepared-request fingerprint
          |
          | bounded preflight + reservation request; no content or secrets
          v
consumer management step ---- management credential ----> private control plane
          |                                                  |
          | bounded authorization / deferral                 +--> provider billing APIs
          |                                                  +--> reservation ledger
          v                                                  +--> deferred-review store
sd-github-review authorize
  validate response + persist durable receipt
          |
          +--> native Copilot request
          |
          +--> external adapter request ---- reviewer credential ----> provider
                                                      |
                                                      v
                                      acknowledgment + usage reference
          |
          v
private control-plane reconciliation -> sd-github-review finalize -> GitHub receipt/check

command-pack operator UX -> published config/status contracts -> control plane + receipts
```

The Action never needs a provider-management token. A trusted workflow step
holding that credential calls the private service and passes only its bounded
response back to the Action. The response is bound to the exact request and
configuration fingerprint so it cannot be reused for a different PR, head,
lane, attempt, or candidate set.

## Human Source Configuration

The consumer edits only `.github/sd-review.yml`. Managed mode contains a pinned catalog
reference plus review intent: named chains, slots, completion policy, and
explicit budget-exhaustion merge policy. Provider/model settings, credential bindings, budget APIs,
prompt-profile bindings, reasoning parameters, and secrets stay outside the
human source. The private catalog owns profile identity and candidate binding;
the private adapter owns actual prompt/configuration values in a registry keyed
by the same identity.

```yaml
version: 2
mode: managed

catalog:
  name: organization-reviewers
  version: 3
  digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

chains:
  cheap-primary:
    - qwen-cheap
    - cheap-secondary
  deep-primary:
    - copilot-deep
    - kimi-deep
    - deep-secondary
  deep-independent:
    - kimi-deep
    - deep-secondary

reviewers:
  cheap:
    minimum-successes: 1
    slots:
      - id: primary-review
        chain: cheap-primary
        required: true
        overridable: true
        timeout: 15m
  deep:
    minimum-successes: 1
    slots:
      - id: primary-review
        chain: deep-primary
        required: true
        overridable: true
        timeout: 30m

budgetExhaustion:
  cheap:
    merge: block
  deep:
    merge: allow
```

Consumers without a private service use a separate explicit standalone shape:

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
    execution: direct-handler
    profile: pr-agent-deep
  copilot:
    execution: direct-handler
    profile: copilot-direct
```

Standalone route execution is a strict `direct-handler|local-attested` union.
Local-attested execution consumes a repository-trusted exact-head result from
the local `sd-review` lifecycle and performs no GitHub-side reviewer dispatch.
It is not a third mode, an outage fallback, or an alias for `review:none`.
Trust policy has no implicit default, and a valid receipt says
`repository_attested`, never `independent`. The initial managed/parallel
contract does not accept local-attested child slots.

Standalone profiles are setup-discovered direct adapter identities, not
portable candidates. They preserve basic routing but provide no candidate
chains, shared budgets, authoritative cost reporting, deferral/recovery,
quarantine, centralized policy, parallel review, adjudication, or private data
operations. Missing managed capabilities are reported as unsupported, never as
zero-valued authoritative state.

There are no imports, inheritance, runtime presets, or inferred slots. An
installer preset is allowed only as scaffolding that writes this complete
explicit file.

## Candidate Override And Discovery UX

Candidate selection uses trusted, exact issue-comment commands only. Broad
route labels remain limited to `review:cheap`, `review:deep`, `review:copilot`,
and `review:none`; they express persistent lane policy and never encode a
candidate or slot. An exact trusted command takes precedence over those broad
labels for the new attempt it creates.

```text
/review cheap --candidate <candidate-id>
/review deep --candidate <candidate-id>
/review <lane> --slot <slot-id> --candidate <candidate-id>

/review options
/review options <lane>
/review options <lane> --slot <slot-id>
```

The candidate-only shorthand is accepted only when exactly one slot is
overridable. Candidate and slot IDs are strict stable aliases from the pinned
catalog and compiled configuration; there is no fuzzy matching. Invalid input
returns a bounded list of valid safe IDs. An explicit candidate that is
unavailable or unfunded never falls through to another candidate.

`/review options` is authorized by the same trusted-comment policy but is
read-only: it creates no attempt, reservation, receipt, or reviewer dispatch.
Its deterministic response may include safe alias/display name, eligible
lane/slots, handler, cost tier, availability state and reason, plus the exact
catalog/configuration digest. It excludes credentials, provider-management
details, private policy, and raw balance values.

The v2 schema does not contain `overrides.labels`. Labels beginning with
`review-candidate:` or `review-slot:` are unsupported reserved controls and
fail visibly if presented to routing. The installer never provisions,
migrates, reconciles, or deletes them.

## Canonical Compiled Contract

The deterministic compiler resolves the exact catalog version into safe
candidate records and writes canonical JSON plus its digest into the existing
managed `.github/sd-github-review.json` installer manifest. The runtime consumes
only this compiled representation.

```json
{
  "schemaVersion": 2,
  "source": {
    "path": ".github/sd-review.yml",
    "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  },
  "catalog": {
    "name": "organization-reviewers",
    "version": 3,
    "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  },
  "lanes": {
    "cheap": {
      "budgetExhaustion": { "merge": "block" },
      "primaryChain": "cheap-primary"
    },
    "deep": {
      "budgetExhaustion": { "merge": "allow" },
      "primaryChain": "deep-primary"
    }
  },
  "candidateChains": {
    "cheap-primary": {
      "lane": "cheap",
      "candidates": ["qwen-cheap", "cheap-secondary"]
    },
    "deep-primary": {
      "lane": "deep",
      "candidates": ["copilot-deep", "kimi-deep", "deep-secondary"]
    },
    "deep-independent": {
      "lane": "deep",
      "candidates": ["kimi-deep", "deep-secondary"]
    }
  },
  "reviewers": {
    "cheap": {
      "minimumSuccesses": 1,
      "slots": [
        {
          "id": "primary-review",
          "selector": { "chain": "cheap-primary" },
          "overridable": true,
          "required": true,
          "timeoutSeconds": 900
        }
      ]
    },
    "deep": {
      "minimumSuccesses": 1,
      "slots": [
        {
          "id": "primary-review",
          "selector": { "chain": "deep-primary" },
          "overridable": true,
          "required": true,
          "timeoutSeconds": 1800
        }
      ]
    }
  },
  "promptProfiles": {
    "qwen-routine-v1": {
      "handler": "pr-agent",
      "version": 1,
      "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    },
    "secondary-routine-v1": {
      "handler": "pr-agent",
      "version": 1,
      "digest": "sha256:4444444444444444444444444444444444444444444444444444444444444444"
    },
    "deep-full-v1": {
      "handler": "pr-agent",
      "version": 1,
      "digest": "sha256:5555555555555555555555555555555555555555555555555555555555555555"
    }
  },
  "candidates": {
    "qwen-cheap": {
      "handler": "pr-agent",
      "target": {
        "kind": "model",
        "provider": "openrouter",
        "model": "consumer-selected-qwen-alias"
      },
      "credentialRef": "pr-agent-openrouter",
      "budgetRef": "openrouter-cheap-pool",
      "reserveRef": "cheap-external",
      "policyRef": "cheap-external",
      "promptProfile": {
        "mode": "referenced",
        "ref": "qwen-routine-v1",
        "version": 1,
        "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
      }
    },
    "cheap-secondary": {
      "handler": "pr-agent",
      "target": {
        "kind": "model",
        "provider": "consumer-provider",
        "model": "consumer-selected-cheap-secondary"
      },
      "credentialRef": "cheap-secondary-provider",
      "budgetRef": "cheap-secondary-pool",
      "reserveRef": "cheap-external",
      "policyRef": "cheap-external",
      "promptProfile": {
        "mode": "referenced",
        "ref": "secondary-routine-v1",
        "version": 1,
        "digest": "sha256:4444444444444444444444444444444444444444444444444444444444444444"
      }
    },
    "copilot-deep": {
      "handler": "copilot",
      "target": { "kind": "native" },
      "budgetRef": "copilot-review-pool",
      "reserveRef": "deep-native",
      "promptProfile": { "mode": "handler-managed" }
    },
    "kimi-deep": {
      "handler": "pr-agent",
      "target": {
        "kind": "model",
        "provider": "openrouter",
        "model": "consumer-selected-kimi-alias"
      },
      "credentialRef": "pr-agent-openrouter",
      "budgetRef": "openrouter-paid-pool",
      "reserveRef": "deep-external",
      "policyRef": "deep-external",
      "promptProfile": {
        "mode": "referenced",
        "ref": "deep-full-v1",
        "version": 1,
        "digest": "sha256:5555555555555555555555555555555555555555555555555555555555555555"
      }
    },
    "deep-secondary": {
      "handler": "pr-agent",
      "target": {
        "kind": "model",
        "provider": "consumer-provider",
        "model": "consumer-selected-deep-secondary"
      },
      "credentialRef": "deep-secondary-provider",
      "budgetRef": "deep-secondary-pool",
      "reserveRef": "deep-external",
      "policyRef": "deep-external",
      "promptProfile": {
        "mode": "referenced",
        "ref": "deep-full-v1",
        "version": 1,
        "digest": "sha256:5555555555555555555555555555555555555555555555555555555555555555"
      }
    }
  }
}
```

In managed mode, the compiler validates source/catalog/chain/slot referential
integrity, lane membership, unique chain/candidate/profile IDs, prompt-profile
references and digests, primary-chain references, one explicit primary slot
per lane, alias syntax, supported handler capabilities, policy compatibility,
and the presence of a declared control-plane integration. It cannot prove that
a credential is valid, that a provider balance is current, or that private
profile values match their digest; the adapter proves the last property before
dispatch. Expanded catalog fields in the managed manifest are a generated,
digest-bound safe projection; they do not become human-owned repository
configuration.

## Candidate Prompt Profiles

Managed prompt profiles are named immutable registry entries. The private
catalog stores alias, version, digest, handler compatibility, capability facts,
and candidate bindings. The safe compiled projection contains only the alias,
version, digest, and non-secret compatibility facts. Actual prompt
templates and PR-Agent configuration values remain in the private adapter
registry and never enter source, compiled output, receipts, options, or logs.

Every external PR-Agent candidate has exactly one `referenced` binding. Several
compatible candidates may reference the same entry; a candidate that needs
different instructions or output controls receives a different entry. Native
Copilot uses `handler-managed` because this system cannot apply a PR-Agent
profile to that handler. Version 2 defines no lane default, inheritance,
profile merge, runtime preset, fallback profile, or user-selectable profile
override.

Qualification covers the candidate target, adapter/runtime digest, prompt-
profile digest, and applicable policy digests as one tuple. Authorization binds
that tuple to the prepared request. Before reservation, the private adapter
resolves the same alias/version/digest in its registry, verifies the actual
profile digest, applies it before request fingerprinting, and acknowledges the
applied identity. An explicit
candidate request still uses this binding and cannot choose a profile.

Standalone handler profiles are separate setup-discovered adapter identities;
they do not participate in the managed prompt-profile registry.

In standalone mode, the compiler validates one setup-discovered fixed profile
for each direct-handler lane or one explicit local-attestation policy for each
local-attested lane. It rejects mixed execution fields plus catalog, chain,
candidate, budget, parallel-slot, and managed-policy fields. Mode and execution
kind are required and never inferred.

Compilation is deterministic:

Managed compilation performs these catalog steps:

1. Parse the one source file with field-specific errors and reject unknown
   composition features such as imports, inheritance, or runtime presets.
2. Resolve the exact catalog name/version/digest through the credential-scoped
   private management step. Missing, stale, changed, or unavailable catalog
   data fails closed.
3. Validate every chain, slot, candidate, prompt profile, lane, policy, and
   capability reference before producing output.
4. Expand safe catalog records, normalize ordering and duration/unit syntax,
   and compute the canonical source, catalog, and compiled-contract digests.
5. Show a dry-run semantic diff, then write the compiled snapshot through the
   existing pending/active installer-manifest lifecycle.

The runtime accepts only an active compiled snapshot whose source and output
digests match the manifest, plus the catalog digest in managed mode. Presets are
installer-only generators that write a complete source file; the preset name is
not stored as dispatch policy.

## Control-Plane Exchange

The transport is consumer-owned, but these semantic operations are versioned
and canonical:

| Operation | Purpose |
| --- | --- |
| `observe` | Return fresh bounded availability and budget state without mutation |
| `reserve` | Atomically select and reserve the first eligible candidate, or return a terminal exhaustion decision |
| `reconcile` | Commit authoritative usage and release unused reserve after a known outcome |
| `release` | Release a reservation only when dispatch is proven not to have started |
| `defer` | Persist a bounded pending-review record linked to an exhausted attempt |
| `recover` | Authorize a distinct re-review attempt for an eligible deferred record |

Every request contains only repository identity, PR number, exact head,
logical attempt identity, lane, named chain ID, configuration digest, ordered
candidate IDs, prompt-profile alias/version/digest, budget/policy references,
required reserves, freshness bounds, and an optional slot-targeted explicit
candidate. It contains no source, diff, prompt body, finding, or secret.

Every response includes:

- request and configuration fingerprints;
- selected lane and named chain ID;
- observation time and freshness deadline;
- state and reason for every considered candidate;
- selected candidate or exhaustion decision;
- reservation ID, pool ID, amount/unit, lease expiry, and safety margin when
  selected;
- predecessor skip reasons;
- authorization identity and integrity evidence; and
- limitations such as unavailable provider attribution.

The Action rejects stale, mismatched, duplicate, malformed, or unsupported
responses. `unknown` is never normalized to `available`.

## Reservation Lifecycle

```text
requested
   |
   +--> rejected / exhausted / unknown
   |
   v
reserved ---- proven-no-dispatch ----> released
   |
   +---- lease expiry before authorization ----> expired
   |
   v
authorized ---- known usage ----> reconciled
   |
   +---- uncertain dispatch ----> reconciliation_required
```

- Reservation identity is idempotent for one logical attempt and configuration
  fingerprint.
- Leases have bounded expiry. Expiry cannot authorize fallback after a side
  effect may have started.
- Reconciliation records authoritative usage when available and explicit
  `unknown` or delayed attribution otherwise; missing usage is never zero.
- Shared pools are reserved atomically inside the private ledger. Provider
  billing systems are observations, not transaction locks.
- Full authoritative actual usage is debited even above reserve. Usage above
  reserve but within hard request limits is a soft `budget_overrun`; it may
  coexist with a completed review and influences future safety margins.
- Usage beyond a hard input/output/cost limit is `policy_violation`, cannot
  satisfy assurance, and quarantines the candidate. A negative pool becomes
  `overdrawn` and blocks future reservations. Neither outcome authorizes
  fallback after dispatch.

## Candidate Selection And Fallback

1. Validate the exact PR head, lane, named chain, authorization, and immutable
   configuration.
2. For an explicit candidate, require membership in the target slot's named
   chain, validate only that candidate, and never fall through to another one.
3. For automatic selection, submit that named chain's ordered eligible aliases
   to one control-plane `reserve` operation.
4. The control plane evaluates enabled state, credential declaration, policy,
   freshness, availability, usable budget, reserve, and shared pools in order.
5. Validate that the response selected the first eligible candidate and persist
   the authorization before allowing any reviewer side effect.
6. Continue to another candidate only when the prior candidate was rejected
   before authorization or a later failure proves that no review started and
   the reservation was released.
7. Once dispatch is possible, any timeout, model mismatch, or ambiguous result
   enters reconciliation and stops the chain.

The adapter receives one immutable candidate target. PR-Agent examples and
managed workflows keep `CONFIG__FALLBACK_MODELS=[]`. Same-model provider
endpoint failover is allowed only when the provider confirms the same model
target and the endpoint remains within the candidate's policy. A different
actual model is `policy_violation`, not fallback success.

## Protocol And Receipt Shape

This work introduces contract major 2 because `deep` may execute through a
native backend and because named-chain/candidate/budget provenance changes
dispatch semantics. Version 2 is a deliberate runtime cutover rather than an
indefinite dual-protocol mode.

A version-2 receipt adds, at minimum:

- `selectedLane` independently of requested legacy route;
- named chain ID, candidate ID, chain position, handler, declared target,
  prompt-profile mode and alias/version/digest when referenced, and actual
  target;
- automatic/manual selection source and skipped predecessors;
- configuration and control-plane response digests;
- budget pool/state, bounded reserve, freshness, and reconciliation reference;
- configured input/output/hard-cost limits, bounded preflight counts, finish
  reason, actual usage/cost, variance, overdrawn state, and quarantine state;
- `reviewOutcome`, including `completed`, `failed`, `deferred_budget`,
  `incomplete_token_limit`, `policy_violation`, and
  `reconciliation_required`; `assuranceOutcome`, including `satisfied`,
  `deferred`, and `failed`; `gateOutcome`, including `pass` and `block`, plus a
  stable gate-reason code; an independent `budgetOutcome`, including
  `within_reserve`, `budget_overrun`, `overdrawn`, `unknown`, and
  `policy_violation`; and
- links between a deferred attempt and any later recovery attempt.

The installer performs a one-time migration from legacy cheap/deep model
settings to the explicit human source, pinned catalog reference,
`cheap-primary`/`deep-primary` chains, and primary reviewer slots. It compiles
that source before version 2 becomes active. Once a repository declares
version 2, the runtime rejects legacy/default selectors and uncompiled source;
it does not dual-read or dual-write new requests. Historical version-1 receipts
remain decodable through a read-only audit path; they cannot authorize a new
dispatch. Setup discovery advertises the single active contract major and
budget-control-plane capabilities before a command dispatches.

## Deferred Reviews And Recovery

When no candidate can be reserved because pre-dispatch budget exhaustion is
proven, every attempt records `reviewOutcome=deferred_budget` and
`assuranceOutcome=deferred`. The lane's required
`budgetExhaustion.merge=block|allow` maps only the merge decision to
`gateOutcome=block|pass`, with reason `configured_budget_exhaustion`.

No runtime default exists. Installer scaffolding writes an explicit `block`
value; this repository deliberately configures deep as `allow`. Policy
violations, ambiguous dispatch, incomplete output, authentication failures,
framework failures, and all other non-budget failures block regardless of this
setting.

The private control plane stores the pending record and returns an opaque
record ID for the receipt. Recovery is always a distinct authorized attempt.
It rechecks repository/PR access, open state, exact head, current policy,
budget, and duplicate evidence. A changed head supersedes the old pending
record and requires a new head-bound request. No automatic replay occurs unless
a future repository policy explicitly adds it.

Attempt receipts remain immutable. For the same exact head, a successful
recovery may supersede the head-level Check projection through a deterministic
latest-authorized-attempt rule and compare-and-swap revision. Late results from
older attempts are retained as evidence but cannot overwrite the projection.
A changed head receives new Checks and supersedes the old deferral.

## Assurance And Merge-Gate Checks

The runtime publishes two stable exact-head Checks for both single and parallel
review plans:

- `sd-review / assurance` is the truthful assurance signal. It concludes
  `success` when assurance is satisfied, `action_required` when review is
  deferred, and a failure conclusion for terminal non-assurance. `neutral` is
  reserved for genuinely inapplicable review policy. This Check is not required
  by branch protection.
- `sd-review / gate` is the only branch-protection-required Check. It concludes
  `success` only when the explicit policy permits merge and `failure` for a
  block or system error. A budget-deferred pass is titled
  `Merge allowed; review assurance deferred`, never `review passed`.

Dynamic child Checks are diagnostic only and never branch-protection
requirements. Setup discovery and installer diagnostics verify that only the
gate is required, report a readiness error when the gate is absent, and warn or
fail readiness when assurance is required. They publish the new pair on the
current head before the legacy Check is retired and never mutate repository
rules without explicit authorization.

For a local-attested standalone route, an authorized, timely, exact-head
`clean` attestation records `reviewOutcome=completed_local`, satisfies
assurance, and passes the gate. Findings or any failure block. Missing or
new-head evidence is action-required assurance plus a blocking gate; it never
uses budget deferral. Check output states that the result is repository-
attested and does not claim that GitHub ran or independently verified the local
review.

## Command-Pack Operator UX

`platypeeps/sd-ai-command-pack` task
`07-25-add-routed-review-operator-ux` owns portable `sd-review config` and
`sd-review budget` operations. Its configuration child owns scaffold,
validate, render, explain, diff, and migrate; its budget child owns status,
pending, explain, and explicitly authorized retry.

The commands consume published setup-discovery, compiler, receipt, status, and
recovery contracts. They never receive provider credentials, reimplement the
compiler, or write the ledger directly. This repository's installer/compiler
remains the authoritative low-level interface until and after the portable UX
ships.

## Security, Privacy, And Retention

- Management credentials exist only in the private control-plane workflow step.
- Reviewer credentials exist only in the selected adapter step.
- Public receipts use aliases, digests, bounded numeric state, observation
  times, and opaque control-plane references.
- This repository defines the mandatory versioned `standard-v1` retention
  contract; the private service enforces tenant isolation, authorization,
  audit, class-specific retention/deletion, legal holds, seven-day live purge,
  35-day backup expiry, and repository transfer/removal behavior.
- Deferred records expire visibly after 180 days. Private content prohibited by
  the retention contract is never persisted; bounded reports expose policy
  digest, retained-until state, deletion progress, and coverage gaps.
- Logs redact control-plane responses by default; bounded diagnostic fields are
  explicitly allow-listed.
- Untrusted pull-request content cannot alter candidate config, policy refs,
  control-plane endpoints, credentials, or recovery authorization.

## Compatibility, Rollout, And Rollback

1. Publish version-2 schemas, migration fixtures, and setup discovery.
2. Add a fake in-memory control plane for deterministic tests.
3. Have the installer create explicit primary chains and reviewer slots for new
   consumers and migrate existing consumers in one reviewable update.
4. Cut the migrated workflow to version 2; reject legacy selector/config input
   from that point onward.
5. Run one candidate per primary chain initially with advisory budget
   observation; there is no separate formal pilot-approval gate.
6. Enable reservation/reconciliation, then later candidates and recovery.
7. Enable a lane's `budgetExhaustion.merge: allow` only through an explicit
   reviewed consumer policy and verified branch-protection migration.
8. Keep standalone available for consumers that deliberately do not configure
   the service; never use it as an automatic managed-outage fallback.

Rollback within version 2 restores a prior explicit single-slot/primary-chain
configuration. Emergency protocol rollback pins the last version-1 Action and
workflow rather than requiring the version-2 runtime to understand legacy
dispatch configuration. Outstanding reservations are reconciled or allowed to
expire by the private service; deferred records remain reportable but are not
automatically dispatched. Rollback never enables internal model fallback.

## Important Failure Cases

- Stale/unknown provider state: candidate is ineligible.
- Control-plane timeout before authorization: no dispatch; retry the same
  idempotent attempt or block; do not change to standalone. A timeout is not
  proven budget exhaustion and cannot use merge allowance.
- Authorization persisted but reviewer side effect uncertain: reconcile; do
  not select the next candidate.
- Actual model differs from planned target: policy violation and reconciliation;
  do not accept the review as the planned candidate.
- Usage unavailable after successful review: preserve completed review with
  cost `unknown`; do not fabricate zero usage.
- Prepared input exceeds a candidate hard limit: reject it before reservation;
  automatic selection may continue only within that lane chain, while an
  explicit candidate blocks without fallback.
- Provider finish reason indicates a token/output limit: record
  `incomplete_token_limit`, publish no authoritative partial review, reconcile
  usage, and do not retry or fall back.
- Actual usage exceeds reserve: debit the full actual amount and classify soft
  overrun versus hard policy violation. Block an overdrawn pool; quarantine a
  hard-violating candidate independently.
- Shared-pool race: the private ledger serializes reservation; losing attempts
  receive a fresh exhausted/low response.

## Affected Surfaces

- protocol, receipt, operation, and setup-discovery schemas;
- router/action operation staging and GitHub Check summaries;
- candidate/control-plane fixtures and conformance tests;
- consumer workflow and installer templates;
- PR-Agent adapter acknowledgment and model-provenance validation;
- README, DESIGN, setup, security, recovery, and rollback documentation; and
- the external command-pack operator UX task and its versioned contract
  handoff.
