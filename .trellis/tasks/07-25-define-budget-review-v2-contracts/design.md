# Budget Review v2 Contract Design

## Boundary

The parent engine design owns data flow. This child owns only versioned wire and
storage shapes, canonical identity rules, privacy bounds, compatibility rules,
and setup-discovery capability declarations.

Contracts share exact repository/PR/head/attempt and configuration fingerprints
but expose only the minimum fields required by their operation. Forbidden-field
and size validation happens before canonicalization. Version 1 has a read-only
receipt decoder and cannot authorize v2 work.

Prompt-profile identity is part of the managed candidate tuple. Safe catalog,
compiled manifest, authorization, acknowledgment, and receipt schemas carry a
discriminated `referenced` alias/version/digest or `handler-managed` mode. They
never carry profile bodies or PR-Agent configuration values. No schema field
represents a lane default, inheritance, fallback, or independent profile
override.

Managed lane policy contains explicit
`budgetExhaustion.merge=block|allow`; the schema has no default. Outcome
contracts keep review, assurance, and merge-gate decisions independent.
Receipts are immutable per attempt, while a separate exact-head Check
projection carries a monotonic revision and latest-authorized-attempt token.
Setup discovery identifies the stable assurance and gate Checks and whether
branch protection requires only the gate.

Standalone route configuration is another strict discriminated union:
`direct-handler` carries one setup-discovered profile, while `local-attested`
carries one explicit trust-policy reference and no handler/provider fields.
The bounded local-attestation envelope is enriched with authenticated GitHub
actor/workflow context at ingestion. Its receipt uses
`trustLevel=repository_attested`; neither a caller assertion nor a historical
v1 local summary can produce `independent` trust or v2 assurance.

## Rollback

Schema rollout precedes emitters. Emergency rollback pins the last v1 workflow;
v2 does not weaken validation to accept legacy dispatch inputs.
