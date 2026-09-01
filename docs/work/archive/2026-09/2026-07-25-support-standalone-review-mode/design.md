# Standalone Review Mode Design

## Naming

"Standalone" and "mode" are both already taken by unrelated v1 concepts in the
shipped Action, and this document never means either of them:

- `operation=standalone` (`src/index.js:147`, `src/operations.js:235`) is the v1
  *default operation* — event-driven routing as opposed to the durable
  operations. It is also emitted verbatim as an output value
  (`src/index.js:117`).
- The `mode` action input (`src/index.js:161`, validated at
  `src/normalize.js:17`) is the v1 *route* mode: `cheap|deep|copilot|auto`.

The v2 source mode below is a third, separate thing
(`src/protocol-v2.js:29`). It therefore cannot claim the `mode` input name, and
a `mode=standalone` receipt must not be conflated with the existing
`operation=standalone` output. Pick and record the v2 input name before any
installer or `action.yml` change.

## Boundary

Mode is explicit configuration, not runtime health detection:

```text
version-2 source
      |
      +-- mode: standalone
      |      +-- direct-handler -> fixed lane profile -> adapter -> receipt/check
      |      +-- local-attested -> bounded local evidence -> receipt/check
      |
      +-- mode: managed ----> catalog + authorization -> adapter -> reconciliation
```

The two source shapes are a discriminated union. Standalone compilation does
not fetch a catalog or call a control plane. Managed compilation and dispatch
never read standalone profiles as an outage fallback.

## Standalone Contract

A standalone source names one explicit execution kind for each enabled lane.
`direct-handler` names one setup-discovered adapter installation identity such
as `pr-agent-cheap`, `pr-agent-deep`, or `copilot-direct`; it is not a portable
provider/model candidate. `local-attested` names one explicit repository trust
policy and no handler. Repository variables and secrets owned by a direct
adapter continue to select its runtime configuration.

The compiled contract records source, execution, profile/policy, and output
digests plus enabled lanes and capabilities. A receipt records
`mode=standalone`, the lane, execution kind, handler/profile or authenticated
local-attestation provenance, exact head, outcome, and acknowledged actual
provider/model when reliable. Budget state is `not_managed`, not zero or
available.

For branch-protection continuity, standalone projects the same
`sd-review / assurance` and `sd-review / gate` names. A completed direct review
or authorized, timely, exact-head clean local attestation satisfies assurance
and permits the gate; failure, findings, cancellation, or missing local
evidence blocks. Standalone has no budget-deferral or recovery state and can
never produce a budget-deferred gate pass.

## Capability Matrix

| Capability | Standalone | Managed |
| --- | --- | --- |
| Automatic risk-to-lane routing | Yes | Yes |
| Broad route labels and exact lane commands | Yes | Yes |
| Fixed direct Copilot/PR-Agent handler | Yes | Yes |
| Repository-trusted local-attested route | Yes | No in initial managed contract |
| Exact-head receipt and Check | Yes, with explicit limitations | Yes |
| Candidate aliases and ordered chains | No | Yes |
| Shared/repository budgets and reservations | No | Yes |
| Authoritative cost reconciliation/reporting | No | Yes |
| Budget deferral, pending queue, and recovery | No | Yes |
| Candidate quarantine and policy clearance | No | Yes |
| Central price/data/region policy | No | Yes |
| Parallel reviewer plans | No in the initial standalone contract | Yes |
| Trusted adjudication/effectiveness evidence | No | Yes |
| Private retention, purge, and legal holds | Not applicable; no private service data | Yes |

Existing GitHub-native reviews, comments, and checks retain GitHub's own
lifecycle in both modes.

## Failure Semantics

- Standalone with no control-plane endpoint or credential is healthy.
- Managed configuration with a missing or unreachable control plane is an
  authorization failure before dispatch, not a reason to change modes.
- A deliberate managed-to-standalone migration is a new compiled configuration
  with a semantic diff and operator approval.
- Historical managed receipts remain readable; private reservations, deferred
  records, and adjudication evidence remain owned by the private service.

## Rollout And Rollback

New consumers without a control plane may scaffold explicit standalone v2.
Existing v1 fixed routes migrate once to equivalent standalone profiles. A
consumer upgrades to managed only after catalog/control-plane setup validates.
Rollback restores the last valid explicit configuration in the same mode or a
reviewed mode migration; runtime health never performs rollback automatically.
