# Remove unused installer export Design

## Boundary

- This is dead-code removal only; broader installer decomposition belongs to A-009.

## Data Flow

```text
verify zero consumers -> delete export -> run focused gates
```

## Compatibility

Preserve the current public behavior except where A-021 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
