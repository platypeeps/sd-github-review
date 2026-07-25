# Trusted Finding Adjudication Workflow Design

The trusted workflow receives only stable finding IDs, requested dispositions,
bounded rationale codes, and safe evidence references. It derives actor and
repository context from GitHub, loads the authoritative finding receipt,
evaluates the repository trust policy, and creates an authorization-bound store
request.

Mutations are one-attempt. The workflow persists an idempotency record before
or atomically with the event through the private store. Any ambiguity stops for
query/reconciliation. Batch requests validate every row before one bounded
store operation.

GitHub receives a stable check/summary pointing to the event receipt; it is an
audit projection, not the authoritative store.
