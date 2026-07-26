# Same-Model Provider Failover Enforcement Design

## Boundary

Named chains own model changes before dispatch. This child constrains only the
provider router's endpoint choice after one exact model is authorized.

The adapter receives one model plus a digest-bound endpoint policy and empty
cross-model fallback. A bounded acknowledgment reports actual model/provider,
failover count, policy evidence, and dispatch certainty. Mismatch or uncertainty
stops the chain.

## Rollback

Disable provider routing for the candidate or remove it from the chain. Never
enable runtime model substitution as rollback.
