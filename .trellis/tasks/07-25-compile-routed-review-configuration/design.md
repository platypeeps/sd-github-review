# Routed Review Configuration Compiler Design

## Boundary

The compiler is a pure function over decoded explicit-mode v2 source and
mode-specific supplied inputs. Managed mode requires a safe exact-catalog
projection. Standalone mode requires only setup-discovered fixed handler
profiles and rejects catalog/candidate/budget fields. Retrieval, credentials,
filesystem writes, installer ownership, budget observation, and dispatch
remain outside it.

Compilation validates composition and references, normalizes order/durations/
units, materializes safe candidate and prompt-profile identity records, and
emits canonical JSON plus source, catalog, and output digests. Diagnostics
identify source fields without echoing raw catalog data or profile values.

Managed compilation also requires and preserves each lane's explicit
`budgetExhaustion.merge` value. Missing values and post-cutover legacy names
are field errors; the compiler never supplies a default.

## Rollback

Compiler versions are selected by the managed Action version. Output is never
active until the installer promotion child validates it; rollback recompiles or
promotes a prior explicit input pair.
