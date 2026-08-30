# Decompose consumer installer lifecycle Design

## Boundary

- Pure planning depends on decoded snapshots, not filesystem or `gh` calls.
- Orchestration coordinates transport and persistence; only the entrypoint owns process I/O.

## Data Flow

```text
CLI decode -> target/config codecs -> pure plan -> transport/persistence executor -> bounded report
```

## Compatibility

Preserve the current public behavior except where A-009 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
