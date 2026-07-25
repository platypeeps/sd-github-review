# Finding Adjudication Evidence Store Handoff Plan

1. Freeze append/query/acknowledgment and authorization schemas.
2. Implement the deterministic in-memory fake and conformance suite.
3. Add fake-clock concurrency, idempotency, conflict, 13-month chain-unit
   retention, 25-month anonymous aggregate, deletion, hold, purge, transfer,
   backup/restore, audit, privacy, and outage fixtures.
4. Document deployment, authentication, encryption, secret, backup, restore,
   retention, and incident-response requirements.
5. Name the private repository/owner and explicitly authorize implementation
   before porting the conformance suite.

Stop at the public handoff if no private implementation owner is identified.
