# Cheap Review Candidate Qualification Design

## Boundary

This child produces a versioned qualification record for one candidate/prompt-
profile/runtime/policy tuple. It does not dispatch production reviews or alter
chain order.

Qualification combines deterministic capability fixtures with bounded runtime
acknowledgment evidence. Every mandatory control is three-state: proven,
unsupported, or unknown. Only proven tuples are eligible for automatic routing.

## Invalidation

Changing candidate target, prompt-profile alias/version/digest, adapter/runtime
digest, or applicable policy digest invalidates the record and requires
requalification. Reusing one profile across candidates does not reuse the
candidate qualification record; each pair is proven independently.
