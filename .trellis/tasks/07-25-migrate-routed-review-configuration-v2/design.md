# Routed Review v2 Migration Design

## Boundary

The parent configuration design owns the target architecture. This child owns
one deterministic translation from supported installer-owned v1 inputs to the
same explicit source produced for a fresh v2 consumer.

Migration is prepare/preview/apply. It records the recognized v1 fingerprint,
target standalone source digest, and managed ownership transition before
writes. Unknown or ambiguous fixed-profile mappings require explicit operator
input. Managed enablement is a later explicit source change and semantic diff.

If that reviewed change consumes a supported installer-owned legacy exhaustion
setting, migration translates it once to explicit per-lane `merge=block|allow`.
The target source contains only the new field; runtime never accepts or stores
the legacy value.

## Compatibility And Rollback

The translation runs once. Version 2 never interprets legacy/default selectors.
Rollback restores the prior managed artifact set or pins the v1 workflow; it
does not add a dual-read compatibility layer.
