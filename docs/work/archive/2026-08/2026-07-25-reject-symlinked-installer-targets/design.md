# Reject symlinked installer targets Design

## Boundary

- One filesystem guard owns containment checks for all installer lifecycle operations.
- The guard validates fixed installer paths; it does not grant support for arbitrary user-selected destinations.

## Data Flow

```text
canonical Git root -> ancestor inspection -> contained managed path -> atomic operation
```

## Compatibility

Preserve the current public behavior except where A-005 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
