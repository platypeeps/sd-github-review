# Finding Adjudication Evidence Store Design

This public repository owns schemas, an in-memory fake, and conformance tests.
The private service owns tenant authentication, append-only storage, encryption,
enforcement of `standard-v1`, audit, backup, and authorized queries.

```text
trusted workflow -> authorization-bound append -> private event store
analysis workflow <- bounded signed query response <-
```

Events are immutable. Corrections append a new event referencing the prior one.
The service may materialize current views, but the full event chain remains
authoritative. Shared query contracts expose coverage changes caused by
retention or deletion rather than silently presenting a complete dataset.

Under `standard-v1`, the chain is retained and deleted as one unit 13 months
after its newest event. A legal hold pauses deletion for the covered chain.
After deletion, only anonymous 25-month aggregate/coverage facts may remain;
they contain no repository, PR, finding, event, actor, candidate-actor, or
provider-account identifiers. Purge and backup restore use the shared deletion
journal and must never expose a partial chain as authoritative.
