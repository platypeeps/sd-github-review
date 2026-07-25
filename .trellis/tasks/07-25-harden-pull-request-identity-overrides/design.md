# Harden pull request identity overrides Design

## Boundary

- Normalize identity once at the Action input boundary in `src/index.js`.
- Downstream policy and clients receive the normalized target, never the raw override.

## Data Flow

```text
event identity + optional override -> strict normalization/binding -> one target -> metadata/routing/side effects
```

## Compatibility

Preserve the current public behavior except where A-002 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
