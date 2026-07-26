# Finding Adjudication Contract Design

Implement strict pure decoders and canonical digest helpers in the protocol
layer. The contract carries safe identities and enums only. It references
GitHub finding channels by stable IDs/URLs but never copies the finding body.

An adjudication view is derived from append-only events: the latest valid
uncontested event may supersede an earlier event; incompatible concurrent
events produce `disputed`. Relationship state never implies correctness, and
resolution state never upgrades trust.

The schema family includes event, authorization request/result, store
acknowledgment, bounded query result, and public receipt projections.
