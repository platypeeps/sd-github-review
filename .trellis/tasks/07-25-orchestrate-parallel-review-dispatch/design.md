# Parallel Review Dispatch Orchestration Design

## Boundary

This child begins with one durable batch-authorized plan and ends when every
authorized child has a bounded dispatch/observation terminal state. Aggregate
assurance and reporting are downstream.

The scheduler starts children up to the compiled global limit. Each child gets
only its immutable candidate and scoped credential. Replay resumes durable
identities. Head changes supersede unfinished work. Ambiguity is isolated to the
affected child and never causes replacement.

## Rollback

Set each lane to one slot or disable fan-out. Already-started children remain
historical evidence and are reconciled rather than cancelled or duplicated.
