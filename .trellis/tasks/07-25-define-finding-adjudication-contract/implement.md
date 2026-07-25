# Finding Adjudication Contract Implementation Plan

1. Add canonical valid, invalid, privacy, conflict, and supersession fixtures.
2. Implement strict pure decoders, canonicalization, digests, and size limits
   in the protocol layer.
3. Add relationship-target and exact-identity validation.
4. Add deterministic event-folding tests for correction, duplicate replay,
   conflict, and historical read-only evidence.
5. Publish setup-discovery contract identity and documentation.

Run focused protocol tests, metadata validation, and the repository full gate.
