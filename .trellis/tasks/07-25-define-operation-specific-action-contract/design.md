# Define operation-specific Action contract Design

## Boundary

- One declarative contract owns public operation shapes; runtime decoders remain the trust boundary.
- The design must not make secrets or dynamic workflow permissions part of caller-controlled data.

## Data Flow

```text
versioned operation declaration -> action metadata/examples + runtime decoder + documentation validation
```

## Compatibility

Preserve the current public behavior except where A-010 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
