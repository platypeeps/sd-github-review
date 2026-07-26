# Cheap Review Provider Failover Design

## Overview

Treat provider endpoint failover and model fallback as different mechanisms.
The consumer's selected named candidate chain is the only authority that may select a
different model, and it does so before dispatch and budget authorization.
OpenRouter or another provider router may try a different compliant endpoint
only while serving the exact same candidate model.

PR-Agent and LiteLLM therefore run with internal cross-model fallback disabled:

```text
CONFIG__FALLBACK_MODELS=[]
```

## Delivery Decomposition

| Child task | Delivery boundary |
| --- | --- |
| `07-25-qualify-cheap-review-candidates` | Per-candidate runtime, policy, provenance, and cost-control qualification |
| `07-25-enforce-same-model-provider-failover` | Empty cross-model fallback and compliant endpoint routing enforcement |
| `07-25-evaluate-cheap-provider-failover-pilot` | Lightweight operational observation and advisory recommendation |

## Boundary

```text
selected named candidate chain          provider endpoint routing
------------------------------          -------------------------
selects model before dispatch           selects endpoint after model selection
owns candidate budget/policy            may only narrow candidate policy
records chain position                  records actual provider when available
may continue after proven no-dispatch   never changes model
```

`sd-github-review` validates candidate and acknowledgment provenance. The
pinned private catalog owns the candidate's provider-policy and credential
bindings. The consumer PR-Agent adapter receives the authorized compiled safe
projection and uses the secret-scoped reviewer credential; it does not invent
policy. The provider router owns endpoint selection. The private control plane
owns authoritative budget and provider observations.

## Failover Policy Contract

A candidate may enable same-model provider failover only with a referenced
policy that defines:

- exact declared model target;
- maximum input/output price and currency/unit;
- approved data retention, region, and provider constraints;
- required request-parameter support;
- eligible endpoint failure classes and retry bounds;
- observation freshness and provider-attribution expectations; and
- the behavior when compliance or actual-model provenance cannot be proved.

The policy may remove endpoints or disable failover. It cannot widen the lane's
price/data policy or substitute a different model.

## Dispatch And Acknowledgment Flow

1. The named chain selects and reserves one immutable candidate.
2. The adapter receives that candidate's exact model and provider-policy
   reference; it receives no later-chain candidates.
3. PR-Agent invokes the model with `CONFIG__FALLBACK_MODELS=[]`.
4. The provider router may retry only compliant endpoints serving that model.
5. The adapter returns configured model, actual model, actual provider when
   available, retry/failover count, bounded policy evidence, and outcome.
6. `sd-github-review` validates actual model against the authorized target.

If the actual model differs or is unavailable when provenance is mandatory,
the child becomes `policy_violation` or fails closed. Because a review may have
started, the router does not authorize the next candidate. Reconciliation owns
the uncertain side effect.

## Failure Classification

| Failure | Same-model endpoint failover | Next candidate |
| --- | --- | --- |
| Endpoint timeout/unavailable before response | Allowed when policy permits | Only after the complete candidate dispatch is proven not to have started |
| Provider capacity/rate limit | Allowed when policy permits | Only through the named-chain authority after an unambiguous no-dispatch result |
| Authentication/authorization | No | No silent continuation; fix configuration |
| Invalid request/unsupported parameter | No | No silent continuation; fix candidate capability/policy |
| Prepared input exceeds hard limit | No implicit truncation or model switch | Automatic routing may advance only within the cheap named chain before reservation; an explicit candidate blocks |
| Output ends at token limit | No | No; record `incomplete_token_limit`, reconcile usage, report unsatisfied assurance, and block the gate |
| Soft reservation overrun | No | No; reconcile full actual usage and preserve content outcome independently |
| Hard token/cost violation | No | No; record policy violation, quarantine candidate, and block an overdrawn pool |
| Moderation/data-policy rejection | No weaker endpoint or model | Fail visibly |
| Actual-model mismatch | Policy violation | No; reconcile possible side effect |
| Ambiguous provider outcome | Stop and reconcile | No |

## Candidate Qualification

Every model that might run is a named lane candidate and is qualified
independently for PR-Agent compatibility, price/data policy, token/reasoning
capabilities, usage attribution, and availability. A Mistral, Kimi, Qwen, or
other model appearing later in the cheap chain is not passed to PR-Agent as a
fallback list.

The observation pilot compares primary-only and compliant same-model provider
routing over a documented window when useful. It records success,
eligible/ineligible error classes, latency, failover use, actual-provider
coverage, and cost without source or prompt data. Version 1 treats this as
advisory evidence rather than a formal approval gate. Maintainers may adjust
endpoint policy or chain membership through a normal reviewed repository
change, but the report can never enable runtime cross-model fallback or mutate
active policy automatically.

## Compatibility And Rollback

- Existing workflows already using an empty fallback list remain compatible.
- Installer update/check verifies that managed workflows retain the empty list;
  a nonempty list is visible drift and cannot be silently preserved as policy-
  compliant.
- Rollback disables candidate provider routing or removes the candidate from the
  ordered chain. The empty cross-model fallback list remains unchanged.
- Historical receipts retain actual provider/model evidence and are not
  rewritten after policy changes.

## Security And Privacy

- Provider preferences and credentials remain inside the adapter step.
- Receipts contain only bounded policy digests, configured/actual model aliases,
  provider identity when available, retry counts, outcome, and limitations.
- Raw provider routing metadata, prompts, diffs, source, findings, and
  credentials are excluded.
- Pull-request-controlled input cannot alter endpoint policy or fallback lists.

## Validation

- Generated workflow and installer lifecycle preserve
  `CONFIG__FALLBACK_MODELS=[]`.
- Provider fixtures cover same-model failover within policy and rejection when
  price, data, region, or parameter requirements are not met.
- Actual-model mismatch, missing mandatory provenance, and ambiguous outcome
  stop the chain and cannot duplicate a review.
- Pilot/report fixtures use bounded evidence and deterministic windows.
