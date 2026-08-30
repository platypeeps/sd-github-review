# Align local full check with CI Design

## Boundary

- The command pack owns generic execution; this repository owns its package gate inventory.
- Do not fork installed generated scripts when a supported configuration boundary exists.

## Data Flow

```text
repository gate inventory -> sd full-check adapter -> exact package commands -> aggregate result
```

## Compatibility

Preserve the current public behavior except where A-017 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
