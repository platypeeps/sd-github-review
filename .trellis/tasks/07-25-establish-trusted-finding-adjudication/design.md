# Trusted Finding Adjudication Design

## Data Flow

```text
review finding + stable identity
          |
          v
sd-review proposes operational disposition
          |
          v
authorized maintainer attests
          |
          v
sd-github-review validates actor, identity, policy, and event
          |
          v
private append-only store ----> bounded GitHub status/receipt
          |
          +----> sd-review-learnings
          +----> sd-review-effectiveness
```

## Event Model

Each versioned event contains:

- finding identity: repository, PR, finding head, plan, child, reviewer,
  candidate, configuration digest, fingerprint, and channel reference;
- optional resolution head;
- `correctness=valid|invalid|uncertain`;
- `relationship=unique|duplicate|superseded` plus a related finding ID when
  applicable;
- `resolution=fixed|accepted_risk|deferred|not_actionable|open`;
- actor identity, permission evidence, trust level, bounded rationale code,
  timestamp, evidence references, and optional `supersedes`.

Raw finding bodies remain on their declared GitHub channels. Receipts carry
only bounded identities, safe codes, digests, and links.

## Trust Policy

Operational decisions are useful for review execution but not model-quality
claims. Maintainer-attested evidence requires an authenticated non-bot actor
who is not the finding publisher. Independent evidence additionally requires a
non-author maintainer or matching CODEOWNER. Repository policy may raise, but
not silently lower, these floors for high-risk categories.

## Delivery Decomposition

| Child | Responsibility |
| --- | --- |
| `07-25-define-finding-adjudication-contract` | Identity, enums, trust, supersession, privacy, and fixtures |
| `07-25-implement-trusted-finding-adjudication-workflow` | Actor/policy validation and idempotent attestation workflow |
| `07-25-publish-finding-adjudication-evidence` | Bounded status, query, receipts, coverage, and consumer contract |

The private store remains separately owned by
`07-25-define-finding-adjudication-evidence-store`.

## Failure And Rollback

Unknown schema, stale heads, ambiguous finding identity, authorization failure,
conflicting live evidence, or unavailable storage fails without changing the
prior record. Rollback disables new attestations and leaves prior events
readable; it never rewrites them into inferred operational dispositions.
