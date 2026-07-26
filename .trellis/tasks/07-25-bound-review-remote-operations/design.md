# Bound review remote operations Design

## Boundary

- Transport layers own deadlines; policy and protocol layers receive normalized terminal outcomes only.
- Timeout configuration is repository-owned, not derived from PR input.

## Data Flow

```text
operation -> bounded transport attempt -> success | safe retry | timeout/reconciliation
```

## Compatibility

Preserve the current public behavior except where A-012 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
