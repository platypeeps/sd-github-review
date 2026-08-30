# Encapsulate review label registry Design

## Boundary

- `src/router.js` owns label membership; callers ask questions rather than sharing state.

## Data Flow

```text
candidate label -> router-owned predicate -> stable membership result
```

## Compatibility

Preserve the current public behavior except where A-020 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
