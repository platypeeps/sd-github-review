# Consolidate routing policy boundaries Design

## Boundary

- Entry points stage inputs and outputs; policy remains pure; transport and receipt persistence remain infrastructure.
- This task restructures ownership without introducing v2 product behavior.

## Data Flow

```text
decoded input -> normalized risk context -> pure policy -> authorized dispatch service -> receipt/output
```

## Compatibility

Preserve the current public behavior except where A-008 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
